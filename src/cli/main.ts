import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { inProsonataOrder, type Project } from '../core/api.js'
import { configWith, MissingConfig, paths, readConfig, writeConfig } from '../core/config.js'
import { describeRepo, headSha, subjectOf, trailerOf } from '../core/git.js'
import { installHook, isInstalled, publishCli, publishedCli } from '../core/hooks.js'
import { readRepoConfig, rememberCategory, rememberProject, setGrid, setMode } from '../core/repo-config.js'
import type { EntryMode, TimeEntry } from '../core/types.js'
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
  entriesToMove,
  findTimer,
  openBranchEntries,
  openEntry,
  rejectedEntries,
  runningSeconds,
  setText,
  unfinishedOnOtherProject,
  unwrittenSeconds,
} from '../core/tracking.js'
import { workingTime, type TimeGrid } from '../core/working-time.js'
import { describeRejection, type SendResult } from '../core/sender.js'
import { t } from '../core/l10n.js'

/**
 * The command line. Same core as the extension, so a commit from the terminal
 * behaves exactly like one from the editor.
 *
 * The binary is called `prosonata`, not `ps`: `ps` is the Unix process listing,
 * and the npm bin directory usually comes before `/bin` in `$PATH` — a global
 * `ps` would break `ps aux` for anyone who installed this (KONZEPT.md §8).
 */

/** A function, not a constant: `t()` must run after index.ts has chosen the language. */
function usage(): string {
  return t('prosonata — time tracking tied to commits and branches\n\n  prosonata init                    set up the account and this repository, install the hook\n  prosonata start                   start or resume the timer of this branch\n  prosonata pause [h:mm|minutes]    pause the timer; with a duration only that much is booked\n  prosonata status                  what is running, what is open, what is waiting\n  prosonata send                    send everything that is due\n\n  prosonata project                 choose the project of this repository\n  prosonata category                choose the time category of this project\n  prosonata grid [exact|5|15|30]    round to this many minutes\n  prosonata mode [branch|day|commit] one entry per branch, per branch and day, or per commit\n  prosonata close [no] [text]       close the open time entry and send it; with no the one of another branch\n  prosonata text <text>             change the text of the open time entry\n  prosonata discard                 discard the running segment without booking it\n  prosonata attach                  attach the time since the last commit to the entry of that commit\n  prosonata resume [add|new]        decide on an entry closed elsewhere\n  prosonata rejected [no retry|move|drop]\n                                    rejected entries: send again, move to another project, discard\n  prosonata resting [no close|keep|drop]\n                                    entries dormant for weeks: close, keep, discard\n  prosonata tidy                    remove empty remainders of deleted branches in all repositories\n  prosonata log [branch|all|?]      measured segments, without a branch those of this one\n  prosonata adjust <value>          adjust the time: ±25, ±1:30, "from 9:40", "until 9:40"\n\n  prosonata post-commit             called by the hook, not meant for typing\n\nAnything that takes an argument asks for it when left out.\n')
}

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
      case 'rejected':
        return await rejected(argument)
      case 'resting':
        return await resting(argument)
      case 'tidy':
        return tidy()
      case 'log':
        return log(cwd, argument)
      case 'adjust':
        return adjust(cwd, argument)
      case 'post-commit':
        return await postCommit(cwd)
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(usage())
        return 0
      default:
        process.stderr.write(`${t('unknown command: {0}', command)}\n\n${usage()}`)
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
    (await ask(known ? t('Base URL [{0}]: ', known.baseUrl) : t('Base URL (https://<subdomain>.prosonata.software/api/v1): '))) ||
    known?.baseUrl ||
    ''
  const apiKey = (await ask(known ? t('Personal API key [leave unchanged: empty]: ') : t('Personal API key: '))) || known?.apiKey || ''

  if (baseUrl === '' || apiKey === '') {
    process.stderr.write(`${t('base URL and API key are both needed — nothing changed')}\n`)
    return 2
  }

  writeConfig(configWith(known, { baseUrl, apiKey }))
  process.stdout.write(`${t('written to {0}, mode 0600', paths.config())}\n`)
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
    process.stderr.write(`${t('no open projects found — check the key and its permissions')}\n`)
    return 1
  }

  const project = await pick(projects, (candidate) => `${candidate.projectNo}  ${candidate.projectName}`, t('Project number: '))
  if (!project) return 1

  /*
   * A switch is a correction as often as it is new work, so it is asked — and
   * before anything is written, so that no answer cancels it (KONZEPT.md §6).
   */
  const others = unfinishedOnOtherProject(session.state(), repo.root, project.projectID)
  let carry = false
  if (others.length > 0) {
    const answer = (
      await ask(
        others.length === 1
          ? t('one unfinished entry is on another project — take it along (t), leave it there (l)? ')
          : t('{0} unfinished entries are on another project — take them along (t), leave them there (l)? ', others.length),
      )
    ).toLowerCase()
    // The letters of both languages: `t`/`l` in English, `m`/`d` in German.
    const takeAlong = answer === 't' || answer === 'm'
    if (!takeAlong && answer !== 'l' && answer !== 'd') {
      process.stdout.write(`${t('nothing changed')}\n`)
      return 1
    }
    carry = takeAlong
  }

  rememberProject(repo.root, { id: project.projectID, name: project.projectName, no: project.projectNo })

  let categoryId = readRepoConfig(repo.root).categories.get(project.projectID) ?? 0
  if (categoryId <= 0) categoryId = await askForCategory(session, repo.root, project)

  if (carry) {
    session.store.update((state) => applyProject(state, repo.root, project.projectID, categoryId, session.clock.now()))
  }

  const cli = publishCliOrOwnPath()
  const hook = installHook(repo.root, { node: process.execPath, cli })
  process.stdout.write(`${HOOK_LINE[hook.action](hook.path)}\n`)
  if (hook.excluded) {
    process.stdout.write(`  ${t('lies in the working tree (core.hooksPath) and is listed in .git/info/exclude')}\n`)
  }
  process.stdout.write(`${t('ready — "{0}" in {1}', project.projectName, repo.root)}\n`)
  return 0
}

