import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '../core/config.js'
import { describeRepo } from '../core/git.js'
import { rememberCategory, rememberProject } from '../core/repo-config.js'
import { Session } from '../core/session.js'
import { StateStore } from '../core/state-store.js'
import { emptyState, type TimeEntry } from '../core/types.js'
import { main } from './main.js'

/**
 * A request for help does nothing else, and nothing that looks like an option
 * becomes an invoice line (KONZEPT.md §8, *CLI*). On 3 November 2026
 * `prosonata close --help` closed an empty entry with the text "--help" and
 * sent it.
 */

let home: string
let repo: string
let out: string
let err: string
const previousHome = process.env['PROSONATA_HOME']

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'prosonata-cli-'))
  process.env['PROSONATA_HOME'] = home
  // Port 9 refuses at once: should a test reach a send after all, it fails
  // there quickly instead of waiting on the network.
  writeFileSync(paths.config(), JSON.stringify({ baseUrl: 'http://127.0.0.1:9/api/v1', apiKey: 'k' }))

  const dir = mkdtempSync(join(tmpdir(), 'prosonata-cli-repo-'))
  git(dir, 'init', '--quiet', '--initial-branch=main')
  git(dir, 'config', 'user.email', 't@example.invalid')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'erster Commit')
  repo = describeRepo(dir)!.root
  rememberProject(repo, { id: 166, name: 'Shop', no: 'P-1' })
  rememberCategory(repo, 166, 70)

  out = ''
  err = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk)
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  if (previousHome === undefined) delete process.env['PROSONATA_HOME']
  else process.env['PROSONATA_HOME'] = previousHome
})

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd })
}

/** The open entry on main, with a paused timer, as every commit there leaves it. */
function openOnMain(seconds: number, text = ''): TimeEntry {
  return openOn('main', seconds, text)
}

/** An open entry with a paused timer, the only one in the state. */
function openOn(branch: string, seconds: number, text: string, extra: Partial<TimeEntry> = {}): TimeEntry {
  const entry: TimeEntry = {
    ...extra,
    id: 'e1aa0000-0000-0000-0000-000000000000',
    key: 'k1',
    scope: { repoPath: repo, branch },
    projectId: 166,
    categoryId: 70,
    text,
    seconds,
    foreignSeconds: 0,
    lastWritten: null,
    timeId: null,
    state: 'open',
  }
  new StateStore(paths.state()).update(() => ({
    ...emptyState(),
    entries: [entry],
    timers: [{ id: 't1', origin: 'local', remoteTimerId: null, scope: entry.scope, startedAt: null, entryId: entry.id }],
  }))
  return entry
}

function stored(): TimeEntry | undefined {
  return new StateStore(paths.state()).read().state.entries.find((entry) => entry.id.startsWith('e1aa'))
}

/** A branch that was merged by squash and deleted, its entry still open. */
function deletedBranch(text: string): void {
  git(repo, 'branch', 'formularseite')
  git(repo, 'branch', '-D', '--quiet', 'formularseite')
  openOn('formularseite', 1800, text)
}

describe('help', () => {
  it('after a command shows that command and leaves the open entry alone', async () => {
    openOnMain(0)

    expect(await main(['close', '--help'], repo)).toBe(0)

    expect(out).toContain('prosonata close')
    expect(out).not.toContain('prosonata text')
    expect(stored()).toMatchObject({ state: 'open', text: '' })
  })

  it('works the same with -h and anywhere after the command', async () => {
    openOnMain(1800)

    expect(await main(['close', 'abc12345', '-h'], repo)).toBe(0)

    expect(out).toContain('prosonata close')
    expect(stored()).toMatchObject({ state: 'open', text: '' })
  })

  it('takes a command as its argument', async () => {
    expect(await main(['help', 'resting'], repo)).toBe(0)

    // The continuation line belongs to the command above it.
    expect(out).toContain('prosonata resting')
    expect(out).toContain('close')
    expect(out).not.toContain('prosonata tidy')
  })

  it('names an unknown command', async () => {
    expect(await main(['help', 'nonsense'], repo)).toBe(2)

    expect(err).toContain('unknown command: nonsense')
  })
})

