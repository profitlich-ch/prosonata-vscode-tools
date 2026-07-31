import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as vscode from 'vscode'

import { DEFAULTS, MissingConfig, paths, readConfig, writeConfig } from '../core/config.js'
import { fetchPrune, isMerged, mainBranch, remoteBranchGone } from '../core/git.js'
import { hookNeedsRepair, installHook } from '../core/hooks.js'
import { rememberProject, setGrid, setMode } from '../core/repo-config.js'
import { NotConfigured, Session, type RepoContext } from '../core/session.js'
import { close, currentSeconds, openEntry } from '../core/tracking.js'
import type { State } from '../core/types.js'
import type { TimeGrid } from '../core/working-time.js'
import { clock, Panel } from './panel.js'

/**
 * The VS Code side (KONZEPT.md §8). It contains no rules of its own — those all
 * live in `core`, so a commit from the terminal behaves exactly like one from
 * the editor.
 */

/*
 * Two rhythms on purpose. Drawing runs once a second so the seconds in the
 * status bar actually move; it reads nothing from disk and counts up from
 * `startedAt`, as KONZEPT.md §8 prescribes. The work — watching HEAD, sending,
 * warning — stays on the slower beat, where it belongs.
 */
const DRAW_MS = 1_000
const WORK_MS = 30_000
const PRUNE_MS = 60 * 60 * 1000

let session: Session | null = null
let statusBar: vscode.StatusBarItem
let panel: Panel
let lastHead: string | null = null
/** Last state read from disk. Drawing uses this instead of reading every second. */
let cached: State | null = null
/** Kept for paths into the installed extension, e.g. the bundled CLI. */
let extensionUri: vscode.Uri | null = null

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.command = 'prosonata.toggle'
  context.subscriptions.push(statusBar)

  panel = new Panel(currentSession, currentContext, () => cached)
  context.subscriptions.push(vscode.window.registerTreeDataProvider('prosonata.panel', panel))

  register(context, 'prosonata.setup', () => setUpAccount())
  register(context, 'prosonata.start', withContext((s, c) => void s.start(c)))
  register(context, 'prosonata.pause', withContext((s, c) => void s.pause(c)))
  register(context, 'prosonata.toggle', withContext(toggle))
  register(context, 'prosonata.send', withContext(sendNow))
  register(context, 'prosonata.chooseProject', withContext(chooseProject))
  register(context, 'prosonata.chooseGrid', withContext(chooseGrid))
  register(context, 'prosonata.toggleMode', withContext(toggleMode))
  register(context, 'prosonata.closeEntry', withContext(closeEntry))

  /*
   * The hook records absolute paths, which break when Node's version changes,
   * for instance through nvm. Repair it quietly instead of failing silently at
   * the next commit (KONZEPT.md §8).
   */
  repairHookIfNeeded(context)

  /*
   * A FileSystemWatcher on ~/.prosonata/state.json. Two things matter here: the
   * file lives outside the workspace, so the pattern needs an absolute path;
   * and the atomic rename often shows up as create/delete rather than change.
   */
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(paths.dir()), 'state.json'),
  )
  for (const event of [watcher.onDidChange, watcher.onDidCreate, watcher.onDidDelete]) {
    context.subscriptions.push(event(() => reload()))
  }
  context.subscriptions.push(watcher)

  const drawer = setInterval(() => draw(), DRAW_MS)
  const worker = setInterval(() => void work(), WORK_MS)
  const pruner = setInterval(() => void prune(), PRUNE_MS)
  context.subscriptions.push({
    dispose: () => {
      clearInterval(drawer)
      clearInterval(worker)
      clearInterval(pruner)
    },
  })

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => reload()))
  reload()
}

export function deactivate(): void {
  // Closing VS Code is one of the send triggers (KONZEPT.md §4).
  void session?.flush(true)
}

/**
 * The session, or null while there is no account yet.
 *
 * Deliberately not a session with an empty base URL: that would turn a missing
 * setup into "Failed to parse URL" somewhere inside fetch. It is re-read on
 * every miss, so running "prosonata init" takes effect without reloading the
 * window.
 */
function currentSession(): Session | null {
  if (session) return session
  try {
    session = new Session(readConfig())
  } catch {
    return null
  }
  return session
}

function currentContext(): RepoContext | null {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) return null
  const active = currentSession()
  if (!active) return null
  try {
    return active.context(folder.uri.fsPath)
  } catch (error) {
    if (error instanceof NotConfigured || error instanceof MissingConfig) return null
    throw error
  }
}

function register(context: vscode.ExtensionContext, id: string, handler: () => Promise<void> | void): void {
  context.subscriptions.push(vscode.commands.registerCommand(id, handler))
}

