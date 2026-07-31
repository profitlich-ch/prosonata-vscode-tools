import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

import { inProsonataOrder, type Project } from '../core/api.js'
import { DEFAULTS, MissingConfig, paths, readConfig, writeConfig } from '../core/config.js'
import { describeRepo, headSha, subjectOf, trailerOf } from '../core/git.js'
import { installHook } from '../core/hooks.js'
import { readRepoConfig, rememberCategory, rememberProject, setGrid, setMode } from '../core/repo-config.js'
import { NotConfigured, Session, type RepoContext } from '../core/session.js'
import { applyCategory, applyProject, close, openEntry, setText } from '../core/tracking.js'
import { workingTime, type TimeGrid } from '../core/working-time.js'
import type { SendResult } from '../core/sender.js'

/**
 * The command line. Same core as the extension, so a commit from the terminal
 * behaves exactly like one from the editor.
 *
 * The binary is called `prosonata`, not `ps`: `ps` is the Unix process listing,
 * and the npm bin directory usually comes before `/bin` in `$PATH` — a global
 * `ps` would break `ps aux` for anyone who installed this (KONZEPT.md §8).
 */

const USAGE = `prosonata — Zeiterfassung, gebunden an Commits und Branches

  prosonata init                    Konto und dieses Repository einrichten, Hook installieren
  prosonata start                   Timer dieses Branches starten oder fortsetzen
  prosonata pause                   Timer pausieren und das laufende Segment buchen
  prosonata status                  was läuft, was ist offen, was wartet
  prosonata send                    alles senden, was gerade fällig ist

  prosonata project                 Projekt dieses Repositories wählen
  prosonata category                Zeitkategorie dieses Projekts wählen
  prosonata grid [exakt|5|15|30]    auf so viele Minuten runden
  prosonata mode [branch|commit]    ein Eintrag pro Branch oder pro Commit
  prosonata close [Text]            offenen Zeiteintrag abschliessen und senden
  prosonata text <Text>             Text des offenen Zeiteintrags ändern

  prosonata post-commit             wird vom Hook gerufen, nicht zum Tippen gedacht

Was ein Argument nimmt, fragt danach, wenn es weggelassen wird.
`

export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
  const command = argv[0] ?? 'status'
  const argument = argv.slice(1).join(' ').trim()

  try {
    switch (command) {
      case 'init':
        return await init(cwd)
      case 'start':
        return start(cwd)
      case 'pause':
        return pause(cwd)
      case 'status':
        return await status(cwd)
      case 'send':
        return await flush(cwd)
      case 'project':
        return await chooseProject(cwd)
      case 'category':
        return await chooseCategory(cwd)
      case 'grid':
        return await chooseGrid(cwd, argument)
      case 'mode':
        return await chooseMode(cwd, argument)
      case 'close':
        return await closeEntry(cwd, argument)
      case 'text':
        return await changeText(cwd, argument)
      case 'post-commit':
        return await postCommit(cwd)
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(USAGE)
        return 0
      default:
        process.stderr.write(`unbekannter Befehl: ${command}\n\n${USAGE}`)
        return 2
    }
  } catch (error) {
    if (error instanceof MissingConfig || error instanceof NotConfigured) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
    process.stderr.write(`${(error as Error).message}\n`)
    return 1
  }
}

async function init(cwd: string): Promise<number> {
  try {
    process.stdout.write(`Konto bereits eingerichtet: ${readConfig().baseUrl}\n`)
  } catch {
    const baseUrl = await ask('Basis-URL (https://<subdomain>.prosonata.software/api/v1): ')
    const apiKey = await ask('Persönlicher API-Key: ')
    writeConfig({ ...DEFAULTS, baseUrl, apiKey })
    process.stdout.write(`nach ${paths.config()} geschrieben, Modus 0600\n`)
  }

  return await chooseProject(cwd)
}

/**
 * The project of this repository, and with it the category, the hook and — for
 * a repository that already had a project — the correction of everything still
 * unfinished (KONZEPT.md §6).
 */
