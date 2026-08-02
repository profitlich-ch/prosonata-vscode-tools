import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as vscode from 'vscode'

import { inProsonataOrder, type Category, type Project } from '../core/api.js'
import { DEFAULTS, MissingConfig, paths, readConfig, writeConfig } from '../core/config.js'
import { describeRepo, fetchPrune, isMerged, remoteBranchGone, type GitRepo } from '../core/git.js'
import { hookNeedsRepair, installHook } from '../core/hooks.js'
import { readRepoConfig, rememberCategory, rememberProject, setGrid, setMode } from '../core/repo-config.js'
import { noteFor, planAdjustment, readAdjustment, type Adjustment } from '../core/adjust.js'
import { describeAttachment, describePlan } from '../core/attach.js'
import { describeBranch, renderReport } from '../core/report.js'
import { branchesIn } from '../core/segments.js'
import { NotConfigured, Session, type RepoContext } from '../core/session.js'
import {
  applyCategory,
  applyProject,
  awaitingDecision,
  close,
  currentSeconds,
  openEntry,
  runningSeconds,
  setText,
  unwrittenSeconds,
} from '../core/tracking.js'
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
/** After "keep it all", the question stays away this long. */
const SNOOZE_MS = 60 * 60 * 1000

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
/** Per branch key: until when the long-run question has been answered with "later". */
const snoozedUntil = new Map<string, number>()

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.command = 'prosonata.toggle'
  context.subscriptions.push(statusBar)

  panel = new Panel(currentSession, currentContext, () => cached)
  context.subscriptions.push(vscode.window.registerTreeDataProvider('prosonata.panel', panel))

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(LOG_SCHEME, logDocuments),
  )

  register(context, 'prosonata.setup', () => setUpAccount())
  register(context, 'prosonata.start', withContext(async (s, c) => void (await s.start(c))))
  register(context, 'prosonata.pause', withContext((s, c) => void s.pause(c)))
  register(context, 'prosonata.toggle', withContext(toggle))
  register(context, 'prosonata.send', withContext(sendNow))
  register(context, 'prosonata.chooseProject', withRepo(chooseProject))
  register(context, 'prosonata.chooseCategory', withRepo((s, r) => chooseCategory(s, r)))
  register(context, 'prosonata.chooseGrid', withRepo(chooseGrid))
  register(context, 'prosonata.toggleMode', withContext(toggleMode))
  register(context, 'prosonata.closeEntry', withContext(closeEntry))
  register(context, 'prosonata.changeText', withContext(changeText))
  register(context, 'prosonata.resolveClosedElsewhere', withContext(askAboutClosedElsewhere))
  register(context, 'prosonata.attachToLast', withContext(attachToLast))
  register(context, 'prosonata.log', withRepo(showLog))
  register(context, 'prosonata.adjust', withContext(adjustTime))

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

  /*
   * Once per window: does ProSonata already hold an open entry for this branch —
   * from the other machine, or from a state file that was lost? Without it the
   * panel would show a fresh timer next to an entry that has been growing for
   * days (KONZEPT.md §3). One call per window, not per beat.
   */
  void syncOnOpen()
}

async function syncOnOpen(): Promise<void> {
  const active = currentSession()
  const context = currentContext()
  if (!active || !context) return

  await active.syncQuietly(context)
  reload()
  warnAboutRunningElsewhere(active)
  await askAboutClosedElsewhere(active, context)
  await askAboutLongRun(active, context)
}

/**
 * Somebody closed the entry on another machine while time was running here.
 * Where that time goes is not ours to decide (KONZEPT.md §3) — and the place it
 * is noticed, the sender, may well be the `post-commit` hook, where nobody can
 * answer. So the entry waits, and the question is asked here.
 */