function withContext(action: (session: Session, context: RepoContext) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const active = currentSession()
    if (!active) {
      void vscode.window.showWarningMessage('ProSonata: no account configured yet — run "prosonata init".')
      return
    }
    const context = currentContext()
    if (!context) {
      void vscode.window.showWarningMessage('ProSonata: this repository has no project yet — run "prosonata init".')
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
 * Sets up the account from inside the editor, so the terminal is never needed.
 * The key goes to ~/.prosonata/config.json with mode 0600 — not to VS Code's
 * SecretStorage, which the hook could not read (KONZEPT.md §7).
 */
async function setUpAccount(): Promise<void> {
  const baseUrl = await vscode.window.showInputBox({
    title: 'ProSonata: base URL',
    prompt: 'Up to and including /api/v1',
    placeHolder: 'https://<subdomain>.prosonata.software/api/v1',
    value: readIfPresent()?.baseUrl ?? '',
    ignoreFocusOut: true,
  })
  if (baseUrl === undefined) return

  const apiKey = await vscode.window.showInputBox({
    title: 'ProSonata: personal API key',
    prompt: 'A user key, not an app integration — an integration is not a user',
    password: true,
    ignoreFocusOut: true,
  })
  if (apiKey === undefined) return

  writeConfig({ ...DEFAULTS, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() })
  session = null
  reload()
  void vscode.window.showInformationMessage(
    `ProSonata: written to ${paths.config()}. Now choose a project for this repository.`,
  )
  await vscode.commands.executeCommand('prosonata.chooseProject')
}

function readIfPresent() {
  try {
    return readConfig()
  } catch {
    return null
  }
}

function toggle(session: Session, context: RepoContext): void {
  const running = session.state().timers.find(
    (timer) => timer.scope.repoPath === context.scope.repoPath && timer.scope.branch === context.scope.branch && timer.startedAt !== null,
  )
  if (running) session.pause(context)
  else session.start(context)
}

async function sendNow(session: Session): Promise<void> {
  const result = await session.flush(true)
  for (const problem of result.tooLong) {
    void vscode.window.showWarningMessage(
      `ProSonata: the text is ${problem.length} characters, the limit is ${problem.limit}. ` +
        'ProSonata would cut it without saying so, so it was not sent. Shorten it.',
    )
  }
  for (const failure of result.failed) {
    void vscode.window.showWarningMessage(`ProSonata: ${failure.error.message}`)
  }
}

async function chooseProject(session: Session, context: RepoContext): Promise<void> {
  const projects = await session.api.listProjects()
  const known = new Set(context.config.projects.map((project) => project.id))

  const picked = await vscode.window.showQuickPick(
    [
      ...projects.filter((project) => known.has(project.projectID)),
      ...projects.filter((project) => !known.has(project.projectID)),
    ].map((project) => ({
      label: project.projectName,
      description: project.projectNo,
      detail: `${project.customerName} · ${project.timeNeeded} of ${project.timePlanned} h`,
      project,
    })),
    { title: 'ProSonata: project for this repository', matchOnDescription: true, matchOnDetail: true },
  )
  if (!picked) return

  rememberProject(context.repo.root, { id: picked.project.projectID, name: picked.project.projectName })

  // Without this the hook would only appear at the next window start, and the
  // commits in between would book nothing.
  installHookHere(context.repo.root)
}

function installHookHere(repoRoot: string): void {
  const cli = vscode.Uri.joinPath(extensionUri!, 'dist', 'cli.cjs').fsPath
  try {
    installHook(repoRoot, { node: process.execPath, cli })
  } catch (error) {
    void vscode.window.showWarningMessage(`ProSonata: the post-commit hook could not be installed — ${(error as Error).message}`)
  }
}

async function chooseGrid(_session: Session, context: RepoContext): Promise<void> {
  const options: { label: string; grid: TimeGrid }[] = [
    { label: 'exact', grid: { kind: 'exact' } },
    { label: '5 minutes', grid: { kind: 'minutes', minutes: 5 } },
    { label: '15 minutes', grid: { kind: 'minutes', minutes: 15 } },
    { label: '30 minutes', grid: { kind: 'minutes', minutes: 30 } },
  ]
  const picked = await vscode.window.showQuickPick(options, { title: 'ProSonata: rounding grid' })
  if (picked) setGrid(context.repo.root, picked.grid)
}

async function toggleMode(session: Session, context: RepoContext): Promise<void> {
  if (context.scope.branch === context.mainBranch) {
    void vscode.window.showInformationMessage('ProSonata: on the main branch every commit is its own entry.')
    return
  }

  const next = context.mode === 'branch' ? 'commit' : 'branch'
  const entry = openEntry(session.state(), context.scope)

  // Switching to per-commit closes the open entry — otherwise it would hang
  // there with no prospect of ever being closed (KONZEPT.md §3).
  if (next === 'commit' && entry && entry.text !== '') {
    const text = await vscode.window.showInputBox({
      title: 'ProSonata: final text for the open entry',
      value: entry.text,
    })
    if (text === undefined) return
    session.store.update((state) => close(state, entry.id, text, session.clock.now(), randomUUID))
  }

  setMode(context.repo.root, context.key, next)
}

async function closeEntry(session: Session, context: RepoContext, entryId?: string): Promise<void> {
  const state = session.state()
  const entry = entryId ? state.entries.find((candidate) => candidate.id === entryId) : openEntry(state, context.scope)
  if (!entry) return

  const text = await vscode.window.showInputBox({
    title: 'ProSonata: final text for the invoice',
    prompt: 'The marker disappears and this entry is never written to again.',
    value: entry.text,
  })
  if (text === undefined) return

  session.store.update((current) => close(current, entry.id, text, session.clock.now(), randomUUID))
  await session.flush(true)
}

/** Every 30 seconds: watch HEAD, send what is due, warn if needed. */
async function work(): Promise<void> {
  const active = currentSession()
  const context = currentContext()
  if (!active || !context) return

  watchHead(active, context)
  reload()

  try {
    await active.flush()
  } catch {
    // Sending failures are not worth a popup every 30 seconds; they stay
    // pending and the panel shows the backlog.
  }

  warnAboutLongRun(active, context)
  reload()
}

/**
 * HEAD is watched only while a timer runs — a single file pointer, not an
 * activity watcher (KONZEPT.md §5). On a branch switch the time goes to the old
 * scope and we ask before anything continues.
 */
function watchHead(active: Session, context: RepoContext): void {
  const head = readHead(context.repo.headFile)
  if (head === null || lastHead === head) {
    lastHead ??= head
    return
  }

  const previous = lastHead
  lastHead = head
  if (previous === null) return

  const state = active.state()
  const running = state.timers.find((timer) => timer.startedAt !== null && timer.scope.repoPath === context.scope.repoPath)
  if (!running) return

  // The elapsed time belongs to the branch we came from.
  active.store.update((current) => {
    const timer = current.timers.find((candidate) => candidate.id === running.id)
    if (timer) timer.startedAt = null
    return current
  })

  void vscode.window
    .showInformationMessage(
      `ProSonata: the branch changed. The time so far went to ${running.scope.branch}. Keep counting here?`,
      'Continue here',
      'Stay paused',
    )
    .then((answer) => {
      if (answer === 'Continue here') void vscode.commands.executeCommand('prosonata.start')
    })
}

function warnAboutLongRun(active: Session, context: RepoContext): void {
  const limit = active.config.longRunWarningSeconds
  if (active.seconds(context) < limit) return

  const state = active.state()
  const running = state.timers.find(
    (timer) => timer.startedAt !== null && timer.scope.branch === context.scope.branch,
  )
  if (!running) return

  void vscode.window
    .showWarningMessage(
      `ProSonata: the timer has been running for ${clock(active.seconds(context))} without a commit. Still at it?`,
      'Yes',
      'Pause',
    )
    .then((answer) => {
      if (answer === 'Pause') void vscode.commands.executeCommand('prosonata.pause')
    })
}

/**
 * Hourly, and only while a branch entry is open: notice that a pull request was
 * closed. GitHub deletes the branch on merge, so after a prune the remote ref is
 * gone — which a squash merge does not otherwise reveal (KONZEPT.md §3).
 */
async function prune(): Promise<void> {
  const context = currentContext()
  if (!context || context.scope.branch === context.mainBranch) return

  const active = currentSession()
  if (!active) return
  const entry = openEntry(active.state(), context.scope)
  if (!entry || entry.text === '') return

  fetchPrune(context.repo.root)

  const merged = isMerged(context.repo.root, context.scope.branch, context.mainBranch)
  const gone = remoteBranchGone(context.repo.root, context.scope.branch)
  if (!merged && !gone) return

  const answer = await vscode.window.showInformationMessage(
    `ProSonata: "${entry.text}" looks finished — ${merged ? 'the branch is merged' : 'the remote branch is gone'}. Close the entry?`,
    'Close',
    'Later',
  )
  if (answer === 'Close') await vscode.commands.executeCommand('prosonata.closeEntry')
}

function repairHookIfNeeded(context: vscode.ExtensionContext): void {
  const repo = currentContext()
  if (!repo) return

  const cli = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.cjs').fsPath
  if (!hookNeedsRepair(repo.repo.root, { node: process.execPath, cli })) return

  try {
    installHook(repo.repo.root, { node: process.execPath, cli })
  } catch {
    void vscode.window.showWarningMessage('ProSonata: the post-commit hook could not be repaired.')
  }
}

function readHead(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

/** Reads the state from disk once, then draws. */
function reload(): void {
  try {
    cached = currentSession()?.state() ?? null
  } catch {
    cached = null
  }
  draw()
  panel.refresh()
}

/**
 * Draws from the cached state, counting the running segment up locally. Called
 * every second, so it must not touch the disk.
 */
function draw(): void {
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

  const icon = here?.startedAt ? '$(debug-pause)' : '$(play)'
  const others = running.length > 1 ? ` +${running.length - 1}` : ''
  statusBar.text = `${icon} ${clock(currentSeconds(state, active.clock, context.scope))}${others}`
  statusBar.tooltip = `${context.scope.branch} · ${state.pending.length} waiting to be sent`
  statusBar.show()

  // Only while something actually ticks, so the tree is not redrawn for nothing.
  if (running.length > 0) panel.refresh()
}
