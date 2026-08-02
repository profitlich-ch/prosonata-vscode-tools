import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ApiError } from './api.js'
import { fixedClock } from './clock.js'
import { DEFAULTS, type Config } from './config.js'
import { FakeApi } from './fake-api.js'
import { Journal } from './journal.js'
import { Session, type RepoContext } from './session.js'
import { SegmentLog, atLocal } from './segments.js'
import { StateStore } from './state-store.js'
import { openEntry } from './tracking.js'

/**
 * Starting a timer is where a machine arrives at a branch (KONZEPT.md §3): the
 * moment to ask whether ProSonata already holds an entry for it.
 */

const NINE = new Date(2026, 6, 30, 9, 0, 0).getTime()
const scope = { repoPath: '/work/shop', branch: 'feature/buchung' }

const context = {
  repo: { root: '/work/shop', branch: 'feature/buchung', rootCommit: 'abc', headFile: '/work/shop/.git/HEAD' },
  scope,
  key: 'a3f9c1',
  mainBranch: 'main',
  mode: 'branch',
  config: { projects: [], activeProjectId: 166, categories: new Map(), categoryNames: new Map(), grid: null, modes: new Map() },
  projectId: 166,
  categoryId: 70,
} as unknown as RepoContext

function sessionWith(api: FakeApi) {
  const dir = mkdtempSync(join(tmpdir(), 'prosonata-session-'))
  const config: Config = { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k' }
  return new Session(config, {
    api,
    clock: fixedClock(NINE),
    store: new StateStore(join(dir, 'state.json')),
    journal: new Journal(join(dir, 'log.jsonl')),
  })
}

describe('starting the timer', () => {
  it('adopts the entry ProSonata already holds for this branch', async () => {
    const api = new FakeApi()
    const remote = await api.createEntry({
      projectID: 166,
      category: 70,
      date: '2026-07-30',
      detail: '[LAUFEND:a3f9c1] Buchungsmodul',
      workingTime: '3.00',
    })

    const session = sessionWith(api)
    await session.start(context)

    const entry = openEntry(session.state(), scope)
    expect(entry?.timeId).toBe(remote.timeID)
    expect(entry?.foreignSeconds).toBe(3 * 3600)
    expect(entry?.text).toBe('Buchungsmodul')
  })

  it('starts anyway when ProSonata cannot be reached', async () => {
    const api = new FakeApi()
    api.failNext = new ApiError(0, 'keine Verbindung zu ProSonata: fetch failed')

    const session = sessionWith(api)
    await session.start(context)

    // Measuring works without a network; only sending does not.
    expect(session.state().timers[0]?.startedAt).toBe(NINE)
  })

  it('asks only when there is no entry of its own yet', async () => {
    const api = new FakeApi()
    const session = sessionWith(api)

    await session.start(context)
    api.calls.length = 0
    session.pause(context)
    await session.start(context)

    expect(api.calls).toEqual([])
  })
})

describe('answering "closed on another machine"', () => {
  async function parked() {
    const api = new FakeApi()
    const remote = await api.createEntry({
      projectID: 166,
      category: 70,
      date: '2026-07-30',
      detail: 'Buchungsmodul, fertig',
      workingTime: '1.00',
    })

    const session = sessionWith(api)
    await session.start(context)
    session.store.update((state) => {
      const entry = state.entries[0]!
      entry.timeId = remote.timeID
      entry.text = 'Buchungsmodul'
      entry.seconds = 1500
      entry.foreignSeconds = 3600
      entry.awaitingDecision = true
      entry.remoteFinalSeconds = 3600
      return state
    })
    return { api, session, remote, entryId: session.state().entries[0]!.id }
  }

  it('"add" writes the sum alone, so the final text stays untouched', async () => {
    const { api, session, remote, entryId } = await parked()
    api.calls.length = 0

    await session.resolveClosedElsewhere(entryId, 'add')

    // One hour over there plus the 25 minutes measured here.
    expect(api.entries.get(remote.timeID)?.hours).toBeCloseTo(1 + 25 / 60, 2)
    expect(api.entries.get(remote.timeID)?.detail).toBe('Buchungsmodul, fertig')

    const entry = session.state().entries[0]!
    expect(entry.timeId).toBeNull()
    expect(entry.seconds).toBe(0)
    expect(entry.awaitingDecision).toBeUndefined()
  })

  it('"fresh" does not touch the closed entry at all', async () => {
    const { api, session, remote, entryId } = await parked()
    api.calls.length = 0

    await session.resolveClosedElsewhere(entryId, 'fresh')

    expect(api.calls).toEqual([])
    expect(api.entries.get(remote.timeID)?.hours).toBe(1)

    const entry = session.state().entries[0]!
    expect(entry.timeId).toBeNull()
    expect(entry.seconds).toBe(1500)
  })
})

describe('the boundary a correction must not set', () => {
  it('is the end of the last measured segment, not the moment an amount was typed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prosonata-grenze-'))
    const segments = new SegmentLog(join(dir, 'segments.jsonl'))
    const base = { repoPath: scope.repoPath, branch: scope.branch, projectId: 166, entryId: 'e1' }

    segments.append({ ...base, from: atLocal(NINE), until: atLocal(NINE + 3600_000), seconds: 3600, reason: 'pause' })
    // Typed an hour later: it says nothing about when any work happened.
    segments.append({ ...base, until: atLocal(NINE + 7200_000), seconds: -900, reason: 'correction' })

    const session = new Session(
      { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k' },
      { api: new FakeApi(), clock: fixedClock(NINE), store: new StateStore(join(dir, 'state.json')), journal: new Journal(join(dir, 'log.jsonl')), segments },
    )

    expect(session.lastSegmentEnd(context)).toBe(NINE + 3600_000)
  })
})

