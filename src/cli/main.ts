import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

import { inProsonataOrder, type Project } from '../core/api.js'
import { configWith, MissingConfig, paths, readConfig, writeConfig } from '../core/config.js'
import { describeRepo, headSha, subjectOf, trailerOf } from '../core/git.js'
import { installHook } from '../core/hooks.js'
import { readRepoConfig, rememberCategory, rememberProject, setGrid, setMode } from '../core/repo-config.js'
import { noteFor, readAdjustment } from '../core/adjust.js'
import { describeAttachment, describePlan } from '../core/attach.js'
import { describeRunningElsewhere } from '../core/sync.js'
import { billedTime, describeBranch, renderReport } from '../core/report.js'
import { branchesIn } from '../core/segments.js'
import { NotConfigured, Session, type RepoContext } from '../core/session.js'
import {
  applyCategory,
  applyProject,
  awaitingDecision,
  findTimer,
  openEntry,
  runningSeconds,
  setText,
  unwrittenSeconds,
} from '../core/tracking.js'
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
  prosonata pause [h:mm|Minuten]    Timer pausieren; mit Dauer wird nur diese gebucht
  prosonata status                  was läuft, was ist offen, was wartet
  prosonata send                    alles senden, was gerade fällig ist

  prosonata project                 Projekt dieses Repositories wählen
  prosonata category                Zeitkategorie dieses Projekts wählen
  prosonata grid [exakt|5|15|30]    auf so viele Minuten runden
  prosonata mode [branch|commit]    ein Eintrag pro Branch oder pro Commit
  prosonata close [Text]            offenen Zeiteintrag abschliessen und senden
  prosonata text <Text>             Text des offenen Zeiteintrags ändern
  prosonata discard                 laufendes Segment verwerfen, ohne es zu buchen
  prosonata attach                  Zeit seit dem letzten Commit dem Eintrag jenes Commits zuschlagen
  prosonata resume [add|neu]        anderswo abgeschlossenen Eintrag entscheiden
  prosonata log [Branch|alle|?]     gemessene Segmente, ohne Branch die dieses
  prosonata adjust <Wert>           Zeit korrigieren: ±25, ±1:30, "ab 9:40", "bis 9:40"

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
        return await start(cwd)
      case 'pause':
        return pause(cwd, argument)
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
      case 'discard':
        return discard(cwd)
      case 'attach':
        return await attach(cwd)
      case 'resume':
        return await resume(cwd, argument)
      case 'log':
        return log(cwd, argument)
      case 'adjust':
        return adjust(cwd, argument)
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

/**
 * Account and repository. Runs again on a configured machine, because a key
 * gets replaced — expired, rotated, moved to another subdomain. Anything left
 * empty stays as it is, and every setting beside the account survives.
 */
async function init(cwd: string): Promise<number> {
  const known = knownConfig()
  const baseUrl =
    (await ask(`Basis-URL${known ? ` [${known.baseUrl}]` : ' (https://<subdomain>.prosonata.software/api/v1)'}: `)) ||
    known?.baseUrl ||
    ''
  const apiKey = (await ask(`Persönlicher API-Key${known ? ' [unverändert lassen: leer]' : ''}: `)) || known?.apiKey || ''

  if (baseUrl === '' || apiKey === '') {
    process.stderr.write('Basis-URL und API-Key werden beide gebraucht — nichts geändert\n')
    return 2
  }

  writeConfig(configWith(known, { baseUrl, apiKey }))
  process.stdout.write(`nach ${paths.config()} geschrieben, Modus 0600\n`)
  return await chooseProject(cwd)
}

function knownConfig() {
  try {
    return readConfig()
  } catch {
    return null
  }
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
      session.closeEntry(entry.id, text)
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

  session.closeEntry(entry.id, text)
  process.stdout.write(`abgeschlossen: ${text}\n`)
  return report(await session.flush(true))
}

/**
 * Throws the running segment away — nothing booked, timer stopped. For the case
 * "committed, forgot to stop, did no more work": what was measured is wall time.
 *
 * The log keeps the discarded duration; measured time that disappears on purpose
 * must not disappear silently as well (KONZEPT.md §3).
 */