async function chooseProject(cwd: string): Promise<number> {
  const session = Session.open()
  const repo = describeRepo(cwd)
  if (!repo) return notARepo()

  const projects = await session.api.listProjects()
  if (projects.length === 0) {
    process.stderr.write('keine offenen Projekte gefunden — prüfe den Key und seine Rechte\n')
    return 1
  }

  const project = await pick(projects, (candidate) => `${candidate.projectNo}  ${candidate.projectName}`, 'Projektnummer: ')
  if (!project) return 1

  rememberProject(repo.root, { id: project.projectID, name: project.projectName, no: project.projectNo })

  let categoryId = readRepoConfig(repo.root).categories.get(project.projectID) ?? 0
  if (categoryId <= 0) categoryId = await askForCategory(session, repo.root, project)

  session.store.update((state) => applyProject(state, repo.root, project.projectID, categoryId, session.clock.now()))

  const hook = installHook(repo.root, { node: process.execPath, cli: cliPath() })
  process.stdout.write(`Hook ${HOOK_ACTION[hook.action]}: ${hook.path}\n`)
  process.stdout.write(`bereit — "${project.projectName}" in ${repo.root}\n`)
  return 0
}

/** The time category of the project this repository books to. */
async function chooseCategory(cwd: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const project = (await session.api.listProjects()).find((candidate) => candidate.projectID === context.projectId)
  if (!project) {
    process.stderr.write(`Projekt ${context.projectId} steht nicht mehr in der Liste — wähle eines mit "prosonata project"\n`)
    return 1
  }

  return (await askForCategory(session, context.repo.root, project)) > 0 ? 0 : 1
}

/**
 * Lists the categories that apply to this project's customer and remembers the
 * answer. Returns the chosen id, or 0 when nothing was chosen — the caller then
 * knows that nothing will be sent until there is one.
 */
async function askForCategory(session: Session, repoRoot: string, project: Project): Promise<number> {
  const categories = inProsonataOrder(
    (await session.api.listCategories()).filter(
      (category) => category.linkedCustomerID === null || category.linkedCustomerID === project.customerID,
    ),
  )

  const grouped = categories.some((category) => category.groupName !== null)
  const category = await pick(
    categories,
    (candidate) => candidate.categoryName,
    'Kategorienummer: ',
    grouped ? (candidate) => candidate.groupName : undefined,
  )
  if (!category) {
    process.stderr.write('keine Kategorie gewählt — ProSonata verlangt eine, es wird also nichts gesendet\n')
    return 0
  }

  rememberCategory(repoRoot, project.projectID, category.category, category.categoryName)
  session.store.update((state) =>
    applyCategory(state, repoRoot, project.projectID, category.category, session.clock.now()),
  )
  process.stdout.write(`Kategorie: ${category.categoryName}\n`)
  return category.category
}

/** The rounding grid of this repository. */
async function chooseGrid(cwd: string, argument: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const wanted = argument !== '' ? argument : await ask('Zeitraster — exakt, 5, 15 oder 30 Minuten: ')
  const grid = parseGrid(wanted)
  if (!grid) {
    process.stderr.write(`kein Zeitraster: ${wanted} — nimm "exakt" oder eine Anzahl Minuten\n`)
    return 2
  }

  setGrid(context.repo.root, grid)
  process.stdout.write(`Zeitraster: ${grid.kind === 'exact' ? 'exakt' : `${grid.minutes} min`}\n`)
  return 0
}

/**
 * Whether this branch collects one entry or one per commit. Switching to per
 * commit closes the open entry — otherwise it would hang there with no
 * prospect of ever being closed (KONZEPT.md §3).
 */
