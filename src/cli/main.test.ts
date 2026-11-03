import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '../core/config.js'
import { describeRepo } from '../core/git.js'
import { rememberCategory, rememberProject } from '../core/repo-config.js'
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

describe('closing an entry without time', () => {
  it('closes nothing and sends nothing', async () => {
    openOnMain(0)

    expect(await main(['close', 'Warenkorb'], repo)).toBe(1)

    expect(err).toContain('holds no time yet')
    expect(stored()).toMatchObject({ state: 'open', text: '' })
  })
})