async function askAboutClosedElsewhere(session: Session, context: RepoContext): Promise<void> {
  for (const entry of awaitingDecision(session.state(), context.scope)) {
    const rest = clock(unwrittenSeconds(entry))
    const answer = await vscode.window.showInformationMessage(
      `ProSonata: „${entry.text || context.scope.branch}" wurde auf einem anderen Rechner abgeschlossen. Hier sind noch ${rest} angefallen.`,
      { modal: false },
      'Zum bestehenden Eintrag',
      'Neuer Eintrag',
    )
    if (answer === undefined) continue

    try {
      await session.resolveClosedElsewhere(entry.id, answer === 'Zum bestehenden Eintrag' ? 'add' : 'fresh')
    } catch (error) {
      void vscode.window.showWarningMessage(`ProSonata: ${(error as Error).message}`)
    }
    reload()
  }
}

export function deactivate(): void {
  /*
   * Stopping is the careful direction. A timer that survives the closing of the
   * editor is the classic way to book a night — while starting stays a decision
   * nobody takes for you (KONZEPT.md §5). `pause` writes the state file itself,
   * so the segment is booked before this process is gone.
   */
  const active = currentSession()
  const context = currentContext()
  if (active?.config.pauseOnWindowClose && context) active.pause(context)

  // Closing VS Code is one of the send triggers (KONZEPT.md §4).
  void active?.flush(true)
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
 * Sets up the account from inside the editor, so the terminal is never needed.
 * The key goes to ~/.prosonata/config.json with mode 0600 — not to VS Code's
 * SecretStorage, which the hook could not read (KONZEPT.md §7).
 */
async function setUpAccount(): Promise<void> {
  const baseUrl = await vscode.window.showInputBox({
    title: 'ProSonata: Basis-URL',
    prompt: 'Bis und mit /api/v1',
    placeHolder: 'https://<subdomain>.prosonata.software/api/v1',
    value: readIfPresent()?.baseUrl ?? '',
    ignoreFocusOut: true,
  })
  if (baseUrl === undefined) return

  const apiKey = await vscode.window.showInputBox({
    title: 'ProSonata: persönlicher API-Key',
    prompt: 'Ein Benutzer-Key, keine App-Integration — eine Integration ist kein Benutzer',
    password: true,
    ignoreFocusOut: true,
  })
  if (apiKey === undefined) return

  writeConfig({ ...DEFAULTS, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() })
  session = null
  reload()
  void vscode.window.showInformationMessage(
    `ProSonata: nach ${paths.config()} geschrieben. Wähle jetzt ein Projekt für dieses Repository.`,
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

/**
 * For commands that set a repository up. They must not require a configured
 * project — choosing one is exactly what they are for.
 */
function withRepo(action: (session: Session, repo: GitRepo) => Promise<void> | void): () => Promise<void> {
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

async function toggle(session: Session, context: RepoContext): Promise<void> {
  const running = session.state().timers.find(
    (timer) => timer.scope.repoPath === context.scope.repoPath && timer.scope.branch === context.scope.branch && timer.startedAt !== null,
  )
  if (running) session.pause(context)
  else await session.start(context)
}

async function sendNow(session: Session, context: RepoContext): Promise<void> {
  const result = await session.flush(true)
  for (const problem of result.tooLong) {
    void vscode.window.showWarningMessage(
      `ProSonata: der Text hat ${problem.length} Zeichen, erlaubt sind ${problem.limit}. ` +
        'ProSonata würde ihn wortlos abschneiden, deshalb wurde nichts gesendet. Kürze ihn.',
    )
  }
  await askAboutClosedElsewhere(session, context)
  if (result.missingCategory.length > 0) {
    void vscode.window
      .showWarningMessage(
        'ProSonata: für dieses Projekt ist keine Zeitkategorie gewählt — ProSonata verlangt eine, deshalb wurde nichts gesendet.',
        'Kategorie wählen',
      )
      .then((answer) => {
        if (answer === 'Kategorie wählen') void vscode.commands.executeCommand('prosonata.chooseCategory')
      })
  }
  for (const failure of result.failed) {
    void vscode.window.showWarningMessage(`ProSonata: ${failure.error.message}`)
  }
}

async function chooseProject(session: Session, repo: GitRepo): Promise<void> {
  const projects = await session.api.listProjects()
  const known = new Set(readRepoConfig(repo.root).projects.map((project) => project.id))

  const picked = await vscode.window.showQuickPick(
    [
      ...projects.filter((project) => known.has(project.projectID)),
      ...projects.filter((project) => !known.has(project.projectID)),
    ].map((project) => ({
      label: project.projectName,
      description: project.projectNo,
      detail: `${project.customerName} · ${project.timeNeeded} von ${project.timePlanned} h`,
      project,
    })),
    { title: 'ProSonata: Projekt für dieses Repository', matchOnDescription: true, matchOnDetail: true },
  )
  if (!picked) return

  rememberProject(repo.root, { id: picked.project.projectID, name: picked.project.projectName, no: picked.project.projectNo })

  // Without this the hook would only appear at the next window start, and the
  // commits in between would book nothing.
  installHookHere(repo.root)

  // Choosing a project is a correction of a mistake: time already measured
  // belongs to this work, not to the project picked by accident. Everything
  // unfinished moves along, including what ProSonata already knows.
  const remembered = readRepoConfig(repo.root).categories.get(picked.project.projectID) ?? 0
  session.store.update((state) =>
    applyProject(state, repo.root, picked.project.projectID, remembered, session.clock.now()),
  )

  // A project without a category books nothing either: ProSonata requires one.
  // Asking right here keeps the editor route as complete as "prosonata init".
  if (remembered <= 0) await chooseCategory(session, repo, picked.project)
}

/**
 * The category belongs to the timer, not to the repository (KONZEPT.md §6): it
 * changes within the same project, so the last choice stays and starting is one
 * click. Remembered per project, because maintenance is booked differently from
 * feature work.
 */
async function chooseCategory(session: Session, repo: GitRepo, project?: Project): Promise<void> {
  const config = readRepoConfig(repo.root)
  const projectId = project?.projectID ?? config.activeProjectId
  if (projectId === null) {
    await chooseProject(session, repo)
    return
  }

  // The list is global; only the customer of the active project narrows it.
  const customerId = project?.customerID ?? (await session.api.listProjects()).find((candidate) => candidate.projectID === projectId)?.customerID
  const categories = (await session.api.listCategories()).filter(
    (category) => category.linkedCustomerID === null || category.linkedCustomerID === customerId,
  )
  if (categories.length === 0) {
    void vscode.window.showWarningMessage('ProSonata: dieses Konto hat keine aktiven Zeitkategorien.')
    return
  }

  const current = config.categories.get(projectId)
  const picked = await vscode.window.showQuickPick(
    groupedItems(categories, current),
    { title: `ProSonata: Zeitkategorie für ${project?.projectName ?? config.projects.find((p) => p.id === projectId)?.name ?? `#${projectId}`}` },
  )
  if (!picked?.category) return

  rememberCategory(repo.root, projectId, picked.category.category, picked.category.categoryName)
  session.store.update((state) => applyCategory(state, repo.root, projectId, picked.category!.category, session.clock.now()))
}

/**
 * The categories under their group, the way a `<select>` groups its options: a
 * separator item is a heading VS Code draws but never lets anyone select.
 *
 * The order is ProSonata's own — `group` orders the groups, `categoryOrder`
 * orders inside one. Sorting the group names alphabetically would look tidy and
 * be a different list than the one the customer knows. Headings appear only
 * where there is something to head; an account without groups keeps a plain
 * list instead of one heading over everything.
 */
function groupedItems(categories: Category[], current: number | undefined): (vscode.QuickPickItem & { category?: Category })[] {
  const sorted = inProsonataOrder(categories)
  const grouped = sorted.some((category) => category.groupName !== null)

  const items: (vscode.QuickPickItem & { category?: Category })[] = []
  let group: string | null | undefined
  for (const category of sorted) {
    if (grouped && category.groupName !== group) {
      group = category.groupName
      items.push({ label: group ?? 'Ohne Gruppe', kind: vscode.QuickPickItemKind.Separator })
    }
    items.push({
      label: category.categoryName,
      description: category.category === current ? 'aktuell' : '',
      category,
    })
  }
  return items
}

/**
 * Winding the clock forward or back (KONZEPT.md §3).
 *
 * One control for both: without typing it offers steps and, when nothing is
 * running, the time since the last commit — the case KONZEPT.md §5 has been
 * promising all along. Typing turns the same list into an input: a number
 * becomes plus and minus, a clock time becomes "ab 9:40 dazuzählen" and "nur
 * bis 9:40 zählen", each with the amount worked out.
 */
async function adjustTime(session: Session, context: RepoContext): Promise<void> {
  const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { adjustment?: Adjustment }>()
  pick.title = 'ProSonata: Zeit korrigieren'
  pick.placeholder = '±Minuten, ±h:mm, «ab 9:40» oder «bis 9:40»'
  pick.items = standingOffers(session, context)
  pick.onDidChangeValue((value) => {
    const offers = readAdjustment(value, session.clock.now())
    const possible = offers.filter((offer) => planAdjustment(offer, session.situation(context)).action !== 'impossible')

    /*
     * A QuickPick filters its items against what was typed, so a line whose
     * label does not contain "17:15" disappears the moment it is typed. The
     * refusal therefore belongs in the title, which stays visible — not in a
     * line that cannot be shown anyway.
     */
    pick.title =
      offers.length > 0 && possible.length === 0
        ? 'ProSonata: ohne laufenden Timer keine Uhrzeit — nimm eine Dauer, etwa -0:06'
        : 'ProSonata: Zeit korrigieren'
    pick.items = possible.length === 0 && offers.length === 0
      ? standingOffers(session, context)
      : possible.map((offer) => describe(offer, session, context))
  })

  const chosen = await new Promise<Adjustment | undefined>((resolve) => {
    pick.onDidAccept(() => resolve(pick.selectedItems[0]?.adjustment))
    pick.onDidHide(() => resolve(undefined))
    pick.show()
  })
  pick.dispose()
  if (chosen === undefined) return

  const before = currentSeconds(session.state(), session.clock, context.scope)
  const plan = session.adjust(context, chosen)
  reload()

  const note = noteFor(plan, chosen)
  if (plan.action === 'impossible' || (plan.delta === 0 && plan.action !== 'stop')) {
    void vscode.window.showWarningMessage(
      `ProSonata: nichts geändert${note === null ? '.' : ` — ${note}.`}`,
    )
    return
  }

  const after = currentSeconds(session.state(), session.clock, context.scope)
  const stopped = plan.action === 'stop' && plan.at !== undefined ? `, angehalten um ${hourOf(plan.at)}` : ''
  void vscode.window.setStatusBarMessage(`ProSonata: ${clock(before)} → ${clock(after)}${stopped}`, 4000)
}

/** `17:17` — the hour a plan settles on. */
function hourOf(at: number): string {
  return new Date(at).toTimeString().slice(0, 5)
}

/**
 * The list before anything is typed. Only amounts: they work in either state,
 * while a time of day needs a running segment to refer to.
 */
function standingOffers(
  session: Session,
  context: RepoContext,
): (vscode.QuickPickItem & { adjustment?: Adjustment })[] {
  const offers: Adjustment[] = [-15, -5, 5, 15].map((minutes) => ({
    kind: 'amount',
    seconds: minutes * 60,
    label: `${minutes > 0 ? '+' : '−'}${Math.abs(minutes)} Minuten`,
  }))

  return offers.map((offer) => describe(offer, session, context))
}

/** Every line says what it will do before it is chosen. */
function describe(
  adjustment: Adjustment,
  session: Session,
  context: RepoContext,
): vscode.QuickPickItem & { adjustment: Adjustment } {
  const now = currentSeconds(session.state(), session.clock, context.scope)
  const plan = planAdjustment(adjustment, session.situation(context))

  /*
   * For a stop, the hour that will be recorded — which is not always the hour
   * that was typed: a timer that started later cannot end earlier than it began.
   */
  const stopped = plan.action === 'stop' && plan.at !== undefined ? ` · hält um ${hourOf(plan.at)} an` : ''

  return {
    label: adjustment.label,
    description: `${clock(now)} → ${clock(Math.max(0, now + plan.delta))}${stopped}`,
    // Right in the line: why less will happen than the words promise.
    detail: noteFor(plan, adjustment) ?? '',
    adjustment,
  }
}

/**
 * The segment log (KONZEPT.md §7). The branches come from the log, not from git,
 * so a branch that was deleted long ago still has its hours here.
 *
 * Shown as VS Code's own markdown preview, not as a webview of ours: the table
 * is set, the headings are headings, and it can still be searched, copied and
 * printed. The text behind it stays reachable over the preview's own button.
 */
async function showLog(session: Session, repo: GitRepo): Promise<void> {
  const segments = session.segments.read().filter((segment) => segment.repoPath === repo.root)
  if (segments.length === 0) {
    void vscode.window.showInformationMessage('ProSonata: für dieses Repository ist noch kein Segment aufgezeichnet.')
    return
  }

  const branches = branchesIn(segments, repo.root)
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Alle Branches', description: describeBranch({ branch: '', repoPath: repo.root, seconds: segments.reduce((sum, s) => sum + s.seconds, 0), last: branches[0]!.last }), branch: null as string | null },
      ...branches.map((summary) => ({
        label: summary.branch,
        description: describeBranch(summary),
        branch: summary.branch as string | null,
      })),
    ],
    { title: 'ProSonata: Log — Branch wählen' },
  )
  if (!picked) return

  const grid = readRepoConfig(repo.root).grid ?? session.config.grid
  const uri = logDocuments.set(picked.branch ?? 'Alle Branches', renderReport(segments, { branch: picked.branch, grid }))
  try {
    await vscode.commands.executeCommand('markdown.showPreview', uri)
  } catch {
    // The preview belongs to a built-in extension. Where it is missing — a
    // stripped build, a remote without it — the text is still worth showing.
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true })
  }
}

/**
 * The log as a document VS Code owns but nobody can write to. An untitled
 * document would look editable, keep the typing, and ask whether to save a file
 * that does not exist — for an archive that is only ever appended to
 * (KONZEPT.md §3), that is the wrong offer.
 *
 * The same branch reuses its URI, so opening the log twice refreshes the tab
 * instead of stacking a second one.
 */
const LOG_SCHEME = 'prosonata'

class LogDocuments implements vscode.TextDocumentContentProvider {
  private readonly texts = new Map<string, string>()
  private readonly changed = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.changed.event

  set(title: string, text: string): vscode.Uri {
    // The suffix is what gives the tab its markdown highlighting; a branch name
    // carries slashes, which would otherwise become path segments.
    const uri = vscode.Uri.parse(`${LOG_SCHEME}:${encodeURIComponent(title)}.md`)
    this.texts.set(uri.toString(), text)
    this.changed.fire(uri)
    return uri
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.toString()) ?? ''
  }
}