/**
 * Follow-up work after a commit (KONZEPT.md §3). On the main branch the commit
 * closes its entry and the timer runs on into a new one — whatever is measured
 * from then on would travel with the *next* commit, under its text.
 */
describe('adding follow-up time to the entry a commit closed', () => {
  const main = { ...context, scope: { repoPath: '/work/shop', branch: 'main' }, mode: 'commit' } as RepoContext

  async function afterCommit(options: { invoiced?: boolean; grid?: Config['grid']; hours?: string } = {}) {
    const api = new FakeApi()
    const clock = fixedClock(NINE)
    const dir = mkdtempSync(join(tmpdir(), 'prosonata-attach-'))
    const config: Config = { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k', ...(options.grid ? { grid: options.grid } : {}) }
    const session = new Session(config, {
      api,
      clock,
      store: new StateStore(join(dir, 'state.json')),
      journal: new Journal(join(dir, 'log.jsonl')),
      segments: new SegmentLog(join(dir, 'segments.jsonl')),
    })

    await session.start(main)
    clock.advance(2 * 3600)
    session.commit(main, { text: 'Kirby Update, Linkfarbe', fromTrailer: false, sha: 'deadbee' })

    // As if the closing write had gone out: ProSonata holds the two hours.
    const remote = await api.createEntry({
      projectID: 166,
      category: 70,
      date: '2026-07-30',
      detail: 'Kirby Update, Linkfarbe',
      workingTime: options.hours ?? '2.00',
    })
    if (options.invoiced) api.entries.get(remote.timeID)!.isInvoiced = true
    session.store.update((state) => {
      const closed = state.entries.find((entry) => entry.state === 'closed')!
      closed.timeId = remote.timeID
      closed.lastWritten = closed.seconds
      state.pending = []
      return state
    })

    // Five minutes of follow-up, the timer still running.
    clock.advance(300)
    api.calls.length = 0
    return { api, session, clock, remote }
  }

  it('adds the minutes to the closed entry and leaves its text alone', async () => {
    const { api, session, remote } = await afterCommit()

    const result = await session.attachToLastClosed(main, async () => true)

    expect(result.kind).toBe('done')
    expect(api.entries.get(remote.timeID)?.hours).toBeCloseTo(2 + 5 / 60, 2)
    expect(api.entries.get(remote.timeID)?.detail).toBe('Kirby Update, Linkfarbe')
    // Gone from here, so the next commit cannot book the same minutes again.
    expect(openEntry(session.state(), main.scope)?.seconds).toBe(0)
  })

  // Somebody may have corrected the entry in ProSonata by hand. The write is a
  // sum, so the sum has to start from what stands there, not from what we
  // remember writing.
  it('counts from what ProSonata holds, not from the local number', async () => {
    const { api, session, remote } = await afterCommit({ hours: '3.00' })

    await session.attachToLastClosed(main, async () => true)

    expect(api.entries.get(remote.timeID)?.hours).toBeCloseTo(3 + 5 / 60, 2)
  })

  it('refuses an invoiced entry without asking anybody', async () => {
    const { api, session, remote } = await afterCommit({ invoiced: true })

    const result = await session.attachToLastClosed(main, async () => {
      throw new Error('darf nicht gefragt werden')
    })

    expect(result.kind).toBe('invoiced')
    expect(api.entries.get(remote.timeID)?.hours).toBe(2)
    expect(api.calls.some((call) => call.startsWith('updateEntry'))).toBe(false)
  })

  /*
   * The grid rounds up, so a small amount never disappears — but it can land in
   * the quarter hour that was already being charged. Then the confirmation has
   * to say that the hours do not move, or one confirms a write for nothing.
   */
  it('says when the grid leaves the hours where they are', async () => {
    const { session } = await afterCommit({ grid: { kind: 'minutes', minutes: 15 }, hours: '2.05' })

    const result = await session.attachToLastClosed(main, async () => true)

    expect(result.kind === 'done' && result.plan.before).toBe('2.25')
    expect(result.kind === 'done' && result.plan.after).toBe('2.25')
  })

  // A quarter-hour grid turns five minutes into a quarter hour. The number the
  // customer pays is the one that has to be shown before the click.
  it('shows the hours the grid will actually write', async () => {
    const { session } = await afterCommit({ grid: { kind: 'minutes', minutes: 15 } })

    const result = await session.attachToLastClosed(main, async () => true)

    expect(result.kind === 'done' && result.plan.after).toBe('2.25')
  })

  it('writes nothing when the answer is no', async () => {
    const { api, session, remote } = await afterCommit()

    const result = await session.attachToLastClosed(main, async () => false)

    expect(result.kind).toBe('cancelled')
    expect(api.entries.get(remote.timeID)?.hours).toBe(2)
    // The measured time stays where it was, ready for the next commit.
    expect(openEntry(session.state(), main.scope)?.seconds).toBe(300)
  })

  it('has nothing to add to on a branch that never closed an entry', async () => {
    const api = new FakeApi()
    const session = sessionWith(api)
    await session.start(context)
    session.store.update((state) => {
      state.entries[0]!.seconds = 300
      return state
    })

    expect((await session.attachToLastClosed(context, async () => true)).kind).toBe('noTarget')
  })
})
