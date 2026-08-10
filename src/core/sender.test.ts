import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ApiError } from './api.js'
import { fixedClock } from './clock.js'
import { DEFAULTS, type Config } from './config.js'
import { FakeApi } from './fake-api.js'
import { Journal } from './journal.js'
import { isMarkedOpen, readKey } from './marker.js'
import { adoptForeignShare, dueWrites, send, type SendDeps } from './sender.js'
import { emptyState, type State, type TimeEntry } from './types.js'

const NINE = new Date(2026, 6, 30, 9, 0, 0).getTime()

function setup(overrides: Partial<Config> = {}) {
  const api = new FakeApi()
  const clock = fixedClock(NINE)
  const journal = new Journal(join(mkdtempSync(join(tmpdir(), 'prosonata-')), 'log.jsonl'))
  const config: Config = { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k', ...overrides }
  return { api, clock, journal, config, deps: { api, clock, journal, config } satisfies SendDeps }
}

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e1',
    key: 'a3f9c1',
    scope: { repoPath: '/work/shop', branch: 'feature/buchung' },
    projectId: 166,
    categoryId: 70,
    text: 'Buchungsmodul',
    seconds: 3600,
    foreignSeconds: 0,
    lastWritten: null,
    timeId: null,
    state: 'open',
    ...overrides,
  }
}

function stateWith(e: TimeEntry, since = NINE): State {
  return { ...emptyState(), entries: [e], pending: [{ entryId: e.id, since, closing: false }] }
}

describe('when a write becomes due', () => {
  it('waits for the configured delay', () => {
    const { clock, config } = setup()
    const state = stateWith(entry())

    expect(dueWrites(state, clock, config.sendDelaySeconds)).toEqual([])

    clock.advance(config.sendDelaySeconds)
    expect(dueWrites(state, clock, config.sendDelaySeconds)).toEqual(['e1'])
  })
})

describe('the first write', () => {
  it('creates the entry with the marker in front of the text', async () => {
    const { api, deps } = setup()
    const { state } = await send(stateWith(entry()), deps, true)

    const created = [...api.entries.values()][0]!
    expect(created.detail).toBe('[LAUFEND:a3f9c1] Buchungsmodul')
    expect(created.hours).toBe(1)
    expect(state.entries[0]?.timeId).toBe(created.timeID)
    expect(state.pending).toHaveLength(0)
  })

  /*
   * Without a text it goes out under a placeholder rather than waiting: only an
   * entry that exists over there is findable from the second machine, and the
   * first trailer replaces the stand-in.
   */
  it('creates an entry that has no text yet under a placeholder', async () => {
    const { api, deps } = setup()

    const { state } = await send(stateWith(entry({ text: '' })), deps, true)

    expect([...api.entries.values()][0]?.detail).toBe('[LAUFEND:a3f9c1] (in Arbeit)')
    // Locally it stays text-less, so the panel keeps asking for a real one.
    expect(state.entries[0]?.text).toBe('')
    expect(state.pending).toHaveLength(0)
  })

  // `category` is mandatory in ProSonata; a 0 would be refused or land nowhere.
  it('holds back an entry with no category and names the reason', async () => {
    const { api, deps } = setup()
    const { state, result } = await send(stateWith(entry({ categoryId: 0 })), deps, true)

    expect(api.entries.size).toBe(0)
    expect(state.pending).toHaveLength(1)
    expect(result.missingCategory).toEqual(['e1'])
  })
})

describe('a closed entry', () => {
  /*
   * The word goes, the key stays: `LAUFEND` on a finished entry would be a lie,
   * while the key is what makes it findable again — for follow-up time, for a
   * lost state, for a rolled-back commit.
   */
  it('keeps its key and loses the word', async () => {
    const { api, deps } = setup()
    const closed = entry({ state: 'closed', text: 'Buchungsmodul, fertig' })

    await send(stateWith(closed), deps, true)

    expect([...api.entries.values()][0]?.detail).toBe('[a3f9c1] Buchungsmodul, fertig')
  })

  it('is told from an open one by the word, not by the bracket', async () => {
    const { api, deps } = setup()

    await send(stateWith(entry({ state: 'closed', text: 'fertig' })), deps, true)
    const detail = [...api.entries.values()][0]!.detail

    expect(isMarkedOpen(detail)).toBe(false)
    expect(readKey(detail)).toBe('a3f9c1')
  })
})