async function chooseMode(cwd: string, argument: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  if (context.scope.branch === context.mainBranch) {
    process.stderr.write('auf dem Main-Branch ist jeder Commit sein eigener Eintrag — nichts umzuschalten\n')
    return 1
  }

  const wanted = argument !== '' ? argument : await ask('Modus — branch oder commit: ')
  if (wanted !== 'branch' && wanted !== 'commit') {
    process.stderr.write(`kein Modus: ${wanted} — nimm "branch" oder "commit"\n`)
    return 2
  }
  if (wanted === context.mode) {
    process.stdout.write(`bereits ein Eintrag pro ${wanted === 'branch' ? 'Branch' : 'Commit'}\n`)
    return 0
  }

  if (wanted === 'commit') {
    const entry = openEntry(session.state(), context.scope)
    if (entry && entry.text !== '') {
      const text = (await ask(`Endgültiger Text für den offenen Eintrag [${entry.text}]: `)) || entry.text
      session.store.update((state) => close(state, entry.id, text, session.clock.now(), randomUUID))
    }
  }

  setMode(context.repo.root, context.key, wanted)
  process.stdout.write(`ein Eintrag pro ${wanted === 'branch' ? 'Branch' : 'Commit'} auf ${context.scope.branch}\n`)
  return 0
}

/** Closes the open entry of this branch and sends it right away. */
async function closeEntry(cwd: string, argument: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const entry = openEntry(session.state(), context.scope)
  if (!entry) {
    process.stderr.write(`auf ${context.scope.branch} ist nichts offen\n`)
    return 1
  }

  const text = argument !== '' ? argument : (await ask(`Endgültiger Text${entry.text ? ` [${entry.text}]` : ''}: `)) || entry.text
  if (text === '') {
    process.stderr.write('ein Eintrag ohne Text wird nie gesendet — nichts getan\n')
    return 1
  }

  session.store.update((state) => close(state, entry.id, text, session.clock.now(), randomUUID))
  process.stdout.write(`abgeschlossen: ${text}\n`)
  return report(await session.flush(true))
}

/** Changes the text of the open entry, without closing it. */
async function changeText(cwd: string, argument: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const entry = openEntry(session.state(), context.scope)
  if (!entry) {
    process.stderr.write(`auf ${context.scope.branch} ist nichts offen\n`)
    return 1
  }

  const text = argument !== '' ? argument : await ask(`Text${entry.text ? ` [${entry.text}]` : ''}: `)
  if (text === '') {
    process.stderr.write('kein Text angegeben — nichts geändert\n')
    return 1
  }

  session.store.update((state) => setText(state, entry.id, text, session.clock.now()))
  process.stdout.write(`Text: ${text}\n`)
  return 0
}

function start(cwd: string): number {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  session.start(context)
  process.stdout.write(`läuft auf ${context.scope.branch} — ${nameOfProject(context)}\n`)
  return 0
}

function pause(cwd: string): number {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  session.pause(context)
  process.stdout.write(`pausiert — ${format(session.seconds(context))} auf ${context.scope.branch}\n`)
  return 0
}

async function status(cwd: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const state = session.state()
  const entry = openEntry(state, context.scope)
  const timer = state.timers.find((candidate) => candidate.scope.branch === context.scope.branch)

  process.stdout.write(`${nameOfProject(context)} — ${context.scope.branch} (${context.mode === 'branch' ? 'ein Eintrag pro Branch' : 'ein Eintrag pro Commit'})\n`)
  process.stdout.write(`  ${timer?.startedAt ? 'läuft' : 'pausiert'}  ${format(session.seconds(context))}\n`)
  if (entry) {
    process.stdout.write(`  offener Eintrag  ${entry.text || '(noch kein Text)'}  ${workingTime(entry.foreignSeconds + entry.seconds, context.config.grid ?? session.config.grid)} h\n`)
  }
  if (context.categoryId <= 0) {
    process.stdout.write('  keine Zeitkategorie — es wird nichts gesendet, bis eine gewählt ist\n')
  }
  if (state.pending.length > 0) {
    process.stdout.write(`  wartet auf Versand: ${state.pending.length}\n`)
  }
  return 0
}

async function flush(cwd: string): Promise<number> {
  const session = Session.open()
  if (!session.context(cwd)) return notARepo()

  return report(await session.flush(true))
}

