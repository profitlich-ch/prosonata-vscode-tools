import { randomUUID } from 'node:crypto'

import { HttpApi, type Api } from './api.js'
import { systemClock, type Clock } from './clock.js'
import { paths, readConfig, type Config } from './config.js'
import { describeRepo, mainBranch, type GitRepo } from './git.js'
import { Journal } from './journal.js'
import { branchKey } from './marker.js'
import { modeFor, readRepoConfig, type RepoConfig } from './repo-config.js'
import { send, type SendResult } from './sender.js'
import { planAdjustment, type Adjustment, type Plan, type Situation } from './adjust.js'
import { SegmentLog, atLocal, type Segment } from './segments.js'
import { StateStore } from './state-store.js'
import { sync } from './sync.js'
import {
  bookCorrection,
  commit,
  currentSeconds,
  keepFromRunning,
  openEntry,
  pause,
  pauseAt,
  queueWriteFor,
  resumeAfterAdding,
  resumeAsNew,
  shiftStart,
  start,
  unwrittenSeconds,
} from './tracking.js'
import type { EntryMode, Scope, State } from './types.js'
import { workingTime } from './working-time.js'

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
    super(`diesem Repository ist noch kein Projekt zugeordnet — führe "prosonata init" in ${repoPath} aus`)
    this.name = 'NotConfigured'
  }
}

export class Session {
  readonly store: StateStore
  readonly journal: Journal
  readonly segments: SegmentLog
  readonly clock: Clock
  private cachedApi: Api | null = null