describe('two machines on the same branch', () => {
  it('adds to what the other machine wrote instead of overwriting it', async () => {
    const { api, deps } = setup()

    // The office machine writes three hours.
    const office = await send(stateWith(entry({ seconds: 3 * 3600 })), deps, true)
    const timeId = office.state.entries[0]!.timeId!
    expect(api.entries.get(timeId)?.hours).toBe(3)

    // The machine at home finds the entry and adopts it: foreign three hours,
    // own two on top.
    const home = entry({ id: 'e2', seconds: 2 * 3600, timeId, foreignSeconds: 3 * 3600 })
    await send(stateWith(home), deps, true)

    expect(api.entries.get(timeId)?.hours).toBe(5)
  })

  it('notices a foreign write between two of its own', async () => {
    const { api, deps } = setup()

    const first = await send(stateWith(entry({ seconds: 3600 })), deps, true)
    const mine = first.state.entries[0]!
    const timeId = mine.timeId!

    // Another machine adds an hour behind our back.
    api.entries.get(timeId)!.hours = 2

    // We book another hour: two of ours plus the foreign one.
    const again = await send(stateWith({ ...mine, seconds: 2 * 3600 }), deps, true)

    expect(api.entries.get(timeId)?.hours).toBe(3)
    expect(again.state.entries[0]?.foreignSeconds).toBe(3600)
  })

  it('derives the foreign share from the difference to the last write', () => {
    const e = entry({ seconds: 3600, lastWritten: 3600, foreignSeconds: 0 })
    adoptForeignShare(e, 2.5)
    expect(e.foreignSeconds).toBe(Math.round(1.5 * 3600))
  })

  it('takes the whole remote total as foreign when adopting a found entry', () => {
    const e = entry({ seconds: 0, lastWritten: null })
    adoptForeignShare(e, 3)
    expect(e.foreignSeconds).toBe(3 * 3600)
  })
})

describe('an invoiced entry', () => {
  it('does not grow, a follow-up carries the remainder', async () => {
    const { api, deps } = setup()

    const first = await send(stateWith(entry({ seconds: 3600 })), deps, true)
    const mine = first.state.entries[0]!
    api.entries.get(mine.timeId!)!.isInvoiced = true

    const more = await send(stateWith({ ...mine, seconds: 2 * 3600 }), deps, true)

    expect(api.entries.get(mine.timeId!)?.hours).toBe(1)
    const follow = more.state.entries[0]!
    expect(follow.timeId).not.toBe(mine.timeId)
    expect(api.entries.get(follow.timeId!)?.hours).toBe(1)
    expect(follow.foreignSeconds).toBe(0)
  })
})

describe('a text over the limit', () => {
  it('is not sent, because ProSonata would truncate it silently', async () => {
    const { api, deps } = setup({ detailLimit: 50 })
    const long = entry({ text: 'x'.repeat(80) })

    const { state, result } = await send(stateWith(long), deps, true)

    expect(api.entries.size).toBe(0)
    expect(result.tooLong[0]?.limit).toBe(50)
    // It stays pending so nothing is lost once the text is shortened.
    expect(state.pending).toHaveLength(1)
  })

  it('counts the marker towards the limit', async () => {
    const { deps, config } = setup({ detailLimit: 30 })
    const e = entry({ text: 'a'.repeat(20) })
    const { result } = await send(stateWith(e), deps, true)

    // 20 characters of text plus "[LAUFEND:a3f9c1] " is over 30.
    expect(result.tooLong[0]?.length).toBeGreaterThan(config.detailLimit)
  })
})