const logDocuments = new LogDocuments()

function installHookHere(repoRoot: string): void {
  const cli = vscode.Uri.joinPath(extensionUri!, 'dist', 'cli.cjs').fsPath
  try {
    installHook(repoRoot, { node: process.execPath, cli })
  } catch (error) {
    void vscode.window.showWarningMessage(`ProSonata: der post-commit-Hook konnte nicht installiert werden — ${(error as Error).message}`)
  }
}

async function chooseGrid(_session: Session, repo: GitRepo): Promise<void> {
  const options: { label: string; grid: TimeGrid }[] = [
    { label: 'exakt', grid: { kind: 'exact' } },
    { label: '5 Minuten', grid: { kind: 'minutes', minutes: 5 } },
    { label: '15 Minuten', grid: { kind: 'minutes', minutes: 15 } },
    { label: '30 Minuten', grid: { kind: 'minutes', minutes: 30 } },
  ]
  const picked = await vscode.window.showQuickPick(options, { title: 'ProSonata: Zeitraster' })
  if (picked) setGrid(repo.root, picked.grid)
}

async function toggleMode(session: Session, context: RepoContext): Promise<void> {
  if (context.scope.branch === context.mainBranch) {
    void vscode.window.showInformationMessage('ProSonata: auf dem Main-Branch ist jeder Commit sein eigener Eintrag.')
    return
  }

  const next = context.mode === 'branch' ? 'commit' : 'branch'
  const entry = openEntry(session.state(), context.scope)

  // Switching to per-commit closes the open entry — otherwise it would hang
  // there with no prospect of ever being closed (KONZEPT.md §3).
  if (next === 'commit' && entry && entry.text !== '') {
    const text = await vscode.window.showInputBox({
      title: 'ProSonata: endgültiger Text für den offenen Eintrag',
      value: entry.text,
    })
    if (text === undefined) return
    session.store.update((state) => close(state, entry.id, text, session.clock.now(), randomUUID))
  }

  setMode(context.repo.root, context.key, next)
}

