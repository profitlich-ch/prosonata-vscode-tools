import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type Quotation } from '../core/api.js'
import { paths } from '../core/config.js'
import { FakeApi } from '../core/fake-api.js'
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
 * A reference that matches no open entry used to become the text of this
 * branch's entry, which was then closed and sent.
 */
describe('closing by a reference that matches no open entry', () => {
  it('refuses an unknown id', async () => {
    openOnMain(1800, 'Warenkorb')

    expect(await main(['close', 'abc12345'], repo)).toBe(2)

    expect(err).toContain('no open entry abc12345')
    expect(stored()).toMatchObject({ state: 'open', text: 'Warenkorb' })
  })

  it('refuses a ProSonata number and points to sent', async () => {
    openOnMain(1800, 'Warenkorb')

    expect(await main(['close', '#2950'], repo)).toBe(2)
    expect(await main(['close', '2950'], repo)).toBe(2)

    expect(err).toContain('"prosonata sent"')
    expect(stored()).toMatchObject({ state: 'open', text: 'Warenkorb' })
  })

  it('still takes a text that begins with a number', async () => {
    openOnMain(1800)

    await main(['close', '2', 'Formulare', 'angepasst'], repo)

    expect(stored()).toMatchObject({ state: 'closed', text: '2 Formulare angepasst' })
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

describe('quotations', () => {
  let api: FakeApi

  beforeEach(() => {
    api = new FakeApi()
    const open = Session.open.bind(Session)
    vi.spyOn(Session, 'open').mockImplementation((options = {}) => open({ ...options, api }))
    rememberProject(repo, { id: 170, name: 'Wartung', no: 'P-2' })
    git(repo, 'config', '--local', 'prosonata.active', '166')
    api.quotations = [
      offer({ quotationID: 1, projectID: 166, quotationName: 'Relaunch', quotationDate: '2026-10-01' }),
      offer({ quotationID: 2, projectID: 166, quotationName: 'Nachtrag', quotationDate: '2026-11-01' }),
      offer({ quotationID: 3, projectID: 170, quotationName: 'Hosting', quotationDate: '2026-11-02' }),
    ]
  })

  function offer(extra: Partial<Quotation>): Quotation {
    return {
      quotationID: 0,
      quotationName: '',
      quotationHeadline: '',
      quotationDate: '',
      netValue: 100,
      grossValue: 108.1,
      currency: 1,
      isDraft: false,
      isSent: true,
      sentDate: null,
      approved: false,
      projectID: 0,
      projectNo: '',
      projectName: '',
      customerName: '',
      quotationComments: '',
      positions: [],
      ...extra,
    }
  }

  it("lists those of this repository's project, newest first, in one call", async () => {
    expect(await main(['quotations'], repo)).toBe(0)

    expect(out).toMatch(/^P-1 Shop\n {2}#2 .*Nachtrag\n {2}#1 .*Relaunch\n/)
    expect(out).not.toContain('Hosting')
    expect(api.calls).toEqual(['listQuotations 166'])
  })

  it('lists those of an earlier project of this repository by its number', async () => {
    expect(await main(['quotations', 'P-2'], repo)).toBe(0)

    expect(out).toContain('Hosting')
    expect(out).not.toContain('Relaunch')
  })

  it('refuses a number this repository does not know, without asking ProSonata', async () => {
    expect(await main(['quotations', 'P-9'], repo)).toBe(2)

    expect(err).toContain('known here: P-1, P-2')
    expect(api.calls).toEqual([])
  })

  it('prints JSON for an agent', async () => {
    expect(await main(['quotations', '--json'], repo)).toBe(0)

    expect((JSON.parse(out) as Quotation[]).map((row) => row.quotationID)).toEqual([2, 1])
  })

  it('refuses an option it does not know, without asking ProSonata', async () => {
    expect(await main(['quotations', '--all'], repo)).toBe(2)

    expect(err).toContain('unknown option: --all')
    expect(api.calls).toEqual([])
  })

  it('shows one quotation by its id, and says so when ProSonata has none', async () => {
    expect(await main(['quotation', '#3'], repo)).toBe(0)
    expect(out).toContain('#3  Hosting')

    expect(await main(['quotation', '99'], repo)).toBe(1)
    expect(err).toContain('ProSonata has no quotation #99')
  })

  it('refuses an id that is not a number', async () => {
    expect(await main(['quotation', 'Relaunch'], repo)).toBe(2)

    expect(api.calls).toEqual([])
  })
})

describe('everybody’s entries and a refused quotation', () => {
  let api: FakeApi

  beforeEach(() => {
    api = new FakeApi()
    const open = Session.open.bind(Session)
    vi.spyOn(Session, 'open').mockImplementation((options = {}) => open({ ...options, api }))
    api.projectTimes = [
      { projectID: 166, timeID: 1, date: '2026-11-01', username: 'm.profitlich', category: 7, categoryName: 'Programmierung', hours: 2, detail: 'Login', isInvoiced: false, notInvoiceable: false },
      { projectID: 166, timeID: 2, date: '2026-11-02', username: 'a.muster', category: 7, categoryName: 'Programmierung', hours: 1, detail: 'Suche', isInvoiced: false, notInvoiceable: false },
      { projectID: 170, timeID: 3, date: '2026-11-02', username: 'a.muster', category: 7, categoryName: 'Hosting', hours: 1, detail: '', isInvoiced: false, notInvoiceable: false },
    ]
  })

  it("lists the entries of everybody on this repository's project, with the sum", async () => {
    expect(await main(['entries'], repo)).toBe(0)

    expect(out).toContain('a.muster')
    expect(out).toContain('m.profitlich')
    expect(out).not.toContain('Hosting')
    expect(out).toContain('Total           3:00 h')
    expect(api.calls).toEqual(['listProjectTimes 166'])
  })

  it('says that the lowest group sees only its own', async () => {
    api.group = 'Zeiterfasser 1'

    expect(await main(['entries', '--json'], repo)).toBe(0)

    expect(err).toContain('«Zeiterfasser 1» sees only your own entries')
    expect((JSON.parse(out) as unknown[]).length).toBe(2)
  })

  it('turns a refusal of quotations into a sentence', async () => {
    api.failNext = new ApiError(403, 'Access denied.')

    expect(await main(['quotations'], repo)).toBe(1)

    expect(err).toContain('may not read quotations — they open from «Teamleiter» up')
  })
})