  constructor(
    readonly config: Config,
    options: { clock?: Clock; api?: Api; store?: StateStore; journal?: Journal; segments?: SegmentLog } = {},
  ) {
    this.clock = options.clock ?? systemClock
    this.store = options.store ?? new StateStore(paths.state())
    this.journal = options.journal ?? new Journal(paths.journal())
    this.segments = options.segments ?? new SegmentLog(paths.segments())
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

  /**
   * Starts the timer. Arriving at a branch with no entry of its own is exactly
   * the moment to look whether ProSonata already holds one — from the other
   * machine, or from a state file that was lost (KONZEPT.md §3).
   *
   * The lookup must never keep the timer from starting: measuring works without
   * a network, sending does not. A failure is therefore noted and swallowed.
   */
  async start(context: RepoContext): Promise<State> {
    this.reconcileBranchSwitch(context)
    if (!openEntry(this.state(), context.scope)) await this.syncQuietly(context)

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

  /** The lookup where a failure is not worth interrupting anyone over. */
  async syncQuietly(context: RepoContext): Promise<void> {
    try {
      await this.sync(context)
    } catch (error) {
      this.journal.append({ kind: 'note', entryId: '-', message: `Abgleich nicht möglich: ${(error as Error).message}` })
    }
  }

  pause(context: RepoContext): State {
    const startedAt = this.runningSince(context)
    const state = this.store.update((current) => pause(current, this.clock, context.scope))
    if (startedAt !== null) this.recordSegmentAt(context, startedAt, this.clock.now(), 'pause')
    return state
  }

  /**
   * Keeps part of a segment that ran too long and stops the timer. The log gets
   * the shortened span and how long it really ran — the one place where measured
   * time disappears on purpose, so it must not disappear silently as well.
   */
  keepFromRunning(context: RepoContext, seconds: number): State {
    const startedAt = this.runningSince(context)
    if (startedAt === null) return this.state()

    const now = this.clock.now()
    const state = this.store.update((current) => keepFromRunning(current, this.clock, context.scope, seconds))
    const kept = Math.min(seconds, Math.max(0, Math.floor((now - startedAt) / 1000)))
    this.recordSegmentAt(context, now - kept * 1000, now, 'trimmed', Math.floor((now - startedAt) / 1000))
    return state
  }

  /**
   * Winds the clock forward or back by `seconds`, positive meaning "count more"
   * (KONZEPT.md §3).
   *
   * While a timer runs its start moves — the measurement stays a measurement,
   * and the segment reaches the log later with the corrected beginning. While
   * nothing runs the entry is changed directly, and that needs a line of its
   * own in the log; otherwise a day would add up differently there than in
   * ProSonata.
   *
   * Returns what was really applied: the limits below can cut a wish short.
   */
  adjust(context: RepoContext, adjustment: Adjustment): Plan {
    const runningSince = this.runningSince(context)
    const plan = planAdjustment(adjustment, this.situation(context))
    if (plan.action === 'impossible') return plan
    if (plan.delta === 0 && plan.action !== 'stop') return plan

    if (plan.action === 'stop' && runningSince !== null) {
      const at = plan.at ?? this.clock.now()
      this.store.update((state) => pauseAt(state, this.clock, context.scope, at).state)
      // The true span, so the log does not claim work at the wrong hour.
      this.recordSegmentAt(context, runningSince, at, 'pause')
      return plan
    }

    if (plan.action === 'shift') {
      this.store.update((state) => shiftStart(state, this.clock, context.scope, plan.delta, this.lastSegmentEnd(context)).state)
      return plan
    }

    this.store.update((state) => bookCorrection(state, this.startOptionsFor(context), plan.delta).state)
    // Without a beginning: an amount booked after the fact is not a measurement,
    // and no clock times may be invented for it.
    this.recordCorrection(context, plan.delta)
    this.queueIfKnown(context)
    return plan
  }

  /** A correction carries only its amount and the moment it was entered. */
  private recordCorrection(context: RepoContext, seconds: number): void {
    const entry = openEntry(this.state(), context.scope)
    this.segments.append({
      until: atLocal(this.clock.now()),
      seconds,
      repoPath: context.scope.repoPath,
      branch: context.scope.branch,
      projectId: context.projectId,
      entryId: entry?.id ?? '-',
      reason: 'correction',
    })
  }

  /** A correction changes the sum without a segment ending; the write must follow. */
  private queueIfKnown(context: RepoContext): void {
    const entry = openEntry(this.state(), context.scope)
    if (entry && entry.timeId !== null) {
      this.store.update((state) => queueWriteFor(state, entry.id, this.clock.now()))
    }
  }

  /** What an adjustment would do, without doing it — for showing it first. */
  situation(context: RepoContext): Situation {
    return {
      now: this.clock.now(),
      runningSince: this.runningSince(context),
      lastSegmentEnd: this.lastSegmentEnd(context),
      booked: openEntry(this.state(), context.scope)?.seconds ?? 0,
    }
  }

  /**
   * The end of the last segment measured on this branch — the floor a shifted
   * start must not fall below, because the minutes before it are already
   * booked. Nothing measured yet means no floor.
   */
  lastSegmentEnd(context: RepoContext): number {
    const ends = this.segments
      .read()
      .filter((segment) => segment.repoPath === context.scope.repoPath && segment.branch === context.scope.branch)
      .map((segment) => Date.parse(segment.until))
      .filter((value) => Number.isFinite(value))

    return ends.length === 0 ? 0 : Math.max(...ends)
  }

  /** The last commit on this branch, as the log saw it — an anchor to count from. */
  lastCommitAt(context: RepoContext): number | null {
    const commits = this.segments
      .read()
      .filter(
        (segment) =>
          segment.reason === 'commit' &&
          segment.repoPath === context.scope.repoPath &&
          segment.branch === context.scope.branch,
      )
      .map((segment) => Date.parse(segment.until))
      .filter((value) => Number.isFinite(value))

    return commits.length === 0 ? null : Math.max(...commits)
  }

  private startOptionsFor(context: RepoContext) {
    return {
      scope: context.scope,
      key: context.key,
      projectId: context.projectId,
      categoryId: context.categoryId,
      mode: context.mode,
      newId: randomUUID,
    }
  }

  /** When the running segment of this scope began, or null while paused. */
  private runningSince(context: RepoContext): number | null {
    const timer = this.state().timers.find(
      (candidate) =>
        candidate.startedAt !== null &&
        candidate.scope.repoPath === context.scope.repoPath &&
        candidate.scope.branch === context.scope.branch,
    )
    return timer?.startedAt ?? null
  }

  private recordSegmentAt(
    context: RepoContext,
    from: number,
    until: number,
    reason: Segment['reason'],
    ranSeconds?: number,
  ): void {
    const entry = openEntry(this.state(), context.scope) ?? this.state().entries.find((candidate) => candidate.key === context.key)
    this.segments.append({
      from: atLocal(from),
      until: atLocal(until),
      seconds: Math.max(0, Math.floor((until - from) / 1000)),
      repoPath: context.scope.repoPath,
      branch: context.scope.branch,
      projectId: context.projectId,
      entryId: entry?.id ?? '-',
      reason,
      ...(ranSeconds === undefined ? {} : { ranSeconds }),
    })
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
    const startedAt = this.runningSince(context)

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

    if (startedAt !== null && booked > 0) this.recordSegmentAt(context, startedAt, this.clock.now(), 'commit')
    return { state, booked, hadTimer, closed, branchSwitched: switched }
  }

  /**
   * The answer to "closed on another machine" (KONZEPT.md §3).
   *
   * `add` sends what is missing to the entry that was closed — as a `PUT` that
   * carries `workingTime` alone, so the final text stays exactly as it was left
   * and the marker does not come back. `fresh` writes nothing there at all.
   *
   * Either way this entry lets go of the old `timeID`: what accrues from now on
   * belongs to a new one, because the old is finished.
   */
  async resolveClosedElsewhere(entryId: string, answer: 'add' | 'fresh'): Promise<void> {
    const entry = this.state().entries.find((candidate) => candidate.id === entryId)
    if (!entry?.awaitingDecision) return

    if (answer === 'fresh' || entry.timeId === null) {
      this.store.update((state) => resumeAsNew(state, entryId))
      return
    }

    const total = (entry.remoteFinalSeconds ?? 0) + unwrittenSeconds(entry)
    await this.api.updateEntry(entry.timeId, { workingTime: workingTime(total, this.config.grid) })
    this.journal.append({ kind: 'sent', entryId, timeId: entry.timeId })
    this.store.update((state) => resumeAfterAdding(state, entryId))
  }

  /** Set by the last sync: somebody is measuring on this branch elsewhere. */
  runningElsewhereSince: string | null = null

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
    this.runningElsewhereSince = outcome.runningElsewhereSince
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