/** The time category of the project this repository books to. */
async function chooseCategory(cwd: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const project = (await session.api.listProjects()).find((candidate) => candidate.projectID === context.projectId)
  if (!project) {
    process.stderr.write(`${t('project {0} is no longer in the list — choose one with "prosonata project"', context.projectId)}\n`)
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
    t('Category number: '),
    grouped ? (candidate) => candidate.groupName : undefined,
  )
  if (!category) {
    process.stderr.write(`${t('no category chosen — ProSonata requires one, so nothing will be sent')}\n`)
    return 0
  }

  rememberCategory(repoRoot, project.projectID, category.category, category.categoryName)
  session.store.update((state) =>
    applyCategory(state, repoRoot, project.projectID, category.category, session.clock.now()),
  )
  process.stdout.write(`${t('Category: {0}', category.categoryName)}\n`)
  return category.category
}

/** The rounding grid of this repository. */
async function chooseGrid(cwd: string, argument: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const wanted = argument !== '' ? argument : await ask(t('Rounding grid — exact, 5, 15 or 30 minutes: '))
  const grid = parseGrid(wanted)
  if (!grid) {
    process.stderr.write(`${t('not a rounding grid: {0} — use "exact" or a number of minutes', wanted)}\n`)
    return 2
  }

  setGrid(context.repo.root, grid)
  process.stdout.write(`${grid.kind === 'exact' ? t('Rounding grid: exact') : t('Rounding grid: {0} min', grid.minutes)}\n`)
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
    process.stderr.write(`${t('on the main branch every commit is its own entry — nothing to switch')}\n`)
    return 1
  }

  // `day` on the command line, `branch-day` in the config: the short word is
  // what a person types, the config key is what the extension already writes.
  // `tag` is the German word, kept for those who learned it.
  const names: Record<string, EntryMode> = {
    branch: 'branch',
    day: 'branch-day',
    tag: 'branch-day',
    'branch-day': 'branch-day',
    commit: 'commit',
  }

  const typed = argument !== '' ? argument : await ask(t('Mode — branch, day or commit: '))
  const wanted = names[typed]
  if (wanted === undefined) {
    process.stderr.write(`${t('not a mode: {0} — use "branch", "day" or "commit"', typed)}\n`)
    return 2
  }
  if (wanted === context.mode) {
    const already: Record<EntryMode, string> = {
      branch: t('already one entry per branch'),
      'branch-day': t('already one entry per branch and day'),
      commit: t('already one entry per commit'),
    }
    process.stdout.write(`${already[wanted]}\n`)
    return 0
  }

  // Switching to per-commit closes the open entry — otherwise it would hang
  // there with no prospect of ever being closed (KONZEPT.md §3).
  if (wanted === 'commit') {
    const entry = openEntry(session.state(), context.scope)
    if (entry && entry.text !== '') {
      const text = (await ask(t('Final text for the open entry [{0}]: ', entry.text))) || entry.text
      session.closeEntry(entry.id, text)
    }
  }

  setMode(context.repo.root, context.key, wanted)
  const switched: Record<EntryMode, string> = {
    branch: t('one entry per branch on {0}', context.scope.branch),
    'branch-day': t('one entry per branch and day on {0}', context.scope.branch),
    commit: t('one entry per commit on {0}', context.scope.branch),
  }
  process.stdout.write(`${switched[wanted]}\n`)
  return 0
}

