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