describe('a text that begins with a dash', () => {
  it('does not close the entry', async () => {
    openOnMain(1800)

    expect(await main(['close', '--fertig'], repo)).toBe(2)

    expect(err).toContain('is an option, not a text')
    expect(stored()).toMatchObject({ state: 'open', text: '' })
  })

  it('does not become the text of the open entry', async () => {
    openOnMain(1800, 'Warenkorb')

    expect(await main(['text', '-v'], repo)).toBe(2)

    expect(stored()).toMatchObject({ state: 'open', text: 'Warenkorb' })
  })
})

/*
 * After a merge one knows the names of one's branches, not the numbers of
 * their entries; and an agent has no terminal to answer a question on (#6).
 * The send at the end fails — there is no ProSonata here — but the close
 * itself is local and comes first.
 */
describe('closing the entry of a finished branch by its name', () => {
  it('keeps the text the entry has', async () => {
    deletedBranch('Formular für Anmeldungen')

    await main(['close', 'formularseite'], repo)

    expect(stored()).toMatchObject({ state: 'closed', text: 'Formular für Anmeldungen' })
  })

  it('takes a text given after the name', async () => {
    deletedBranch('Formular')

    await main(['close', 'formularseite', 'Formular', 'für', 'Anmeldungen'], repo)

    expect(stored()).toMatchObject({ state: 'closed', text: 'Formular für Anmeldungen' })
  })

  it('without any text refuses instead of waiting for an answer nobody gives', async () => {
    deletedBranch('')

    expect(await main(['close', 'formularseite'], repo)).toBe(1)

    expect(err).toContain('never sent')
    expect(stored()).toMatchObject({ state: 'open', text: '' })
  })

  it('is what status suggests', async () => {
    deletedBranch('Formular')

    await main(['status'], repo)

    expect(out).toContain('"prosonata close formularseite [text]"')
  })
})

/*
 * Main time held at a squash merge waits for an answer (KONZEPT.md §3). The
 * terminal shows it and takes the answers an agent may give; throwing the
 * time away is not one of them.
 */
describe('time held at a squash merge', () => {
  function heldOnMain(): void {
    openOn('main', 40 * 60, '', { heldAtMerge: { branch: 'formularseite', entryId: 'b', at: 0 } })
  }

  it('shows in status with what to do', async () => {
    heldOnMain()

    await main(['status'], repo)

    expect(out).toContain('held at a squash merge: 1')
    expect(out).toContain('before the merge of formularseite')
  })

  it('is not discarded without a terminal, and nobody is left waiting', async () => {
    heldOnMain()

    expect(await main(['held', 'e1aa', 'drop'], repo)).toBe(2)

    expect(err).toContain('needs a person')
    expect(stored()).toMatchObject({ seconds: 40 * 60, heldAtMerge: { branch: 'formularseite' } })
  })

  it('closes with a text of its own', async () => {
    heldOnMain()

    await main(['held', 'e1aa', 'close', 'Wartung'], repo)

    expect(stored()).toMatchObject({ state: 'closed', text: 'Wartung' })
    expect(stored()?.heldAtMerge).toBeUndefined()
  })
})

/*
 * What an agent must hand to a person says so in the output it is reading at
 * that moment, not in a rule it may have forgotten (docs/ki-anbindung.md).
 */
const AI_NOTE = 'Note for AI: ask the user to decide.'

function commitOn(branch: string, message: string): void {
  git(repo, 'switch', '--quiet', branch === 'main' ? 'main' : '-c', ...(branch === 'main' ? [] : [branch]))
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', message)
}

describe('adjusting the time', () => {
  it('needs a terminal, so no number comes from an agent', async () => {
    openOnMain(1800)

    expect(await main(['adjust', '+90'], repo)).toBe(2)

    expect(err).toContain('needs a person')
    expect(err).toContain(AI_NOTE)
    expect(stored()?.seconds).toBe(1800)
  })
})

describe('an entry closed on another machine', () => {
  it('without an answer and without a terminal asks for the user instead of waiting', async () => {
    openOn('main', 1800, 'Warenkorb', { awaitingDecision: true, remoteFinalSeconds: 600 })

    expect(await main(['resume'], repo)).toBe(2)

    expect(err).toContain('"prosonata resume add" or "prosonata resume new"')
    expect(err).toContain(AI_NOTE)
    expect(stored()).toMatchObject({ awaitingDecision: true })
  })
})