/**
 * The text of the open entry, without closing it. A typo in a trailer would
 * otherwise only be correctable by another commit — or by closing an entry that
 * is not finished at all.
 */
async function changeText(session: Session, context: RepoContext, entryId?: string): Promise<void> {
  const state = session.state()
  const entry = entryId ? state.entries.find((candidate) => candidate.id === entryId) : openEntry(state, context.scope)
  if (!entry || entry.state === 'closed') {
    void vscode.window.showInformationMessage(`ProSonata: auf ${context.scope.branch} ist nichts offen.`)
    return
  }

  const text = await vscode.window.showInputBox({
    title: 'ProSonata: Text des offenen Eintrags',
    prompt: 'Der Eintrag bleibt offen; ein späterer Trailer ersetzt diesen Text weiterhin.',
    value: entry.text,
  })
  if (text === undefined || text === '') return

  session.store.update((current) => setText(current, entry.id, text, session.clock.now()))
}

async function closeEntry(session: Session, context: RepoContext, entryId?: string): Promise<void> {
  const state = session.state()
  const entry = entryId ? state.entries.find((candidate) => candidate.id === entryId) : openEntry(state, context.scope)
  if (!entry) return

  const text = await vscode.window.showInputBox({
    title: 'ProSonata: endgültiger Text für die Rechnung',
    prompt: 'Der Marker verschwindet, und dieser Eintrag wird nie wieder geschrieben.',
    value: entry.text,
  })
  if (text === undefined) return

  session.store.update((current) => close(current, entry.id, text, session.clock.now(), randomUUID))
  await session.flush(true)
}