/** What came of a send, in the same words wherever it is triggered from. */
function report(result: SendResult): number {
  for (const problem of result.tooLong) {
    process.stderr.write(`Text zu lang (${problem.length} von ${problem.limit}) — kürze ihn, ProSonata würde ihn wortlos abschneiden\n`)
  }
  if (result.missingCategory.length > 0) {
    process.stderr.write('keine Zeitkategorie für dieses Projekt — wähle eine mit "prosonata category", ProSonata verlangt sie\n')
  }
  for (const failure of result.failed) {
    process.stderr.write(`konnte nicht gesendet werden: ${failure.error.message}\n`)
  }
  process.stdout.write(`gesendet: ${result.sent.length}\n`)
  return result.failed.length > 0 ? 1 : 0
}

/**
 * The hook's entry point. It must never fail the commit, so everything is
 * caught and reported, and the exit code stays 0.
 */
async function postCommit(cwd: string): Promise<number> {
  try {
    const session = Session.open()
    const context = session.context(cwd)
    if (!context) return 0

    const sha = headSha(cwd) ?? ''
    const trailer = trailerOf(cwd, session.config.trailerKey, sha)
    const text = trailer && trailer !== '' ? trailer : subjectOf(cwd, sha)

    const outcome = session.commit(context, { text, fromTrailer: trailer !== null && trailer !== '', sha })

    if (outcome.branchSwitched) {
      process.stderr.write(
        'prosonata: der Branch hatte gewechselt — die bisherige Zeit ging an den Branch, auf dem sie gestartet wurde, und der Timer ist pausiert\n',
      )
    }
    if (!outcome.hadTimer) {
      process.stderr.write('prosonata: es lief kein Timer — dieser Commit hat nichts gebucht\n')
      return 0
    }
    if (outcome.booked > 0) {
      process.stderr.write(`prosonata: ${format(outcome.booked)} gebucht${outcome.closed ? ', Eintrag abgeschlossen' : ''}\n`)
    }
    await session.flush()
    return 0
  } catch (error) {
    process.stderr.write(`prosonata: ${(error as Error).message}\n`)
    return 0
  }
}

/** One question on the terminal. Opened and closed per question, so a command
 *  that asks nothing never touches stdin. */
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/**
 * A numbered list, the way `init` has always shown projects and categories.
 * `group` puts a heading over each block, the terminal's answer to `optgroup`;
 * the numbering runs on through it, because that is what gets typed.
 */
async function pick<T>(
  items: T[],
  label: (item: T) => string,
  question: string,
  group?: (item: T) => string | null,
): Promise<T | null> {
  if (items.length === 0) {
    process.stderr.write('nichts zur Auswahl\n')
    return null
  }

  let heading: string | null | undefined
  items.slice(0, 40).forEach((item, index) => {
    if (group) {
      const name = group(item)
      if (name !== heading) {
        heading = name
        process.stdout.write(`\n  ${name ?? 'Ohne Gruppe'}\n`)
      }
    }
    process.stdout.write(`  ${String(index + 1).padStart(2)}  ${label(item)}\n`)
  })

  const chosen = items[Number(await ask(question)) - 1]
  if (!chosen) process.stderr.write('nichts gewählt\n')
  return chosen ?? null
}

function parseGrid(value: string): TimeGrid | null {
  if (value === 'exact' || value === 'exakt') return { kind: 'exact' }
  const minutes = Number(value)
  return Number.isFinite(minutes) && minutes > 0 ? { kind: 'minutes', minutes } : null
}

/** "24-017 Buchungsmodul" — the number is what a customer call refers to. */
function nameOfProject(context: RepoContext): string {
  const project = context.config.projects.find((candidate) => candidate.id === context.projectId)
  if (!project) return `Projekt ${context.projectId}`
  return project.no ? `${project.no} ${project.name}` : project.name
}

function notARepo(): number {
  process.stderr.write('kein Git-Repository\n')
  return 1
}

/** The core reports what it did in English; the terminal speaks German. */
const HOOK_ACTION: Record<string, string> = {
  created: 'angelegt',
  appended: 'ergänzt',
  updated: 'aktualisiert',
  unchanged: 'unverändert',
}

/** `1:23:45`, the same shape the status bar shows. */
function format(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function cliPath(): string {
  return process.argv[1] ?? ''
}