describe('a commit without a trailer', () => {
  it('on a branch says that the entry has no text yet', async () => {
    commitOn('formularseite', 'Formular angelegt')
    openOn('formularseite', 600, '')

    await main(['post-commit'], repo)

    expect(err).toContain('no "Prosonata:" trailer — the entry on formularseite has no text yet')
  })

  it('on a branch whose entry already has a text says nothing', async () => {
    commitOn('formularseite', 'Formular angelegt')
    openOn('formularseite', 600, 'Formular für Anmeldungen')

    await main(['post-commit'], repo)

    expect(err).not.toContain('trailer')
  })

  it('on the main branch names the subject that becomes the invoice text', async () => {
    commitOn('main', 'fix: Rundung')
    openOnMain(600)

    await main(['post-commit'], repo)

    expect(err).toContain('no "Prosonata:" trailer — "fix: Rundung" becomes the invoice text')
  })

  it('with a trailer says nothing about one', async () => {
    commitOn('main', 'fix: Rundung\n\nProsonata: Rabattberechnung korrigiert')
    openOnMain(600)

    await main(['post-commit'], repo)

    expect(err).not.toContain('trailer')
  })
})

describe('the squash merge of a branch', () => {
  it('names the entry of the merged branch that is still open', async () => {
    git(repo, 'branch', 'formularseite')
    openOn('formularseite', 1800, 'Formular für Anmeldungen')

    commitOn('main', 'Formularseite\n\nProsonata: Formular für Anmeldungen')
    await main(['post-commit'], repo)

    expect(err).toContain('the entry of formularseite is still open — once the branch is done: "prosonata close formularseite [text]"')
  })
})

describe('open main time on a new branch', () => {
  it('is asked about when the timer starts there, and take brings it along', async () => {
    openOnMain(40 * 60, 'Vorarbeit')
    git(repo, 'switch', '--quiet', '-c', 'formularseite')

    await main(['start'], repo)

    expect(err).toContain('0:40:00 open on main — if it belongs to this branch: "prosonata take main"')
    expect(err).toContain(AI_NOTE)

    expect(await main(['take', 'main'], repo)).toBe(0)
    expect(stored()).toMatchObject({ scope: { branch: 'formularseite' }, seconds: 40 * 60 })
  })

  it('is asked about at the first commit there, when no timer ran', async () => {
    openOnMain(40 * 60)
    commitOn('formularseite', 'Formular\n\nProsonata: Formular')

    await main(['post-commit'], repo)

    expect(err).toContain('open on main — if it belongs to this branch: "prosonata take main"')
    expect(err).toContain(AI_NOTE)
  })

  it('is not asked about once the branch has time of its own', async () => {
    const onMain = openOnMain(40 * 60)
    new StateStore(paths.state()).update((state) => ({
      ...state,
      entries: [...state.entries, { ...onMain, id: 'f0aa', key: 'k2', scope: { repoPath: repo, branch: 'formularseite' }, seconds: 600 }],
    }))
    commitOn('formularseite', 'Formular\n\nProsonata: Formular')

    await main(['post-commit'], repo)

    expect(err).not.toContain('take main')
  })
})

/*
 * The hook does at the switch what the editor's HEAD watch does (KONZEPT.md §5):
 * without it an agent's `git switch -c thema`, twenty minutes of work and a
 * commit put the twenty minutes on main.
 */
