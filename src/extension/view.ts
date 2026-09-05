import * as vscode from 'vscode'

import { MissingConfig, readConfig } from '../core/config.js'
import { describeRepo, type GitRepo } from '../core/git.js'
import { NotConfigured, Session, type RepoContext } from '../core/session.js'
import { currentSeconds, openEntry, runningSeconds } from '../core/tracking.js'
import type { State } from '../core/types.js'
import { billedTime } from '../core/report.js'
import { readRepoConfig } from '../core/repo-config.js'
import { clock, Panel, type Budget } from './panel.js'

/**
 * The window's shared state and the handful of accessors everything else needs
 * (KONZEPT.md §8).
 *
 * Split out of `index.ts` so the command handlers could follow: they all reach
 * for `currentSession`, `currentContext` and `reload`, and as long as those sat
 * in the entry point, nothing could move. Nothing here imports a handler, so the
 * dependency runs one way.
 */

/** Fills in what only `activate` can create. */
export function mount(uri: vscode.Uri, bar: vscode.StatusBarItem, tree: Panel): void {
  extensionUri = uri
  statusBar = bar
  panel = tree
}

export function cachedState(): State | null {
  return cached
}

export function budgetOf(projectId: number): Budget | undefined {
  return budgets.get(projectId)
}

export function extensionRoot(): vscode.Uri | null {
  return extensionUri
}

/** After the account was written anew, the next call builds a fresh session. */
export function resetSession(): void {
  session = null
}

let session: Session | null = null

let statusBar: vscode.StatusBarItem

let panel: Panel

/** Last state read from disk. Drawing uses this instead of reading every second. */
let cached: State | null = null

/** Kept for paths into the installed extension, e.g. the bundled CLI. */
let extensionUri: vscode.Uri | null = null

/**
 * What a project has planned and used up, per project id (KONZEPT.md §8).
 *
 * Kept in the window, not on disk: it is a look at ProSonata, not a decision,
 * and a stale budget is worse than none. Refreshed where it can actually have
 * changed — when the window opens, when a project appears for the first time,
 * and once a closed entry has really reached ProSonata. Never on a timer; this
 * tool does not poll (KONZEPT.md §9).
 */
const budgets = new Map<number, Budget>()

/** Whether one of the entries just sent was a closing write. */
export function closedAmong(session: Session, sent: string[]): boolean {
  if (sent.length === 0) return false
  return session.state().entries.some((entry) => sent.includes(entry.id) && entry.state === 'closed')
}

export async function refreshBudget(session: Session, projectId: number): Promise<void> {
  try {
    const project = (await session.api.listProjects()).find((candidate) => candidate.projectID === projectId)
    if (project) budgets.set(projectId, { needed: project.timeNeeded, planned: project.timePlanned })
    panel.refresh()
  } catch {
    // A budget nobody could fetch is simply not shown.
  }
}

export function currentSession(): Session | null {
  if (session) return session
  try {
    session = new Session(readConfig())
  } catch {
    return null
  }
  return session
}

/**
 * The last answer of `readContext`, kept until something could have changed it.
 *
 * Reading it costs about a dozen `git` child processes — the repository root,
 * the root commit, the branch, the HEAD path, the main branch, and half a dozen
 * `git config` lookups. Measured at roughly 6 ms each. The status bar redraws
 * every second, so without this the extension spent some 7 % of a core on
 * finding out what it already knew.
 *
 * Emptied by `reload`, which runs after every command, on every change to
 * `state.json`, when the editor changes and at the end of each work beat — so a
 * branch switch shows up within one beat at the latest.
 */
let contextCache: { path: string; context: RepoContext | null } | null = null

export function forgetContext(): void {
  contextCache = null
}

export function currentContext(): RepoContext | null {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) return null
  const path = folder.uri.fsPath
  if (contextCache?.path === path) return contextCache.context

  const context = readContext(path)
  contextCache = { path, context }
  return context
}

