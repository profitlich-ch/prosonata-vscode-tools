import { createInterface } from 'node:readline/promises'

import { HttpApi } from '../core/api.js'
import { DEFAULTS, MissingConfig, paths, readConfig, writeConfig, type Config } from '../core/config.js'
import { describeRepo, headSha, subjectOf, trailerOf } from '../core/git.js'
import { installHook } from '../core/hooks.js'
import { rememberCategory, rememberProject } from '../core/repo-config.js'
import { NotConfigured, Session } from '../core/session.js'
import { openEntry } from '../core/tracking.js'
import { workingTime } from '../core/working-time.js'

/**
 * The command line. Same core as the extension, so a commit from the terminal
 * behaves exactly like one from the editor.
 *
 * The binary is called `prosonata`, not `ps`: `ps` is the Unix process listing,
 * and the npm bin directory usually comes before `/bin` in `$PATH` — a global
 * `ps` would break `ps aux` for anyone who installed this (KONZEPT.md §8).
 */

const USAGE = `prosonata — time tracking tied to commits and branches

  prosonata init          set up the account and this repository, install the hook
  prosonata start         start or resume the timer of this branch
  prosonata pause         pause it and book the running segment
  prosonata status        what is running, what is open, what is waiting to be sent
  prosonata send          send everything that is due right now
  prosonata post-commit   called by the hook, not meant to be typed
`

export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
  const command = argv[0] ?? 'status'

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
      case 'post-commit':
        return await postCommit(cwd)
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(USAGE)
        return 0
      default:
        process.stderr.write(`unknown command: ${command}\n\n${USAGE}`)
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
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    let config: Config
    try {
      config = readConfig()
      process.stdout.write(`account already set up: ${config.baseUrl}\n`)
    } catch {
      const baseUrl = (await rl.question('Base URL (https://<subdomain>.prosonata.software/api/v1): ')).trim()
      const apiKey = (await rl.question('Personal API key: ')).trim()
      config = { ...DEFAULTS, baseUrl, apiKey }
      writeConfig(config)
      process.stdout.write(`written to ${paths.config()} with mode 0600\n`)
    }

    const repo = describeRepo(cwd)
    if (!repo) {
      process.stderr.write('not a git repository\n')
      return 1
    }

    const api = new HttpApi({ baseUrl: config.baseUrl, apiKey: config.apiKey })
    const projects = await api.listProjects()
    if (projects.length === 0) {
      process.stderr.write('no open projects found — check the key and its permissions\n')
      return 1
    }

    projects.slice(0, 40).forEach((project, index) => {
      process.stdout.write(`  ${String(index + 1).padStart(2)}  ${project.projectNo}  ${project.projectName}\n`)
    })
    const chosen = projects[Number((await rl.question('Project number: ')).trim()) - 1]
    if (!chosen) {
      process.stderr.write('nothing chosen\n')
      return 1
    }
    rememberProject(repo.root, { id: chosen.projectID, name: chosen.projectName })

    const categories = (await api.listCategories()).filter(
      (category) => category.linkedCustomerID === null || category.linkedCustomerID === chosen.customerID,
    )
    categories.slice(0, 40).forEach((category, index) => {
      process.stdout.write(`  ${String(index + 1).padStart(2)}  ${category.categoryName}\n`)
    })
    const category = categories[Number((await rl.question('Category number: ')).trim()) - 1]
    if (category) rememberCategory(repo.root, chosen.projectID, category.category)

    const hook = installHook(repo.root, { node: process.execPath, cli: cliPath() })
    process.stdout.write(`hook ${hook.action}: ${hook.path}\n`)
    process.stdout.write(`ready — "${chosen.projectName}" in ${repo.root}\n`)
    return 0
  } finally {
    rl.close()
  }
}

function start(cwd: string): number {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  session.start(context)
  process.stdout.write(`running on ${context.scope.branch} — ${nameOfProject(context)}\n`)
  return 0
}

function pause(cwd: string): number {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  session.pause(context)
  process.stdout.write(`paused — ${format(session.seconds(context))} on ${context.scope.branch}\n`)
  return 0
}

async function status(cwd: string): Promise<number> {
  const session = Session.open()
  const context = session.context(cwd)
  if (!context) return notARepo()

  const state = session.state()
  const entry = openEntry(state, context.scope)
  const timer = state.timers.find((candidate) => candidate.scope.branch === context.scope.branch)

  process.stdout.write(`${nameOfProject(context)} — ${context.scope.branch} (${context.mode === 'branch' ? 'one entry per branch' : 'one entry per commit'})\n`)
  process.stdout.write(`  ${timer?.startedAt ? 'running' : 'paused'}  ${format(session.seconds(context))}\n`)
  if (entry) {
    process.stdout.write(`  open entry  ${entry.text || '(no text yet)'}  ${workingTime(entry.foreignSeconds + entry.seconds, context.config.grid ?? session.config.grid)} h\n`)
  }
  if (state.pending.length > 0) {
    process.stdout.write(`  waiting to be sent: ${state.pending.length}\n`)
  }
  return 0
}

async function flush(cwd: string): Promise<number> {
  const session = Session.open()
  if (!session.context(cwd)) return notARepo()

  const result = await session.flush(true)
  for (const problem of result.tooLong) {
    process.stderr.write(`text too long (${problem.length} of ${problem.limit}) — shorten it, ProSonata would cut it silently\n`)
  }
  for (const failure of result.failed) {
    process.stderr.write(`could not send: ${failure.error.message}\n`)
  }
  process.stdout.write(`sent: ${result.sent.length}\n`)
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
        'prosonata: the branch had changed — the time so far went to the branch it was started on, and the timer is paused\n',
      )
    }
    if (!outcome.hadTimer) {
      process.stderr.write('prosonata: no timer was running — this commit booked nothing\n')
      return 0
    }
    if (outcome.booked > 0) {
      process.stderr.write(`prosonata: ${format(outcome.booked)} booked${outcome.closed ? ', entry closed' : ''}\n`)
    }
    await session.flush()
    return 0
  } catch (error) {
    process.stderr.write(`prosonata: ${(error as Error).message}\n`)
    return 0
  }
}

function nameOfProject(context: { projectId: number; config: { projects: { id: number; name: string }[] } }): string {
  return context.config.projects.find((project) => project.id === context.projectId)?.name ?? `project ${context.projectId}`
}

function notARepo(): number {
  process.stderr.write('not a git repository\n')
  return 1
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