describe('the post-checkout hook', () => {
  const twentyMinutes = 20 * 60

  /** A timer on main that started twenty minutes ago. */
  function runningOnMain(): void {
    openOnMain(0)
    new StateStore(paths.state()).update((state) => ({
      ...state,
      timers: state.timers.map((timer) => ({ ...timer, startedAt: Date.now() - twentyMinutes * 1000 })),
    }))
  }

  function timers() {
    return new StateStore(paths.state()).read().state.timers
  }

  function head(): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  }

  /** What git passes: previous HEAD, new HEAD, and 1 for a branch checkout. */
  async function checkedOut(flag = '1'): Promise<number> {
    return await main(['post-checkout', head(), head(), flag], repo)
  }

  it('books the running segment to main at the switch and starts nothing on the new branch', async () => {
    runningOnMain()
    git(repo, 'switch', '--quiet', '-c', 'formularseite')

    expect(await checkedOut()).toBe(0)

    expect(stored()?.scope.branch).toBe('main')
    expect(stored()?.seconds).toBeGreaterThanOrEqual(twentyMinutes)
    expect(stored()?.seconds).toBeLessThan(twentyMinutes + 60)
    expect(timers().every((timer) => timer.startedAt === null)).toBe(true)
    expect(timers().some((timer) => timer.scope.branch === 'formularseite')).toBe(false)
    expect(err).toContain('switched from main — the time so far went there, and the timer is paused. To count on formularseite: "prosonata start"')
  })

  it('asks about the main time it just booked, with one note for an agent', async () => {
    runningOnMain()
    git(repo, 'switch', '--quiet', '-c', 'formularseite')

    await checkedOut()

    expect(err).toContain('0:20:00 open on main — if it belongs to this branch: "prosonata take main"')
    expect(err.split(AI_NOTE)).toHaveLength(2)
  })

  it('asks about open main time even when no timer was running', async () => {
    openOnMain(40 * 60)
    git(repo, 'switch', '--quiet', '-c', 'formularseite')

    await checkedOut()

    expect(err).not.toContain('switched from')
    expect(err).toContain('0:40:00 open on main — if it belongs to this branch: "prosonata take main"')
    expect(err).toContain(AI_NOTE)
  })

  it('leaves the timer running at a file checkout', async () => {
    runningOnMain()
    git(repo, 'switch', '--quiet', '-c', 'formularseite')

    await checkedOut('0')

    expect(timers()[0]?.startedAt).not.toBeNull()
    expect(err).toBe('')
  })

  // Each step of a rebase would otherwise cut a segment of its own.
  it('leaves the timer running on a detached HEAD', async () => {
    runningOnMain()
    git(repo, 'checkout', '--quiet', '--detach')

    await checkedOut()

    expect(timers()[0]?.startedAt).not.toBeNull()
    expect(err).toBe('')
  })

  it('leaves the timer running when the branch stays the same', async () => {
    runningOnMain()

    await checkedOut()

    expect(timers()[0]?.startedAt).not.toBeNull()
    expect(err).toBe('')
  })

  /*
   * With a window open the editor's HEAD watch comes second. It must not cut
   * again, and it must still ask whether to count on — the question it would
   * have asked had it been first.
   */
  it('leaves the editor nothing to cut, and tells it a switch happened', async () => {
    runningOnMain()
    const before = Date.now()
    git(repo, 'switch', '--quiet', '-c', 'formularseite')
    await checkedOut()

    const session = Session.open()
    const context = session.context(repo)!
    const segments = session.segments.read().length
    const seconds = stored()?.seconds

    expect(session.reconcileBranchSwitch(context)).toBeNull()
    expect(session.segments.read()).toHaveLength(segments)
    expect(stored()?.seconds).toBe(seconds)
    expect(session.switchedByHook(context, before)).toBe('main')
    // A switch from before the editor's last look is not this one.
    expect(session.switchedByHook(context, Date.now() + 1)).toBeNull()
  })

  it('forgets the switch once the timer runs again', async () => {
    runningOnMain()
    const before = Date.now()
    git(repo, 'switch', '--quiet', '-c', 'formularseite')
    await checkedOut()
    git(repo, 'switch', '--quiet', 'main')

    await main(['start'], repo)

    expect(timers()[0]?.switchedAt).toBeUndefined()
    git(repo, 'switch', '--quiet', 'formularseite')
    const session = Session.open()
    expect(session.switchedByHook(session.context(repo)!, before)).toBeNull()
  })
})

describe('closing an entry without time', () => {
  it('closes nothing and sends nothing', async () => {
    openOnMain(0)

    expect(await main(['close', 'Warenkorb'], repo)).toBe(1)

    expect(err).toContain('holds no time yet')
    expect(stored()).toMatchObject({ state: 'open', text: '' })
  })
})
