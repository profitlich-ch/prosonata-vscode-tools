import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { fixedClock } from './clock.js'
import { DEFAULTS, type Config } from './config.js'
import { FakeApi } from './fake-api.js'
import { Journal } from './journal.js'
import { send } from './sender.js'
import { describeRunningElsewhere, sync } from './sync.js'
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

  /*
   * Two people on one branch. The key is a hash of the root commit and the
   * branch name, so their clones compute the very same one — only the user
   * tells the entries apart, and `userID=myself` does that in the query.
   */
  it('leaves the entry of a colleague alone and starts its own', async () => {
    const api = new FakeApi()
    const theirs = await send(pendingFor(entryOf({ seconds: 3 * 3600, text: 'Buchungsmodul' })), deps(api), true)
    api.belongsToSomebodyElse(theirs.state.entries[0]!.timeId!)

    const outcome = await sync(emptyState(), api, config, options)
    expect(outcome.adopted).toBe(false)

    // And the own time becomes an entry of its own, next to theirs.
    const mine = entryOf({ id: 'local-2', seconds: 3600 })
    const sent = await send(pendingFor(mine), deps(api), true)

    expect(sent.state.entries[0]?.timeId).not.toBe(theirs.state.entries[0]?.timeId)
    expect(api.entries.size).toBe(2)
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

    // Parked, not closed: the time measured here still has to go somewhere, and
    // where is the user's decision (KONZEPT.md §3).
    const parked = outcome.state.entries[0]!
    expect(parked.awaitingDecision).toBe(true)
    expect(parked.remoteFinalSeconds).toBe(3600)
    expect(outcome.state.pending).toHaveLength(0)
  })
})

/**
 * Somebody measuring on another machine (KONZEPT.md §2). The signal is the time
 * bracket in the marker — it carries the day, which is what tells a timer that
 * runs right now from one forgotten last week.
 */
describe('a timer running on another machine', () => {
  const EIGHT_TWELVE = new Date(2026, 6, 30, 8, 12, 0).getTime()

  async function seen(detail: string): Promise<number | null> {
    const api = new FakeApi()
    const remote = await api.createEntry({
      projectID: 166,
      category: 70,
      date: '2026-07-30',
      detail,
      workingTime: '1.00',
    })
    const state: State = { ...emptyState(), entries: [entryOf({ timeId: remote.timeID })] }

    const outcome = await sync(state, api, config, { scope, key: KEY, projectId: 166, categoryId: 70, newId })
    return outcome.runningElsewhereSince
  }

  it('is read from the marker, with its day', async () => {
    expect(await seen(`[LAUFEND:${KEY}][260730-08:12] Buchungsmodul`)).toBe(EIGHT_TWELVE)
  })

  it('is absent while the marker carries no time', async () => {
    expect(await seen(`[LAUFEND:${KEY}] Buchungsmodul`)).toBeNull()
  })

  it('says the hour when it began today', () => {
    expect(describeRunningElsewhere(EIGHT_TWELVE, new Date(2026, 6, 30, 11, 0, 0).getTime())).toBe(
      'auf einem anderen Rechner läuft seit 08:12 ein Timer auf diesem Branch',
    )
  })

  it('names yesterday as yesterday', () => {
    expect(describeRunningElsewhere(EIGHT_TWELVE, new Date(2026, 6, 31, 11, 0, 0).getTime())).toContain('seit gestern 08:12')
  })

  // Older than that it is no longer news that somebody is working — it is the
  // suspicion that a timer was forgotten. Said out loud, not swallowed.
  it('calls an older mark what it probably is', () => {
    const message = describeRunningElsewhere(EIGHT_TWELVE, new Date(2026, 7, 3, 11, 0, 0).getTime())

    expect(message).toContain('seit 30.07. 08:12')
    expect(message).toContain('Anhalten vergessen')
  })
})
