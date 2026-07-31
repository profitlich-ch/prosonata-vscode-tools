import { describe, expect, it } from 'vitest'

import { fixedClock } from './clock.js'
import { close, commit, currentSeconds, openEntry, pause, start } from './tracking.js'
import { emptyState, type Scope, type State } from './types.js'

const scope: Scope = { repoPath: '/work/shop', branch: 'feature/buchung' }
const main: Scope = { repoPath: '/work/shop', branch: 'main' }

/** 2026-07-30, 09:00 local time. */
const NINE = new Date(2026, 6, 30, 9, 0, 0).getTime()
const at = (hour: number, minute = 0) => new Date(2026, 6, 30, hour, minute, 0).getTime()

let counter = 0
const newId = () => `id-${++counter}`

function startOn(state: State, clock: ReturnType<typeof fixedClock>, target = scope) {
  return start(state, clock, {
    scope: target,
    key: 'a3f9c1',
    projectId: 166,
    categoryId: 70,
    mode: target === main ? 'commit' : 'branch',
    newId,
  })
}

function commitOn(state: State, target: Scope, when: number, text: string, fromTrailer = false) {
  return commit(state, {
    scope: target,
    mode: target === main ? 'commit' : 'branch',
    text,
    fromTrailer,
    sha: 'abc1234',
    at: when,
    newId,
    projectId: 166,
    categoryId: 70,
    key: 'a3f9c1',
  })
}

describe('the example from KONZEPT.md §3', () => {
  it('books 1.75 h when a commit cuts the running segment', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)

    clock.advance(3600) // 10:00
    state = pause(state, clock, scope)

    clock.advance(1800) // 10:30
    state = startOn(state, clock)

    const result = commitOn(state, scope, at(11, 15), 'Buchungsmodul')
    state = result.state

    // 1 h before the pause plus 45 min up to the commit.
    expect(openEntry(state, scope)?.seconds).toBe(6300)
    expect(6300 / 3600).toBeCloseTo(1.75)
  })

  it('starts the next segment at the commit, not at zero elapsed', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)

    const result = commitOn(state, scope, at(10, 0), 'Zwischenstand')
    state = result.state

    clock.advance(7200) // 11:00, one hour after the commit
    expect(currentSeconds(state, clock, scope)).toBe(3600 + 3600)
  })
})

describe('a commit on a branch', () => {
  it('leaves the entry open', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)

    const result = commitOn(state, scope, at(9, 10), 'fix: Rundungsfehler')
    expect(result.closed).toBeNull()
    expect(openEntry(result.state, scope)?.state).toBe('open')
  })

  it('replaces the text only when it came from a trailer', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    state = close(state, openEntry(state, scope)!.id, 'Buchungsmodul', at(9, 1), newId)

    state = startOn(state, clock)
    const entryId = openEntry(state, scope)!.id
    state = commitOn(state, scope, at(9, 30), 'Buchungsmodul', true).state
    expect(openEntry(state, scope)?.id).toBe(entryId)

    const withSubject = commitOn(state, scope, at(9, 40), 'chore: Tippfehler', false)
    expect(openEntry(withSubject.state, scope)?.text).toBe('Buchungsmodul')

    const withTrailer = commitOn(state, scope, at(9, 40), 'Rabattstufen', true)
    expect(openEntry(withTrailer.state, scope)?.text).toBe('Rabattstufen')
  })

  it('keeps the timer running', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    state = commitOn(state, scope, at(9, 30), 'Zwischenstand').state

    expect(state.timers[0]?.startedAt).toBe(at(9, 30))
  })
})

describe('a commit on the main branch', () => {
  it('closes an entry of its own and opens a successor', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock, main)
    clock.advance(1800)

    const result = commitOn(state, main, at(9, 30), 'fix: Tippfehler in der Fussleiste')
    state = result.state

    expect(result.closed?.state).toBe('closed')
    expect(result.closed?.text).toBe('fix: Tippfehler in der Fussleiste')
    expect(result.closed?.seconds).toBe(1800)
    expect(result.closed?.sha).toBe('abc1234')

    // The successor is empty and waits for the next commit.
    const next = openEntry(state, main)
    expect(next?.id).not.toBe(result.closed?.id)
    expect(next?.seconds).toBe(0)
  })

  it('queues the closed entry for sending', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock, main)
    clock.advance(60)
    const result = commitOn(state, main, at(9, 1), 'fix: Kleinigkeit')

    const pending = result.state.pending.find((write) => write.entryId === result.closed?.id)
    expect(pending?.closing).toBe(true)
  })
})

describe('a commit without a running timer', () => {
  it('books nothing and says so', () => {
    const result = commitOn(emptyState(), scope, at(9, 30), 'fix: aus dem Terminal')

    expect(result.hadTimer).toBe(false)
    expect(result.booked).toBe(0)
    expect(result.state.entries).toHaveLength(0)
  })
})

describe('pausing', () => {
  it('books the running segment and stops the clock', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(900)
    state = pause(state, clock, scope)

    expect(openEntry(state, scope)?.seconds).toBe(900)
    expect(state.timers[0]?.startedAt).toBeNull()

    clock.advance(3600)
    expect(currentSeconds(state, clock, scope)).toBe(900)
  })

  it('resumes into the same entry', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    const entryId = openEntry(state, scope)!.id

    clock.advance(600)
    state = pause(state, clock, scope)
    clock.advance(600)
    state = startOn(state, clock)
    clock.advance(600)
    state = pause(state, clock, scope)

    expect(openEntry(state, scope)?.id).toBe(entryId)
    expect(openEntry(state, scope)?.seconds).toBe(1200)
  })
})

describe('scopes', () => {
  it('keeps branches apart', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)
    state = startOn(state, clock, main)
    clock.advance(600)

    state = pause(state, clock, scope)
    state = pause(state, clock, main)

    expect(openEntry(state, scope)?.seconds).toBe(1200)
    expect(openEntry(state, main)?.seconds).toBe(600)
  })
})

describe('closing by hand', () => {
  it('sets the final text and never reopens', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(3600)
    state = pause(state, clock, scope)

    const entry = openEntry(state, scope)!
    state = close(state, entry.id, 'Buchungsmodul, fertig', at(10, 0), newId)

    const closed = state.entries.find((candidate) => candidate.id === entry.id)
    expect(closed?.state).toBe('closed')
    expect(closed?.text).toBe('Buchungsmodul, fertig')
    expect(closed?.seconds).toBe(3600)

    // A second attempt changes nothing.
    expect(close(state, entry.id, 'anders', at(10, 1), newId)).toBe(state)
  })
})