/**
 * Closes an open entry and sends it right away: the one of this branch, or —
 * when the first word is the eight-character number `status` shows — the entry
 * of another branch of this repository, typically one already merged and
 * deleted (KONZEPT.md §3, *Abschluss*).
 */
async function closeEntry(cwd: string, argument: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const [first = '', ...rest] = argument.split(' ')
  const named = /^[0-9a-f]{8}$/.test(first)
    ? openBranchEntries(session.state(), context.repo.root, context.mainBranch).find((candidate) => candidate.id.startsWith(first))
    : undefined
  const entry = named ?? openEntry(session.state(), context.scope)
  if (!entry) {
    process.stderr.write(`${t('nothing open on {0}', context.scope.branch)}\n`)
    return 1
  }

  const given = named ? rest.join(' ').trim() : argument
  const text = given !== '' ? given : (await askFinalText(entry.text)) || entry.text
  if (text === '') {
    process.stderr.write(`${t('an entry without text is never sent — nothing done')}\n`)
    return 1
  }

  session.closeEntry(entry.id, text)
  process.stdout.write(`${t('closed: {0}', text)}\n`)
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
    process.stderr.write(`${t('no timer is running')}\n`)
    return 2
  }

  session.keepFromRunning(context, 0)
  process.stdout.write(
    `${t('{0} discarded — paused, {1} on {2}', format(running), format(session.seconds(context)), context.scope.branch)}\n`,
  )
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
    const answer = await ask(t('{0}\nAttach? [y/N] ', describePlan(plan)))
    return yes(answer)
  })

  if (result.kind === 'done') {
    process.stdout.write(`${t('attached: {0}', describeAttachment(result))}\n`)
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
    process.stdout.write(`${t('nothing on {0} is waiting for a decision', context.scope.branch)}\n`)
    return 0
  }

  for (const entry of parked) {
    process.stdout.write(
      `${t('"{0}" was closed on another machine, {1} more accrued here', entry.text || context.scope.branch, format(unwrittenSeconds(entry)))}\n`,
    )
    const wanted = argument !== '' ? argument : await ask(t('Add or new? [add|new]: '))
    if (wanted !== 'add' && wanted !== 'neu' && wanted !== 'new') {
      process.stderr.write(`${t('not an answer: {0} — use "add" or "new"', wanted)}\n`)
      return 2
    }

    await session.resolveClosedElsewhere(entry.id, wanted === 'add' ? 'add' : 'fresh')
    process.stdout.write(`${wanted === 'add' ? t('added to the existing entry') : t('becomes a new entry')}\n`)
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
    process.stderr.write(`${t('nothing open on {0}', context.scope.branch)}\n`)
    return 1
  }

  const text = argument !== '' ? argument : await ask(entry.text ? t('Text [{0}]: ', entry.text) : t('Text: '))
  if (text === '') {
    process.stderr.write(`${t('no text given — nothing changed')}\n`)
    return 1
  }

  session.store.update((state) => setText(state, entry.id, text, session.clock.now()))
  process.stdout.write(`${t('Text: {0}', text)}\n`)
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
  process.stdout.write(`${t('running on {0} — {1}', context.scope.branch, nameOfProject(context))}\n`)
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
      process.stderr.write(`${t('not a duration: {0} — use "1:30" or a number of minutes', argument)}\n`)
      return 2
    }
    const running = runningSeconds(session.state(), session.clock, context.scope)
    session.keepFromRunning(context, kept)
    process.stdout.write(`${t('{1} of {0} booked', format(running), format(Math.min(kept, running)))}\n`)
  }

  process.stdout.write(`${t('paused — {0} on {1}', format(session.seconds(context)), context.scope.branch)}\n`)
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

  // `branch-day` shows as per commit, as it always has; only the words changed here.
  process.stdout.write(
    `${nameOfProject(context)} — ${context.scope.branch} (${context.mode === 'branch' ? t('one entry per branch') : t('one entry per commit')})\n`,
  )
  process.stdout.write(`  ${timer?.startedAt ? t('running') : t('paused')}  ${format(session.seconds(context))}\n`)
  if (entry) {
    process.stdout.write(
      `  ${t('open entry')}  ${entry.text || t('(no text yet)')}  ${billedTime(entry.foreignSeconds + entry.seconds, context.config.grid ?? session.config.grid)} h\n`,
    )
  }
  const running = runningSeconds(state, session.clock, context.scope)
  if (running >= session.config.longRunWarningSeconds) {
    process.stdout.write(`  ${t('running for {0} without a break — "prosonata pause [h:mm]" books only part of it', format(running))}\n`)
  }
  for (const parked of awaitingDecision(state, context.scope)) {
    process.stdout.write(`  ${t('closed elsewhere  {0} open — "prosonata resume" decides', format(unwrittenSeconds(parked)))}\n`)
  }
  for (const { entry: done, why } of session.finishedEntries(context)) {
    const args = [done.id.slice(0, 8), done.scope.branch, done.text || t('(no text)'), format(done.foreignSeconds + done.seconds)] as const
    process.stdout.write(
      `  ${why === 'deleted' ? t('branch deleted  {0}  {1}  {2}  {3} — "prosonata close {0} [text]"', ...args) : t('branch merged  {0}  {1}  {2}  {3} — "prosonata close {0} [text]"', ...args)}\n`,
    )
  }
  if (context.categoryId <= 0) {
    process.stdout.write(`  ${t('no time category — nothing is sent until one is chosen')}\n`)
  }
  if (state.pending.length > 0) {
    process.stdout.write(`  ${t('waiting to be sent: {0}', state.pending.length)}\n`)
  }
  // Every repository's, not only this one: on 26 October 2026 the stuck entries
  // belonged to another repository, and nothing here would have shown them.
  const resting = session.restingEntries()
  if (resting.length > 0) {
    process.stdout.write(
      `  ${t('dormant for {0} days or longer: {1} — "prosonata resting <no> close|keep|drop"', session.config.restingDays, resting.length)}\n`,
    )
    for (const quiet of resting) {
      process.stdout.write(
        `    ${quiet.id.slice(0, 8)}  ${basename(quiet.scope.repoPath)}/${quiet.scope.branch}  ${quiet.text || t('(no text)')}  ${format(quiet.foreignSeconds + quiet.seconds)}\n`,
      )
    }
  }
  const refused = rejectedEntries(state)
  if (refused.length > 0) {
    process.stdout.write(`  ${t('rejected by ProSonata: {0} — "prosonata rejected <no> retry|move|drop"', refused.length)}\n`)
    listRejected(refused, '    ')
  }

  /*
   * Which version the hooks actually run. Every silent hook failure so far was
   * invisible because `|| true` swallows it, so this line exists to be looked
   * at when a commit books nothing (KONZEPT.md §8).
   */
  const published = publishedCli()
  if (published) {
    process.stdout.write(`  ${t('hook calls {0} ({1})', published.path, published.version)}\n`)
  } else if (isInstalled(context.repo.root)) {
    process.stdout.write(
      `  ${t('{0} is missing — the hook books nothing. Open the repository in VS Code or run "prosonata project".', paths.cli())}\n`,
    )
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
    process.stderr.write(
      `${t('text too long ({0} of {1}) — shorten it, ProSonata would cut it off without a word', problem.length, problem.limit)}\n`,
    )
  }
  if (result.awaitingDecision.length > 0) {
    process.stderr.write(`${t('closed on another machine — "prosonata resume" decides where the remaining time goes')}\n`)
  }
  if (result.missingCategory.length > 0) {
    process.stderr.write(`${t('no time category for this project — choose one with "prosonata category", ProSonata requires it')}\n`)
  }
  for (const failure of result.failed) {
    process.stderr.write(`${t('could not be sent: {0}', failure.error.message)}\n`)
  }
  if (result.rejected.length > 0) {
    process.stderr.write(`${t('rejected by ProSonata: {0} — "prosonata rejected" shows what to do', result.rejected.length)}\n`)
  }
  process.stdout.write(`${t('sent: {0}', result.sent.length)}\n`)
  return result.failed.length > 0 || result.rejected.length > 0 ? 1 : 0
}