describe('when sending fails', () => {
  it('keeps a rate-limited write pending for the next attempt', async () => {
    const { api, deps } = setup()
    api.failNext = new ApiError(429, 'too many requests')

    const { state, result } = await send(stateWith(entry()), deps, true)

    expect(result.failed).toHaveLength(1)
    expect(state.pending).toHaveLength(1)
  })

  it('succeeds on the retry', async () => {
    const { api, deps } = setup()
    api.failNext = new ApiError(500, 'server having a bad moment')

    let state = stateWith(entry())
    ;({ state } = await send(state, deps, true))
    expect(state.pending).toHaveLength(1)

    ;({ state } = await send(state, deps, true))
    expect(state.pending).toHaveLength(0)
    expect(api.entries.size).toBe(1)
  })
})

describe('an entry deleted in ProSonata', () => {
  it('is created again rather than resurrected by id', async () => {
    const { api, deps } = setup()
    const first = await send(stateWith(entry()), deps, true)
    const gone = first.state.entries[0]!
    api.entries.delete(gone.timeId!)

    const again = await send(stateWith({ ...gone, seconds: 7200 }), deps, true)

    expect(again.state.entries[0]?.timeId).not.toBe(gone.timeId)
    expect(api.entries.size).toBe(1)
  })
})

/*
 * Closed on another machine: the marker is gone from `detail` while we still
 * hold the entry open. Writing would put the marker back and overwrite the
 * final text — the entry belongs to whoever closed it (KONZEPT.md §3).
 */
describe('an entry closed on another machine', () => {
  it('is parked instead of written', async () => {
    const { api, deps } = setup()
    const first = await send(stateWith(entry({ seconds: 3600 })), deps, true)
    const timeId = first.state.entries[0]!.timeId!

    // Somebody closes it over there: marker gone, final text set.
    api.entries.get(timeId)!.detail = 'Buchungsmodul, fertig'
    api.calls.length = 0

    const local = { ...first.state.entries[0]!, seconds: 3600 + 900 }
    const { state, result } = await send(
      { ...first.state, entries: [local], pending: [{ entryId: local.id, since: NINE, closing: false }] },
      deps,
      true,
    )

    expect(result.awaitingDecision).toEqual([local.id])
    expect(result.sent).toEqual([])
    expect(api.calls.some((call) => call.startsWith('updateEntry'))).toBe(false)
    expect(api.entries.get(timeId)?.detail).toBe('Buchungsmodul, fertig')

    const parked = state.entries[0]!
    expect(parked.awaitingDecision).toBe(true)
    expect(parked.remoteFinalSeconds).toBe(3600)
    expect(state.pending).toHaveLength(0)
  })

  it('stays parked when a commit queues it again', async () => {
    const { api, deps } = setup()
    const parked = entry({ seconds: 900, timeId: 4711, awaitingDecision: true, remoteFinalSeconds: 3600 })

    const { state, result } = await send(stateWith(parked), deps, true)

    expect(result.awaitingDecision).toEqual([parked.id])
    expect(api.calls).toEqual([])
    expect(state.pending).toHaveLength(0)
  })
})

/*
 * "A timer is running here" needs no field of its own: the presence of
 * `workingTimeStart` says it, and null takes it back. Measured against the
 * account — an empty string would write 01:00:00 instead of clearing.
 */
describe('the running mark', () => {
  const timerOn = (entryId: string, startedAt: number | null) => ({
    id: 't1',
    origin: 'local' as const,
    remoteTimerId: null,
    scope: { repoPath: '/work/shop', branch: 'feature/buchung' },
    startedAt,
    entryId,
  })

  it('rides along in the marker while the timer runs', async () => {
    const { api, deps } = setup()
    const nineTwelve = new Date(2026, 6, 30, 9, 12, 0).getTime()
    const state = { ...stateWith(entry()), timers: [timerOn('e1', nineTwelve)] }

    const { state: after } = await send(state, deps, true)

    expect(api.entries.get(after.entries[0]!.timeId!)?.detail).toBe('[LAUFEND:a3f9c1][260730-09:12] Buchungsmodul')
  })

  it('is taken back by the next write once the timer stands still', async () => {
    const { api, deps } = setup()
    const nineTwelve = new Date(2026, 6, 30, 9, 12, 0).getTime()
    const first = await send({ ...stateWith(entry()), timers: [timerOn('e1', nineTwelve)] }, deps, true)
    const timeId = first.state.entries[0]!.timeId!

    const paused = {
      ...first.state,
      timers: [timerOn('e1', null)],
      pending: [{ entryId: 'e1', since: NINE, closing: false }],
    }
    await send(paused, deps, true)

    expect(api.entries.get(timeId)?.detail).toBe('[LAUFEND:a3f9c1] Buchungsmodul')
  })

  // The status used to sit in `workingTimeStart`. It does not any more, and the
  // field must stay free for the span — otherwise both would fight over it.
  it('leaves workingTimeStart alone', async () => {
    const { api, deps } = setup()
    const nineTwelve = new Date(2026, 6, 30, 9, 12, 0).getTime()

    const { state: after } = await send({ ...stateWith(entry()), timers: [timerOn('e1', nineTwelve)] }, deps, true)

    expect(api.entries.get(after.entries[0]!.timeId!)?.workingTimeStart).toBeNull()
  })
})

