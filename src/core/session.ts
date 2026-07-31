import { randomUUID } from 'node:crypto'

import { HttpApi, type Api } from './api.js'
import { systemClock, type Clock } from './clock.js'
import { paths, readConfig, type Config } from './config.js'
import { describeRepo, mainBranch, type GitRepo } from './git.js'
import { Journal } from './journal.js'
import { branchKey } from './marker.js'
import { modeFor, readRepoConfig, type RepoConfig } from './repo-config.js'
import { send, type SendResult } from './sender.js'
import { StateStore } from './state-store.js'
import { sync } from './sync.js'
import { commit, currentSeconds, openEntry, pause, start } from './tracking.js'
import type { EntryMode, Scope, State } from './types.js'

/**
 * Wires the pieces together for the two front ends, the CLI and the extension.
 * `core` still knows nothing about VS Code — this is plain Node.
 */

export interface RepoContext {
  repo: GitRepo
  scope: Scope
  key: string
  mainBranch: string
  mode: EntryMode
  config: RepoConfig
  projectId: number
  categoryId: number
}

export class NotConfigured extends Error {
  constructor(readonly repoPath: string) {
    super(`this repository has no project yet — run "prosonata init" in ${repoPath}`)
    this.name = 'NotConfigured'
  }
}

export class Session {
  readonly store: StateStore
  readonly journal: Journal
  readonly clock: Clock
  private cachedApi: Api | null = null

  constructor(
    readonly config: Config,
    options: { clock?: Clock; api?: Api; store?: StateStore; journal?: Journal } = {},
  ) {
    this.clock = options.clock ?? systemClock
    this.store = options.store ?? new StateStore(paths.state())
    this.journal = options.journal ?? new Journal(paths.journal())
    this.cachedApi = options.api ?? null
  }

  static open(options: { clock?: Clock; api?: Api } = {}): Session {
    return new Session(readConfig(), options)
  }

  get api(): Api {
    this.cachedApi ??= new HttpApi(
      this.config.appId === undefined
        ? { baseUrl: this.config.baseUrl, apiKey: this.config.apiKey }
        : { baseUrl: this.config.baseUrl, apiKey: this.config.apiKey, appId: this.config.appId },
    )
    return this.cachedApi
  }

  /** Everything about the repository at `cwd`, or null if it is not one. */
  context(cwd: string): RepoContext | null {
    const repo = describeRepo(cwd)
    if (!repo) return null

    const config = readRepoConfig(repo.root)
    const main = mainBranch(repo.root)
    const key = branchKey(repo.rootCommit, repo.branch)
    const projectId = config.activeProjectId
    if (projectId === null) throw new NotConfigured(repo.root)

    return {
      repo,
      scope: { repoPath: repo.root, branch: repo.branch },
      key,
      mainBranch: main,
      mode: modeFor(config, repo.branch, main, key),
      config,
      projectId,
      categoryId: config.categories.get(projectId) ?? 0,
    }
  }

  state(): State {
    const { state, recovery } = this.store.read()
    if (recovery) {
      this.journal.append({
        kind: 'note',
        entryId: '-',
        message: `state.json was ${recovery.reason}, moved to ${recovery.quarantinedAt}`,
      })
    }
    return state
  }

  /**
   * A branch switch in the terminal, with no VS Code window open, is noticed by
   * nobody while it happens — a `post-checkout` hook is deliberately rejected
   * (KONZEPT.md §5). It surfaces here, at the next write access, in retrospect
   * and without a known moment.
   *
   * The whole elapsed time therefore goes to the scope it was started in, and
   * the timer is paused. Asking is left to the next window.
   */
  reconcileBranchSwitch(context: RepoContext): boolean {
    let switched = false
    this.store.update((state) => {
      const stray = state.timers.find(
        (timer) =>
          timer.startedAt !== null &&
          timer.scope.repoPath === context.scope.repoPath &&
          timer.scope.branch !== context.scope.branch,
      )
      if (!stray) return state

      switched = true
      return pause(state, this.clock, stray.scope)
    })
    return switched
  }

  start(context: RepoContext): State {
    this.reconcileBranchSwitch(context)
    return this.store.update((state) =>
      start(state, this.clock, {
        scope: context.scope,
        key: context.key,
        projectId: context.projectId,
        categoryId: context.categoryId,
        mode: context.mode,
        newId: randomUUID,
      }),
    )
  }

  pause(context: RepoContext): State {
    return this.store.update((state) => pause(state, this.clock, context.scope))
  }

  /** Called by the hook after a commit. */
  commit(context: RepoContext, options: { text: string; fromTrailer: boolean; sha: string }): {
    state: State
    booked: number
    hadTimer: boolean
    closed: boolean
    branchSwitched: boolean
  } {
    let booked = 0
    let hadTimer = false
    let closed = false

    const switched = this.reconcileBranchSwitch(context)

    const state = this.store.update((current) => {
      const outcome = commit(current, {
        scope: context.scope,
        mode: context.mode,
        text: options.text,
        fromTrailer: options.fromTrailer,
        sha: options.sha,
        at: this.clock.now(),
        newId: randomUUID,
        projectId: context.projectId,
        categoryId: context.categoryId,
        key: context.key,
      })
      booked = outcome.booked
      hadTimer = outcome.hadTimer
      closed = outcome.closed !== null

      if (outcome.closed) {
        this.journal.append({
          kind: 'commit',
          entryId: outcome.closed.id,
          key: context.key,
          projectId: context.projectId,
          categoryId: context.categoryId,
          seconds: outcome.closed.seconds,
          date: this.clock.today(),
          text: outcome.closed.text,
          sha: options.sha,
        })
      } else if (booked > 0) {
        const entry = openEntry(outcome.state, context.scope)
        if (entry) {
          this.journal.append({
            kind: 'segment',
            entryId: entry.id,
            key: context.key,
            projectId: context.projectId,
            categoryId: context.categoryId,
            seconds: entry.seconds,
            date: this.clock.today(),
            text: entry.text,
            sha: options.sha,
          })
        }
      }
      return outcome.state
    })

    return { state, booked, hadTimer, closed, branchSwitched: switched }
  }

  /** Looks for an entry of this branch in ProSonata and adopts it if there is one. */
  async sync(context: RepoContext): Promise<void> {
    const before = this.state()
    const outcome = await sync(before, this.api, this.config, {
      scope: context.scope,
      key: context.key,
      projectId: context.projectId,
      categoryId: context.categoryId,
      newId: randomUUID,
    })
    if (outcome.adopted || outcome.closedElsewhere) {
      this.store.update(() => outcome.state)
    }
  }

  /** Sends everything that is due (KONZEPT.md §4). */
  async flush(force = false): Promise<SendResult> {
    const { state, result } = await send(this.state(), this, force)
    if (result.sent.length > 0 || result.failed.length > 0) {
      this.store.update(() => state)
    }
    return result
  }

  seconds(context: RepoContext): number {
    return currentSeconds(this.state(), this.clock, context.scope)
  }
}