/**
 * Entries ProSonata refused (KONZEPT.md §4). Without an argument the list; with
 * the first characters of an entry's number and an action, that action. Works
 * from any directory: the entry names its own repository.
 */
async function rejected(argument: string): Promise<number> {
  const session = Session.open()
  const refused = rejectedEntries(session.state())
  const [ref, action] = argument.split(/\s+/).filter((part) => part !== '')

  if (!ref) {
    if (refused.length === 0) {
      process.stdout.write(`${t('ProSonata has rejected no entry')}\n`)
      return 0
    }
    listRejected(refused, '  ')
    process.stdout.write(`\n  ${t('"prosonata rejected <no> retry"  send again')}\n`)
    process.stdout.write(`  ${t('"prosonata rejected <no> move"   move to another project and send')}\n`)
    process.stdout.write(`  ${t('"prosonata rejected <no> drop"   discard — the time is already in ProSonata')}\n`)
    return 0
  }

  const matches = refused.filter((entry) => entry.id.startsWith(ref))
  const entry = matches[0]
  if (!entry || matches.length > 1) {
    process.stderr.write(
      `${matches.length > 1 ? t('ambiguous: {0} — "prosonata rejected" lists them', ref) : t('no rejected entry: {0} — "prosonata rejected" lists them', ref)}\n`,
    )
    return 2
  }

  switch (action) {
    case 'retry':
      return report(await session.retryRejected(entry.id))
    case 'move':
      return await moveRejected(session, entry)
    case 'drop': {
      const running = session.state().timers.some((timer) => timer.entryId === entry.id && timer.startedAt !== null)
      const label = entry.text || t('(no text)')
      const answer = await ask(
        running
          ? t('Discard {0}? Only here, ProSonata stays untouched; the running timer goes with it [y/N] ', label)
          : t('Discard {0}? Only here, ProSonata stays untouched [y/N] ', label),
      )
      if (!yes(answer)) {
        process.stdout.write(`${t('nothing discarded')}\n`)
        return 1
      }
      session.discardLocally(entry.id)
      process.stdout.write(`${t('discarded')}\n`)
      return 0
    }
    default:
      process.stderr.write(`${t('what should happen to {0}? retry, move or drop', ref)}\n`)
      return 2
  }
}