function readContext(path: string): RepoContext | null {
  const active = currentSession()
  if (!active) return null
  try {
    return active.context(path)
  } catch (error) {
    if (error instanceof NotConfigured || error instanceof MissingConfig) return null
    throw error
  }
}

export function withContext(action: (session: Session, context: RepoContext) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const active = currentSession()
    if (!active) {
      void vscode.window.showWarningMessage('ProSonata: noch kein Konto eingerichtet — führe "prosonata init" aus.')
      return
    }
    const context = currentContext()
    if (!context) {
      void vscode.window.showWarningMessage('ProSonata: diesem Repository ist noch kein Projekt zugeordnet — führe "prosonata init" aus.')
      return
    }
    try {
      await action(active, context)
    } catch (error) {
      void vscode.window.showErrorMessage(`ProSonata: ${(error as Error).message}`)
    }
    reload()
  }
}

/**
 * For commands that set a repository up. They must not require a configured
 * project — choosing one is exactly what they are for.
 */
export function withRepo(action: (session: Session, repo: GitRepo) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const active = currentSession()
    if (!active) {
      void vscode.window.showWarningMessage('ProSonata: noch kein Konto eingerichtet — richte es zuerst ein.')
      return
    }

    const folder = vscode.workspace.workspaceFolders?.[0]
    const repo = folder ? describeRepo(folder.uri.fsPath) : null
    if (!repo) {
      void vscode.window.showWarningMessage('ProSonata: dieser Ordner ist kein Git-Repository.')
      return
    }

    try {
      await action(active, repo)
    } catch (error) {
      void vscode.window.showErrorMessage(`ProSonata: ${(error as Error).message}`)
    }
    reload()
  }
}

/** Reads the state from disk once, then draws. */
export function reload(): void {
  // Anything that reaches here may have moved the branch or the repository
  // settings, so the cached context is dropped and read once, not every second.
  forgetContext()

  const active = currentSession()
  try {
    cached = active?.state() ?? null
  } catch {
    cached = null
  }

  // Drives the `when` clauses of the welcome content in package.json.
  void vscode.commands.executeCommand('setContext', 'prosonata.hasAccount', active !== null)
  void vscode.commands.executeCommand('setContext', 'prosonata.hasProject', currentContext() !== null)

  const context = currentContext()
  if (active && context && !budgets.has(context.projectId)) void refreshBudget(active, context.projectId)

  draw()
  panel.refresh()
}

/**
 * Draws from the cached state, counting the running segment up locally. Called
 * every second, so it must not touch the disk.
 */

export function draw(): void {
  const context = currentContext()
  const state = cached
  if (!context || !state) {
    statusBar.hide()
    return
  }

  const running = state.timers.filter((timer) => timer.startedAt !== null)
  const here = state.timers.find(
    (timer) => timer.scope.repoPath === context.scope.repoPath && timer.scope.branch === context.scope.branch,
  )

  const active = currentSession()
  if (!active) {
    statusBar.hide()
    return
  }

  /*
   * What the branch has collected — the number that ends up on the invoice. A
   * single figure without a label is read as "my time here", and that is the
   * total, not the stretch since the last start.
   *
   * The running segment moves into the tooltip. It keeps its own job elsewhere:
   * the panel shows both side by side, and `warnAboutLongRun` still measures the
   * segment, because a forgotten timer shows in that number alone.
   */
  const icon = here?.startedAt ? '$(debug-pause)' : '$(play)'
  const others = running.length > 1 ? ` +${running.length - 1}` : ''
  const segment = runningSeconds(state, active.clock, context.scope)
  const total = currentSeconds(state, active.clock, context.scope)

  statusBar.text = `${icon} ${clock(total)}${others}`
  statusBar.tooltip = [
    context.scope.branch,
    here?.startedAt ? `laufendes Segment ${clock(segment)}` : 'pausiert',
    state.pending.length > 0 ? `${state.pending.length} warten auf Versand` : 'nichts wartet auf Versand',
  ].join(' · ')
  statusBar.show()

  // Only while something actually ticks, so the tree is not redrawn for nothing.
  if (running.length > 0) panel.refresh()
}
