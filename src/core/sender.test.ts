import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ApiError } from './api.js'
import { fixedClock } from './clock.js'
import { DEFAULTS, type Config } from './config.js'
import { FakeApi } from './fake-api.js'
import { Journal } from './journal.js'
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

  it('holds back an entry that has no text yet', async () => {
    const { api, deps } = setup()
    const { state } = await send(stateWith(entry({ text: '' })), deps, true)

    expect(api.entries.size).toBe(0)
    expect(state.pending).toHaveLength(1)
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
  it('goes out without the marker', async () => {
    const { api, deps } = setup()
    const closed = entry({ state: 'closed', text: 'Buchungsmodul, fertig' })
    await send(stateWith(closed), deps, true)

    expect([...api.entries.values()][0]?.detail).toBe('Buchungsmodul, fertig')
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