/**
 * Adds the time measured since the last commit to the entry that commit closed
 * (KONZEPT.md §3). Modal on purpose: it writes to an entry the tool has already
 * declared finished, and the grid may swallow the whole amount — both belong in
 * front of the click, not in a message afterwards.
 */
async function attachToLast(session: Session, context: RepoContext): Promise<void> {
  const result = await session.attachToLastClosed(context, async (plan) => {
    const answer = await vscode.window.showWarningMessage(
      'Zeit dem letzten Eintrag zuschlagen?',
      { modal: true, detail: describePlan(plan) },
      'Zuschlagen',
    )
    return answer === 'Zuschlagen'
  })

  if (result.kind === 'done') void vscode.window.showInformationMessage(`ProSonata: ${describeAttachment(result)}`)
  else if (result.kind !== 'cancelled') void vscode.window.showWarningMessage(`ProSonata: ${describeAttachment(result)}`)
  reload()
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

  await askAboutLongRun(active, context)
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
      `ProSonata: der Branch hat gewechselt. Die bisherige Zeit ging an ${running.scope.branch}. Hier weiterzählen?`,
      'Hier weiterzählen',
      'Pausiert lassen',
    )
    .then((answer) => {
      if (answer === 'Hier weiterzählen') void vscode.commands.executeCommand('prosonata.start')
    })
}