/**
 * Open entries that have rested for `restingDays` (KONZEPT.md §3, *Abschluss*):
 * close, keep for another period, or discard. Works from any directory, like
 * `rejected` — what is forgotten lies in a repository one is not in.
 */
async function resting(argument: string): Promise<number> {
  const session = Session.open()
  const quiet = session.restingEntries()
  const [ref, action, ...rest] = argument.split(/\s+/).filter((part) => part !== '')

  if (!ref) {
    if (quiet.length === 0) {
      process.stdout.write(`${t('no entry has been dormant for {0} days', session.config.restingDays)}\n`)
      return 0
    }
    for (const entry of quiet) {
      process.stdout.write(
        `  ${entry.id.slice(0, 8)}  ${basename(entry.scope.repoPath)}/${entry.scope.branch}  ${entry.text || t('(no text)')}  ${format(entry.foreignSeconds + entry.seconds)}\n`,
      )
    }
    process.stdout.write(`\n  ${t('"prosonata resting <no> close [text]"  close and send')}\n`)
    process.stdout.write(`  ${t('"prosonata resting <no> keep"          keep — ask again in {0} days', session.config.restingDays)}\n`)
    process.stdout.write(`  ${t('"prosonata resting <no> drop"          discard — the time is already in ProSonata some other way')}\n`)
    return 0
  }

  const matches = quiet.filter((entry) => entry.id.startsWith(ref))
  const entry = matches[0]
  if (!entry || matches.length > 1) {
    process.stderr.write(
      `${matches.length > 1 ? t('ambiguous: {0} — "prosonata resting" lists them', ref) : t('no dormant entry: {0} — "prosonata resting" lists them', ref)}\n`,
    )
    return 2
  }

  switch (action) {
    case 'close': {
      const given = rest.join(' ').trim()
      const text = given !== '' ? given : (await askFinalText(entry.text)) || entry.text
      if (text === '') {
        process.stderr.write(`${t('an entry without text is never sent — nothing done')}\n`)
        return 1
      }
      session.closeEntry(entry.id, text)
      process.stdout.write(`${t('closed: {0}', text)}\n`)
      return report(await session.flush(true))
    }
    case 'keep':
      session.keepResting(entry.id)
      process.stdout.write(`${t('kept — asked again after {0} days without new time', session.config.restingDays)}\n`)
      return 0
    case 'drop': {
      const answer = await ask(t('Discard {0}? Only here, ProSonata stays untouched [y/N] ', entry.text || t('(no text)')))
      if (!yes(answer)) {
        process.stdout.write(`${t('nothing discarded')}\n`)
        return 1
      }
      session.discardLocally(entry.id)
      process.stdout.write(`${t('discarded')}\n`)
      return 0
    }
    default:
      process.stderr.write(`${t('what should happen to {0}? close, keep or drop', ref)}\n`)
      return 2
  }
}