function discard(cwd: string): number {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const running = runningSeconds(session.state(), session.clock, context.scope)
  if (running <= 0) {
    process.stderr.write('es läuft gerade kein Timer\n')
    return 2
  }

  session.keepFromRunning(context, 0)
  process.stdout.write(`${format(running)} verworfen — pausiert, ${format(session.seconds(context))} auf ${context.scope.branch}\n`)
  return 0
}

/**
 * Adds the time measured since the last commit to the entry that commit closed.
 * Asks first: it writes to an entry the tool considers finished.
 */
async function attach(cwd: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const result = await session.attachToLastClosed(context, async (plan) => {
    const answer = await ask(`${describePlan(plan)}\nZuschlagen? [j/N] `)
    return /^(j|ja|y|yes)$/i.test(answer.trim())
  })

  if (result.kind === 'done') {
    process.stdout.write(`zugeschlagen: ${describeAttachment(result)}\n`)
    return 0
  }
  process.stderr.write(`${describeAttachment(result)}\n`)
  return result.kind === 'cancelled' ? 0 : 2
}

/**
 * The answer to "closed on another machine" (KONZEPT.md §3): the time measured
 * here goes either into the entry somebody closed, or into a new one. The tool
 * parks such an entry and writes nothing until this is answered.
 */