/**
 * Somebody is measuring on this branch on another machine — the last write left
 * a `workingTimeStart` in ProSonata and we are not the ones running. Only a
 * warning: stopping a timer on a machine that is asleep is not possible, and
 * what those hours were can only be answered by whoever sat there.
 */
function warnAboutRunningElsewhere(active: Session): void {
  const since = active.runningElsewhereSince
  if (since === null) return

  void vscode.window.showWarningMessage(
    `ProSonata: auf einem anderen Rechner läuft seit ${since.slice(0, 5)} ein Timer auf diesem Branch.`,
  )
}

/**
 * A segment that has been running for hours (KONZEPT.md §3).
 *
 * The old warning compared the whole entry against the limit — a branch that
 * holds twenty hours would have warned a second after every start, every thirty
 * seconds, until nobody read it any more. What says something is the **running
 * segment**: it began at the last start or the last commit.
 *
 * And the question is not "still at it?" but how much of it counts. A timer
 * that ran overnight measured wall time; only the person who was there knows
 * what of it was work, so the tool asks instead of guessing.
 */
async function askAboutLongRun(active: Session, context: RepoContext): Promise<void> {
  const running = runningSeconds(active.state(), active.clock, context.scope)
  if (running < active.config.longRunWarningSeconds) return
  if ((snoozedUntil.get(context.key) ?? 0) > active.clock.now()) return

  const answer = await vscode.window.showWarningMessage(
    `ProSonata: der Timer läuft seit ${clock(running)} ohne Unterbruch. Wie viel davon zählt?`,
    'Alles behalten',
    'Anders angeben',
    'Verwerfen',
  )

  // No answer counts as "later": asking again in thirty seconds would nag.
  if (answer === undefined || answer === 'Alles behalten') {
    snoozedUntil.set(context.key, active.clock.now() + SNOOZE_MS)
    return
  }

  const kept = answer === 'Verwerfen' ? 0 : await askForDuration(running)
  if (kept === null) return

  active.keepFromRunning(context, kept)
  reload()
}

