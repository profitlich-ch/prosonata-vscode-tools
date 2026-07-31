import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { fixedClock } from './clock.js'
import { DEFAULTS, type Config } from './config.js'
import { FakeApi } from './fake-api.js'
import { Journal } from './journal.js'
import { send } from './sender.js'
import { sync } from './sync.js'
import { openEntry } from './tracking.js'
import { emptyState, type Scope, type State, type TimeEntry } from './types.js'

const scope: Scope = { repoPath: '/work/shop', branch: 'feature/buchung' }
const KEY = 'a3f9c1'
const NINE = new Date(2026, 6, 30, 9, 0, 0).getTime()

const config: Config = { ...DEFAULTS, baseUrl: 'https://x/api/v1', apiKey: 'k' }
let counter = 0
const newId = () => `sync-${++counter}`

function deps(api: FakeApi) {
  return {
    api,
    clock: fixedClock(NINE),
    config,
    journal: new Journal(join(mkdtempSync(join(tmpdir(), 'prosonata-')), 'log.jsonl')),
  }
}

function entryOf(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'local-1',
    key: KEY,
    scope,
    projectId: 166,
    categoryId: 70,
    text: 'Buchungsmodul',
    seconds: 0,
    foreignSeconds: 0,
    lastWritten: null,
    timeId: null,
    state: 'open',
    ...overrides,
  }
}

function pendingFor(entry: TimeEntry): State {
  return { ...emptyState(), entries: [entry], pending: [{ entryId: entry.id, since: NINE, closing: false }] }
}

const options = { scope, key: KEY, projectId: 166, categoryId: 70, newId }

describe('a machine that has never seen this branch', () => {
  it('finds the open entry by its marker and adopts it', async () => {
    const api = new FakeApi()
    // The office machine left three hours behind.
    await send(pendingFor(entryOf({ seconds: 3 * 3600 })), deps(api), true)

    const outcome = await sync(emptyState(), api, config, options)

    expect(outcome.adopted).toBe(true)
    const adopted = openEntry(outcome.state, scope)!
    expect(adopted.foreignSeconds).toBe(3 * 3600)
    expect(adopted.seconds).toBe(0)
    expect(adopted.text).toBe('Buchungsmodul')
    expect(adopted.timeId).toBeGreaterThan(0)
  })

  it('adds its own time on top without counting the foreign share twice', async () => {
    const api = new FakeApi()
    await send(pendingFor(entryOf({ seconds: 3 * 3600 })), deps(api), true)

    const { state } = await sync(emptyState(), api, config, options)
    const adopted = openEntry(state, scope)!
    adopted.seconds = 2 * 3600

    await send({ ...state, pending: [{ entryId: adopted.id, since: NINE, closing: false }] }, deps(api), true)

    expect(api.entries.get(adopted.timeId!)?.hours).toBe(5)
  })

  it('starts fresh when there is nothing to find', async () => {
    const api = new FakeApi()
    const outcome = await sync(emptyState(), api, config, options)

    expect(outcome.adopted).toBe(false)
    expect(outcome.state.entries).toHaveLength(0)
  })

  it('ignores an entry of another branch that happens to be open', async () => {
    const api = new FakeApi()
    await send(pendingFor(entryOf({ key: 'ffffff', text: 'Anderer Branch' })), deps(api), true)

    expect((await sync(emptyState(), api, config, options)).adopted).toBe(false)
  })
})

describe('recovery after a lost state', () => {
  it('is the very same path — an empty state adopts what ProSonata holds', async () => {
    const api = new FakeApi()
    const before = await send(pendingFor(entryOf({ seconds: 4 * 3600 })), deps(api), true)
    const timeId = before.state.entries[0]!.timeId!

    // state.json is gone.
    const { state, adopted } = await sync(emptyState(), api, config, options)

    expect(adopted).toBe(true)
    expect(openEntry(state, scope)?.timeId).toBe(timeId)
    expect(openEntry(state, scope)?.foreignSeconds).toBe(4 * 3600)
  })
})

describe('an entry closed on another machine', () => {
  it('is noticed by the missing marker', async () => {
    const api = new FakeApi()
    const open = await send(pendingFor(entryOf({ seconds: 3600 })), deps(api), true)
    const mine = open.state.entries[0]!

    // The office closes it: the marker disappears.
    const closed = { ...mine, state: 'closed' as const, text: 'Buchungsmodul, fertig' }
    await send({ ...open.state, entries: [closed], pending: [{ entryId: closed.id, since: NINE, closing: true }] }, deps(api), true)

    const outcome = await sync({ ...open.state, entries: [mine] }, api, config, options)

    expect(outcome.closedElsewhere).toBe(true)
    expect(outcome.state.entries[0]?.state).toBe('closed')
  })
})
