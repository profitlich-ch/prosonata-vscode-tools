import * as vscode from 'vscode'

import { paths } from '../core/config.js'
import { LOG_SCHEME, logDocuments, showLog } from './log-view.js'
import { Panel } from './panel.js'
import { adjustTime, discardRunning } from './adjust-ui.js'
import { browseEntries } from './browse.js'
import {
  askAboutClosedElsewhere,
  attachToLast,
  changeText,
  closeEntry,
  openSettings,
  resolveSleep,
  sendNow,
  toggle,
  toggleMode,
} from './entries.js'
import { chooseCategory, chooseGrid, chooseProject, repairHookIfNeeded, setUpAccount } from './setup.js'
import {
  budgetOf,
  cachedState,
  currentContext,
  currentSession,
  draw,
  mount,
  reload,
  withContext,
  withRepo,
} from './view.js'
import { noticeSleep, prune, syncOnOpen, work } from './watch.js'

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

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.command = 'prosonata.toggle'
  context.subscriptions.push(statusBar)

  const panel = new Panel(currentSession, currentContext, cachedState, budgetOf)
  context.subscriptions.push(vscode.window.registerTreeDataProvider('prosonata.panel', panel))

  mount(context.extensionUri, statusBar, panel)

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(LOG_SCHEME, logDocuments),
  )

  register(context, 'prosonata.setup', () => setUpAccount())
  register(context, 'prosonata.openSettings', () => openSettings())
  register(context, 'prosonata.resolveSleep', () => resolveSleep())
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
  register(context, 'prosonata.browse', withContext(browseEntries))
  register(context, 'prosonata.adjust', withContext(adjustTime))
  register(context, 'prosonata.discard', withContext((s, c) => discardRunning(s, c, true)))

  /*
   * The hook records absolute paths, which break when Node's version changes,
   * for instance through nvm. Repair it quietly instead of failing silently at
   * the next commit (KONZEPT.md §8). This also refreshes the copy of the CLI
   * that every hook calls, which is how an update reaches repositories that are
   * never opened here.
   */
  repairHookIfNeeded()

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

  const drawer = setInterval(() => {
    noticeSleep()
    draw()
  }, DRAW_MS)
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
/*
 * `unknown[]` on purpose: VS Code hands a command whatever the caller passed —
 * a tree item, an entry id — and the wrappers in `view.ts` forward it. A
 * signature without parameters would drop it at this last step instead.
 */
function register(
  context: vscode.ExtensionContext,
  id: string,
  handler: (...args: never[]) => Promise<void> | void,
): void {
  context.subscriptions.push(vscode.commands.registerCommand(id, handler))
}
