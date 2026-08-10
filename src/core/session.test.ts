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

/*
 * Every path a session writes to belongs in the temp directory — including the
 * segment log. Left out, it falls back to `~/.prosonata/segments.jsonl`, and a
 * test that pauses a timer would append to the machine's real archive.
 */
function sessionWith(api: FakeApi) {
  const dir = mkdtempSync(join(tmpdir(), 'prosonata-session-'))
  const config: Config = { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k' }
  return new Session(config, {
    api,
    clock: fixedClock(NINE),
    store: new StateStore(join(dir, 'state.json')),
    journal: new Journal(join(dir, 'log.jsonl')),
    segments: new SegmentLog(join(dir, 'segments.jsonl')),
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

  /*
   * Since the placeholder, the open entry usually stands in ProSonata already —
   * a running timer is enough. Its husk has to go, or the move would leave an
   * empty line on the customer's project.
   */
  it('deletes the husk of the open entry it emptied', async () => {
    const { api, session } = await afterCommit()
    const open = openEntry(session.state(), main.scope)!
    const husk = await api.createEntry({
      projectID: 166,
      category: 70,
      date: '2026-07-30',
      detail: '[LAUFEND:a3f9c1] (in Arbeit)',
      workingTime: '0.08',
    })
    session.store.update((state) => {
      state.entries.find((entry) => entry.id === open.id)!.timeId = husk.timeID
      return state
    })

    const result = await session.attachToLastClosed(main, async () => true)

    expect(result.kind).toBe('done')
    expect(api.entries.has(husk.timeID)).toBe(false)
    // And locally it lets go of the id, so the next time creates a fresh entry.
    expect(openEntry(session.state(), main.scope)?.timeId).toBeNull()
  })

  // A share measured elsewhere is not ours to delete, and nobody here knows
  // what those hours were.
  it('refuses when another machine has measured into the open entry', async () => {
    const { api, session } = await afterCommit()
    const open = openEntry(session.state(), main.scope)!
    session.store.update((state) => {
      const entry = state.entries.find((candidate) => candidate.id === open.id)!
      entry.timeId = 9999
      entry.foreignSeconds = 3600
      return state
    })
    api.calls.length = 0

    const result = await session.attachToLastClosed(main, async () => true)

    expect(result.kind).toBe('known')
    expect(api.calls.some((call) => call.startsWith('deleteEntry'))).toBe(false)
  })

  /*
   * Without a local target the key in the closed entry's marker is what finds it
   * — the whole reason the mark survives a close.
   */
  it('finds the target in ProSonata when the local state knows none', async () => {
    const { api, session, remote } = await afterCommit()
    session.store.update((state) => {
      state.entries = state.entries.filter((entry) => entry.state !== 'closed')
      return state
    })
    api.entries.get(remote.timeID)!.detail = '[a3f9c1] Kirby Update, Linkfarbe'

    const result = await session.attachToLastClosed(main, async () => true)

    expect(result.kind).toBe('done')
    expect(api.entries.get(remote.timeID)?.hours).toBeCloseTo(2 + 5 / 60, 2)
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

    expect(result.kind === 'done' && result.plan.before).toBe('2:15')
    expect(result.kind === 'done' && result.plan.after).toBe('2:15')
  })

  // A quarter-hour grid turns five minutes into a quarter hour. The number the
  // customer pays is the one that has to be shown before the click.
  it('shows the hours the grid will actually write', async () => {
    const { session } = await afterCommit({ grid: { kind: 'minutes', minutes: 15 } })

    const result = await session.attachToLastClosed(main, async () => true)

    expect(result.kind === 'done' && result.plan.after).toBe('2:15')
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

/**
 * The span of the working day, read from the segment log — the only place that
 * knows when work actually began and ended (KONZEPT.md §7).
 */
describe('the span an entry is written with', () => {
  function sessionWithLog() {
    const dir = mkdtempSync(join(tmpdir(), 'prosonata-span-'))
    const clock = fixedClock(NINE)
    const segments = new SegmentLog(join(dir, 'segments.jsonl'))
    const session = new Session(
      { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k' },
      {
        api: new FakeApi(),
        clock,
        store: new StateStore(join(dir, 'state.json')),
        journal: new Journal(join(dir, 'log.jsonl')),
        segments,
      },
    )
    return { session, segments, clock }
  }

  const segment = (entryId: string, from: number, until: number) => ({
    from: atLocal(from),
    until: atLocal(until),
    seconds: Math.round((until - from) / 1000),
    repoPath: scope.repoPath,
    branch: scope.branch,
    projectId: 166,
    entryId,
    reason: 'pause' as const,
  })

  const on = (day: number, hour: number, minute = 0) => new Date(2026, 6, day, hour, minute, 0).getTime()

  it('reaches from the first beginning to the last end', async () => {
    const { session, segments } = sessionWithLog()
    await session.start(context)
    const entry = openEntry(session.state(), scope)!
    segments.append(segment(entry.id, on(30, 8, 12), on(30, 11, 30)))
    segments.append(segment(entry.id, on(30, 13, 5), on(30, 17, 40)))

    expect(session.spanFor(entry)).toEqual({ start: '08:12', end: '17:40' })
  })

  // Over midnight a span would claim an attendance nobody had, so the fields
  // are cleared instead of carrying a half-truth.
  it('is nothing at all once the segments straddle two days', () => {
    const { session, segments } = sessionWithLog()
    const entry = { id: 'e1' } as never
    segments.append(segment('e1', on(29, 22, 40), on(29, 23, 50)))
    segments.append(segment('e1', on(30, 8, 12), on(30, 9, 30)))

    expect(session.spanFor(entry)).toBeNull()
  })

  /*
   * And it has to reach the write. A span the session computes but never hands
   * over would be as good as none — the same wiring the grid was missing.
   */
  it('arrives in ProSonata with the entry', async () => {
    const api = new FakeApi()
    const dir = mkdtempSync(join(tmpdir(), 'prosonata-span-'))
    const clock = fixedClock(NINE)
    const segments = new SegmentLog(join(dir, 'segments.jsonl'))
    const session = new Session(
      { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k' },
      { api, clock, store: new StateStore(join(dir, 'state.json')), journal: new Journal(join(dir, 'log.jsonl')), segments },
    )

    await session.start(context)
    const entry = openEntry(session.state(), scope)!
    segments.append(segment(entry.id, on(30, 8, 12), on(30, 8, 40)))
    session.store.update((state) => {
      state.entries[0]!.text = 'Buchungsmodul'
      state.timers = []
      state.pending = [{ entryId: entry.id, since: NINE, closing: false }]
      return state
    })

    await session.flush(true)

    const written = [...api.entries.values()][0]
    expect(written?.workingTimeStart).toBe('08:12:00')
    expect(written?.workingTimeEnd).toBe('08:40:00')
  })

  // While a timer runs the last recorded segment may be hours old; the end has
  // to follow the running one, or the entry would look long finished.
  it('counts the running segment towards the end', async () => {
    const { session, segments, clock } = sessionWithLog()
    await session.start(context)
    const entry = openEntry(session.state(), scope)!
    segments.append(segment(entry.id, on(30, 8, 12), on(30, 8, 40)))
    clock.advance(3 * 3600)

    expect(session.spanFor(entry)).toEqual({ start: '08:12', end: '12:00' })
  })
})

/**
 * Discarding a running segment: committed, forgot to stop, did no more work.
 * Nothing is booked — but the log has to keep what was thrown away.
 */
describe('throwing the running segment away', () => {
  it('books nothing, stops the timer, and says so in the log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prosonata-discard-'))
    const clock = fixedClock(NINE)
    const segments = new SegmentLog(join(dir, 'segments.jsonl'))
    const session = new Session(
      { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k' },
      {
        api: new FakeApi(),
        clock,
        store: new StateStore(join(dir, 'state.json')),
        journal: new Journal(join(dir, 'log.jsonl')),
        segments,
      },
    )

    await session.start(context)
    clock.advance(2 * 3600)
    session.keepFromRunning(context, 0)

    expect(openEntry(session.state(), scope)?.seconds).toBe(0)
    expect(session.state().timers[0]?.startedAt).toBeNull()

    // The one place where measured time disappears on purpose, so it must not
    // disappear silently as well.
    const line = segments.read().at(-1)
    expect(line?.reason).toBe('trimmed')
    expect(line?.seconds).toBe(0)
    expect(line?.ranSeconds).toBe(2 * 3600)
  })
})

/**
 * Which entry a segment belongs to. On the main branch a commit closes its entry
 * and opens the successor in the same step — so the log has to be told where the
 * time went, or every commit's segment would hang on the entry that comes after
 * the work (KONZEPT.md §7).
 */
describe('the entry a segment is filed under', () => {
  const main = { ...context, scope: { repoPath: '/work/shop', branch: 'main' }, mode: 'commit' } as RepoContext

  function loggingSession() {
    const dir = mkdtempSync(join(tmpdir(), 'prosonata-filing-'))
    const clock = fixedClock(NINE)
    const segments = new SegmentLog(join(dir, 'segments.jsonl'))
    const session = new Session(
      { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k' },
      {
        api: new FakeApi(),
        clock,
        store: new StateStore(join(dir, 'state.json')),
        journal: new Journal(join(dir, 'log.jsonl')),
        segments,
      },
    )
    return { session, segments, clock }
  }

  it('is the one the commit closed, not the one it opened', async () => {
    const { session, segments, clock } = loggingSession()

    await session.start(main)
    clock.advance(3600)
    const outcome = session.commit(main, { text: 'Kirby Update', fromTrailer: false, sha: 'deadbee' })

    const closed = outcome.state.entries.find((entry) => entry.state === 'closed')!
    const successor = outcome.state.entries.find((entry) => entry.state === 'open')!
    const measured = segments.read().find((segment) => segment.reason === 'commit')

    expect(measured?.entryId).toBe(closed.id)
    expect(measured?.entryId).not.toBe(successor.id)
  })

  /*
   * The closing line: it says where one invoice line ends, so the entry's text
   * need not stand on every row. It carries the total, not time of its own.
   */
  it('gets a closing line when a commit finishes an entry', async () => {
    const { session, segments, clock } = loggingSession()

    await session.start(main)
    clock.advance(3600)
    session.commit(main, { text: 'Kirby Update', fromTrailer: false, sha: 'deadbee' })

    const line = segments.read().at(-1)
    expect(line?.reason).toBe('entry')
    expect(line?.seconds).toBe(0)
    expect(line?.bookedSeconds).toBe(3600)
    expect(line?.from).toBeUndefined()
  })

  it('gets one when somebody closes an entry by hand', async () => {
    const { session, segments, clock } = loggingSession()

    await session.start(context)
    clock.advance(1800)
    session.pause(context)
    const entry = openEntry(session.state(), scope)!
    session.closeEntry(entry.id, 'Buchungsmodul, fertig')

    const line = segments.read().at(-1)
    expect(line?.reason).toBe('entry')
    expect(line?.bookedSeconds).toBe(1800)
    expect(session.state().entries.find((candidate) => candidate.id === entry.id)?.state).toBe('closed')
  })
})