/**
 * Removes the empty remainders of deleted branches in every repository the state
 * knows (#1). The extension does the same once an hour; this is for whoever
 * works without it, or does not want to wait.
 */
function tidy(): number {
  const removed = Session.open().tidyAllRepositories()
  const line =
    removed === 0
      ? t('nothing to tidy')
      : removed === 1
        ? t('removed one empty remainder of deleted branches')
        : t('removed {0} empty remainders of deleted branches', removed)
  process.stdout.write(`${line}\n`)
  return 0
}

/** The other project for a refused entry: the repository's own first, the dead one left out. */
async function moveRejected(session: Session, entry: TimeEntry): Promise<number> {
  const repoPath = entry.scope.repoPath
  const known = new Set(readRepoConfig(repoPath).projects.map((project) => project.id))
  const projects = (await session.api.listProjects()).filter((project) => project.projectID !== entry.projectId)
  const project = await pick(
    [...projects.filter((p) => known.has(p.projectID)), ...projects.filter((p) => !known.has(p.projectID))],
    (candidate) => `${candidate.projectNo}  ${candidate.projectName}`,
    t('Project number: '),
  )
  if (!project) return 1

  let categoryId = readRepoConfig(repoPath).categories.get(project.projectID) ?? 0
  if (categoryId <= 0) categoryId = await askForCategory(session, repoPath, project)
  if (categoryId <= 0) return 1

  const moving = entriesToMove(session.state(), entry.id).length
  const result = await session.moveRejected(entry.id, { id: project.projectID, name: project.projectName, no: project.projectNo }, categoryId)
  process.stdout.write(
    `${moving === 1 ? t('one entry to {0} {1}', project.projectNo, project.projectName) : t('{0} entries to {1} {2}', moving, project.projectNo, project.projectName)}\n`,
  )
  return report(result)
}