async function resume(cwd: string, argument: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const parked = awaitingDecision(session.state(), context.scope)
  if (parked.length === 0) {
    process.stdout.write(`auf ${context.scope.branch} wartet nichts auf eine Entscheidung\n`)
    return 0
  }

  for (const entry of parked) {
    process.stdout.write(
      `"${entry.text || context.scope.branch}" wurde auf einem anderen Rechner abgeschlossen, hier sind noch ${format(unwrittenSeconds(entry))} angefallen\n`,
    )
    const wanted = argument !== '' ? argument : await ask('Hinzufügen oder neu? [add|neu]: ')
    if (wanted !== 'add' && wanted !== 'neu' && wanted !== 'new') {
      process.stderr.write(`keine Antwort: ${wanted} — nimm "add" oder "neu"\n`)
      return 2
    }

    await session.resolveClosedElsewhere(entry.id, wanted === 'add' ? 'add' : 'fresh')
    process.stdout.write(wanted === 'add' ? 'zum bestehenden Eintrag hinzugefügt\n' : 'wird ein neuer Eintrag\n')
  }
  return 0
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

async function start(cwd: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  await session.start(context)
  if (session.runningElsewhereSince !== null) {
    process.stderr.write(`${describeRunningElsewhere(session.runningElsewhereSince, session.clock.now())}\n`)
  }
  process.stdout.write(`läuft auf ${context.scope.branch} — ${nameOfProject(context)}\n`)
  return 0
}

/**
 * Pauses. With a duration only that much of the running segment is booked — the
 * answer to a timer that ran overnight, where wall time is not work time.
 */
function pause(cwd: string, argument: string): number {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  if (argument === '') {
    session.pause(context)
  } else {
    const kept = parseDuration(argument)
    if (kept === null) {
      process.stderr.write(`keine Dauer: ${argument} — nimm "1:30" oder eine Zahl als Minuten\n`)
      return 2
    }
    const running = runningSeconds(session.state(), session.clock, context.scope)
    session.keepFromRunning(context, kept)
    process.stdout.write(`von ${format(running)} wurden ${format(Math.min(kept, running))} gebucht\n`)
  }

  process.stdout.write(`pausiert — ${format(session.seconds(context))} auf ${context.scope.branch}\n`)
  return 0
}

/** `1:30` or `90` — hours and minutes, or plain minutes. */
function parseDuration(value: string): number | null {
  const [hours, minutes] = value.split(':')
  const seconds = minutes === undefined ? Number(hours) * 60 : Number(hours) * 3600 + Number(minutes) * 60
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

async function status(cwd: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const state = session.state()
  const entry = openEntry(state, context.scope)
  // By scope, not by branch name alone: `main` exists in every repository, and
  // the line would report a timer running somewhere else entirely.
  const timer = findTimer(state, context.scope)

  process.stdout.write(`${nameOfProject(context)} — ${context.scope.branch} (${context.mode === 'branch' ? 'ein Eintrag pro Branch' : 'ein Eintrag pro Commit'})\n`)
  process.stdout.write(`  ${timer?.startedAt ? 'läuft' : 'pausiert'}  ${format(session.seconds(context))}\n`)
  if (entry) {
    process.stdout.write(`  offener Eintrag  ${entry.text || '(noch kein Text)'}  ${billedTime(entry.foreignSeconds + entry.seconds, context.config.grid ?? session.config.grid)} h\n`)
  }
  const running = runningSeconds(state, session.clock, context.scope)
  if (running >= session.config.longRunWarningSeconds) {
    process.stdout.write(`  läuft seit ${format(running)} ohne Unterbruch — "prosonata pause [h:mm]" bucht nur einen Teil\n`)
  }
  for (const parked of awaitingDecision(state, context.scope)) {
    process.stdout.write(
      `  anderswo abgeschlossen  ${format(unwrittenSeconds(parked))} offen — "prosonata resume" entscheidet\n`,
    )
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
  if (result.awaitingDecision.length > 0) {
    process.stderr.write('auf einem anderen Rechner abgeschlossen — "prosonata resume" entscheidet, wohin die restliche Zeit geht\n')
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

/**
 * Winds the clock forward or back (KONZEPT.md §3). Same words as in the editor:
 * a signed amount, or `ab`/`bis` with a time of day.
 */
function adjust(cwd: string, argument: string): number {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const offers = readAdjustment(argument, session.clock.now())
  if (offers.length === 0) {
    process.stderr.write(`keine Korrektur: ${argument || '(nichts)'} — nimm "+25", "-1:30", "ab 9:40" oder "bis 9:40"\n`)
    return 2
  }
  if (offers.length > 1) {
    process.stderr.write(`${argument} ist zweideutig — nimm "ab ${argument}" oder "bis ${argument}"\n`)
    return 2
  }

  const wanted = offers[0]!
  const before = session.seconds(context)
  const plan = session.adjust(context, wanted)
  // The note explains why less happened — never more needed than when nothing did.
  const note = noteFor(plan, wanted)
  if (plan.action === 'impossible') {
    process.stderr.write(`ohne laufenden Timer nicht möglich — ${note}\n`)
    return 2
  }
  if (plan.delta === 0 && plan.action !== 'stop') {
    process.stderr.write(`nichts geändert${note === null ? '' : ` — ${note}`}\n`)
    return 1
  }
  if (plan.action === 'stop') {
    const at = plan.at === undefined ? '' : ` um ${new Date(plan.at).toTimeString().slice(0, 5)}`
    process.stdout.write(`Timer angehalten${at}\n`)
  }
  if (note !== null) process.stdout.write(`${note}\n`)

  process.stdout.write(
    `${wanted.label}: ${format(before)} → ${format(session.seconds(context))} auf ${context.scope.branch}\n`,
  )
  return 0
}

/**
 * The segment log. Without an argument the current branch, with `alle` every
 * one the log knows — including branches that git has long forgotten.
 */
function log(cwd: string, argument: string): number {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const segments = session.segments.read().filter((segment) => segment.repoPath === context.repo.root)
  if (segments.length === 0) {
    process.stdout.write('für dieses Repository ist noch kein Segment aufgezeichnet\n')
    return 0
  }

  if (argument === '?' || argument === 'branches') {
    for (const summary of branchesIn(segments, context.repo.root)) {
      process.stdout.write(`  ${summary.branch.padEnd(30)} ${describeBranch(summary)}\n`)
    }
    return 0
  }

  const branch = argument === 'alle' ? null : argument !== '' ? argument : context.scope.branch
  process.stdout.write(renderReport(segments, { branch, grid: context.config.grid ?? session.config.grid }))
  return 0
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