/** `1:30` or `90` — hours and minutes, or plain minutes. Null when cancelled. */
async function askForDuration(running: number): Promise<number | null> {
  const given = await vscode.window.showInputBox({
    title: 'ProSonata: wie viel davon zählt?',
    prompt: 'Stunden:Minuten, oder eine Zahl als Minuten',
    value: clock(running).slice(0, -3),
  })
  if (given === undefined) return null

  const [hours, minutes] = given.split(':')
  const seconds = minutes === undefined ? Number(hours) * 60 : Number(hours) * 3600 + Number(minutes) * 60
  if (!Number.isFinite(seconds) || seconds < 0) {
    void vscode.window.showWarningMessage(`ProSonata: „${given}" ist keine Dauer — nichts geändert.`)
    return null
  }
  return seconds
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
    `ProSonata: "${entry.text}" sieht fertig aus — ${merged ? 'der Branch ist gemerged' : 'der Remote-Branch ist weg'}. Eintrag abschliessen?`,
    'Abschliessen',
    'Später',
  )
  if (answer === 'Abschliessen') await vscode.commands.executeCommand('prosonata.closeEntry')
}

function repairHookIfNeeded(context: vscode.ExtensionContext): void {
  const repo = currentContext()
  if (!repo) return

  const cli = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.cjs').fsPath
  if (!hookNeedsRepair(repo.repo.root, { node: process.execPath, cli })) return

  try {
    installHook(repo.repo.root, { node: process.execPath, cli })
  } catch {
    void vscode.window.showWarningMessage('ProSonata: der post-commit-Hook konnte nicht repariert werden.')
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
  const active = currentSession()
  try {
    cached = active?.state() ?? null
  } catch {
    cached = null
  }

  // Drives the `when` clauses of the welcome content in package.json.
  void vscode.commands.executeCommand('setContext', 'prosonata.hasAccount', active !== null)
  void vscode.commands.executeCommand('setContext', 'prosonata.hasProject', currentContext() !== null)

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