/** One line per refused entry: number, where it comes from, what it is, why. */
function listRejected(entries: TimeEntry[], indent: string): void {
  for (const entry of entries) {
    const project = readRepoConfig(entry.scope.repoPath).projects.find((candidate) => candidate.id === entry.projectId)
    process.stdout.write(
      `${indent}${entry.id.slice(0, 8)}  ${basename(entry.scope.repoPath)}/${entry.scope.branch}  ${entry.text || t('(no text)')}  ${format(entry.foreignSeconds + entry.seconds)}\n`,
    )
    process.stdout.write(`${indent}          ${describeRejection(entry, project)}\n`)
  }
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
        `prosonata: ${t('the branch had changed — the time so far went to the branch it was started on, and the timer is paused')}\n`,
      )
    }
    if (!outcome.hadTimer) {
      process.stderr.write(`prosonata: ${t('no timer was running — this commit booked nothing')}\n`)
      return 0
    }
    if (outcome.booked > 0) {
      const booked = format(outcome.booked)
      process.stderr.write(`prosonata: ${outcome.closed ? t('{0} booked, entry closed', booked) : t('{0} booked', booked)}\n`)
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
    process.stderr.write(`${t('no adjustment: {0} — use "+25", "-1:30", "from 9:40" or "until 9:40"', argument || t('(nothing)'))}\n`)
    return 2
  }
  if (offers.length > 1) {
    process.stderr.write(`${t('{0} is ambiguous — use "from {0}" or "until {0}"', argument)}\n`)
    return 2
  }

  const wanted = offers[0]!
  const before = session.seconds(context)
  const plan = session.adjust(context, wanted)
  // The note explains why less happened — never more needed than when nothing did.
  const note = noteFor(plan, wanted)
  if (plan.action === 'impossible') {
    process.stderr.write(`${t('not possible without a running timer — {0}', note ?? '')}\n`)
    return 2
  }
  if (plan.delta === 0 && plan.action !== 'stop') {
    process.stderr.write(`${note === null ? t('nothing changed') : t('nothing changed — {0}', note)}\n`)
    return 1
  }
  if (plan.action === 'stop') {
    const line =
      plan.at === undefined ? t('Timer stopped') : t('Timer stopped at {0}', new Date(plan.at).toTimeString().slice(0, 5))
    process.stdout.write(`${line}\n`)
  }
  if (note !== null) process.stdout.write(`${note}\n`)

  process.stdout.write(
    `${t('{0}: {1} → {2} on {3}', wanted.label, format(before), format(session.seconds(context)), context.scope.branch)}\n`,
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
    process.stdout.write(`${t('no segment recorded for this repository yet')}\n`)
    return 0
  }

  if (argument === '?' || argument === 'branches') {
    for (const summary of branchesIn(segments, context.repo.root)) {
      process.stdout.write(`  ${summary.branch.padEnd(30)} ${describeBranch(summary)}\n`)
    }
    return 0
  }

  // `alle` is the German word, kept as an alias.
  const branch = argument === 'all' || argument === 'alle' ? null : argument !== '' ? argument : context.scope.branch
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

/** The closing question of `close` and `resting close`, with the current text as default. */
async function askFinalText(current: string): Promise<string> {
  return await ask(current ? t('Final text [{0}]: ', current) : t('Final text: '))
}

/** A yes to a `[y/N]` question, in English or German. */
function yes(answer: string): boolean {
  return /^(j|ja|y|yes)$/i.test(answer.trim())
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
    process.stderr.write(`${t('nothing to choose from')}\n`)
    return null
  }

  let heading: string | null | undefined
  items.slice(0, 40).forEach((item, index) => {
    if (group) {
      const name = group(item)
      if (name !== heading) {
        heading = name
        process.stdout.write(`\n  ${name ?? t('No group')}\n`)
      }
    }
    process.stdout.write(`  ${String(index + 1).padStart(2)}  ${label(item)}\n`)
  })

  const chosen = items[Number(await ask(question)) - 1]
  if (!chosen) process.stderr.write(`${t('nothing chosen')}\n`)
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
  if (!project) return t('Project {0}', context.projectId)
  return project.no ? `${project.no} ${project.name}` : project.name
}

function notARepo(): number {
  process.stderr.write(`${t('not a git repository')}\n`)
  return 1
}

/** What `installHook` did, as a whole sentence per action. */
const HOOK_LINE: Record<'created' | 'appended' | 'updated' | 'unchanged', (path: string) => string> = {
  created: (path) => t('Hook created: {0}', path),
  appended: (path) => t('Hook appended: {0}', path),
  updated: (path) => t('Hook updated: {0}', path),
  unchanged: (path) => t('Hook unchanged: {0}', path),
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

/**
 * The path a hook should call: the fixed copy, once this CLI has put itself
 * there. Falls back to the path of the running file if that copy cannot be
 * written — a hook pointing at where the CLI actually is beats one pointing at
 * where it should have been (KONZEPT.md §8).
 */
function publishCliOrOwnPath(): string {
  try {
    publishCli(cliPath())
    return paths.cli()
  } catch (error) {
    process.stderr.write(`${t('could not put the CLI at {0}: {1}', paths.cli(), (error as Error).message)}\n`)
    return cliPath()
  }
}