/*
 * The span of the working day. It only says something for a single day, so the
 * session hands over `null` as soon as the segments straddle midnight — and
 * `null` has to clear what stands there, or a span would outlive its truth.
 */
describe('the span of the working day', () => {
  it('writes the beginning and the end into the two fields', async () => {
    const { api, deps } = setup()

    const { state: after } = await send(stateWith(entry()), { ...deps, spanFor: () => ({ start: '08:12', end: '17:40' }) }, true)

    const written = api.entries.get(after.entries[0]!.timeId!)
    expect(written?.workingTimeStart).toBe('08:12:00')
    expect(written?.workingTimeEnd).toBe('17:40:00')
  })

  it('clears both fields again once no single day can be named', async () => {
    const { api, deps } = setup()
    const first = await send(stateWith(entry()), { ...deps, spanFor: () => ({ start: '08:12', end: '17:40' }) }, true)
    const timeId = first.state.entries[0]!.timeId!

    const later = { ...first.state, pending: [{ entryId: 'e1', since: NINE, closing: false }] }
    await send(later, { ...deps, spanFor: () => null }, true)

    expect(api.entries.get(timeId)?.workingTimeStart).toBeNull()
    expect(api.entries.get(timeId)?.workingTimeEnd).toBeNull()
  })
})

/*
 * A repository may round differently from the default. What counts is the grid
 * at the moment of writing: choosing 15 minutes is meant to reach every entry
 * still open, exactly as a corrected project or category does.
 */
describe('the grid a repository rounds by', () => {
  it('rounds the write by the repository, not by the default', async () => {
    const { api, clock, deps } = setup({ grid: { kind: 'exact' } })
    const state = stateWith(entry({ seconds: 2 * 3600 + 300 }))
    clock.advance(DEFAULTS.sendDelaySeconds)

    await send(state, { ...deps, gridFor: () => ({ kind: 'minutes', minutes: 15 }) })

    // 2:05 h measured, and the grid rounds up to the next quarter hour.
    expect([...api.entries.values()][0]?.hours).toBeCloseTo(2.25, 2)
  })

  it('falls back to the default when the repository has none', async () => {
    const { api, clock, deps } = setup({ grid: { kind: 'minutes', minutes: 30 } })
    const state = stateWith(entry({ seconds: 2 * 3600 + 300 }))
    clock.advance(DEFAULTS.sendDelaySeconds)

    await send(state, { ...deps, gridFor: () => deps.config.grid })

    expect([...api.entries.values()][0]?.hours).toBeCloseTo(2.5, 2)
  })
})

describe('an entry without a text', () => {
  it('is held back even once it is closed', async () => {
    const { api, clock, deps } = setup()
    const state = stateWith(entry({ text: '', state: 'closed' }))
    clock.advance(DEFAULTS.sendDelaySeconds)

    const { state: after, result } = await send(state, deps)

    expect(api.entries.size).toBe(0)
    expect(result.sent).toEqual([])
    // It stays pending, and the panel shows the backlog — better than a
    // nameless line on a customer's project.
    expect(after.pending).toHaveLength(1)
  })
})
