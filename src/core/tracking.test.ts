import { describe, expect, it } from 'vitest'

import { fixedClock } from './clock.js'
import {
  applyCategory,
  applyProject,
  bookCorrection,
  close,
  commit,
  currentSeconds,
  keepFromRunning,
  lastClosedEntry,
  moveToClosed,
  openEntry,
  runningSeconds,
  parkClosedElsewhere,
  pause,
  resumeAfterAdding,
  resumeAsNew,
  setText,
  shiftStart,
  start,
  unwrittenSeconds,
} from './tracking.js'
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

/** What the sender leaves behind once a write has gone out: a timeId, no pending write. */
function sent(state: State, entryId: string, timeId = 4711): State {
  const entry = state.entries.find((candidate) => candidate.id === entryId)!
  entry.timeId = timeId
  state.pending = state.pending.filter((write) => write.entryId !== entryId)
  return state
}

describe('choosing a time category later', () => {
  it('reaches the open entry that was begun without one', () => {
    const clock = fixedClock(NINE)
    let state = start(emptyState(), clock, { scope, key: 'a3f9c1', projectId: 166, categoryId: 0, mode: 'branch', newId })
    clock.advance(3600)
    state = pause(state, clock, scope)

    state = applyCategory(state, '/work/shop', 166, 70, at(10, 0))

    expect(openEntry(state, scope)?.categoryId).toBe(70)
  })

  it('sends the correction for an entry ProSonata already knows', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    const entry = openEntry(state, scope)!
    entry.timeId = 4711

    state = applyCategory(state, '/work/shop', 166, 71, at(10, 0))

    expect(state.pending.map((write) => write.entryId)).toEqual([entry.id])
  })

  it('leaves another project and another repository alone', () => {
    const clock = fixedClock(NINE)
    const state = startOn(emptyState(), clock)

    expect(applyCategory(state, '/work/shop', 999, 99, at(10, 1))).toBe(state)
    expect(applyCategory(state, '/work/anderes', 166, 99, at(10, 1))).toBe(state)
  })
})

describe('correcting the project', () => {
  it('moves every unfinished entry of the repository, not just the current branch', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    state = startOn(state, clock, main)

    state = applyProject(state, '/work/shop', 412, 15, at(10, 0))

    expect(openEntry(state, scope)?.projectId).toBe(412)
    expect(openEntry(state, main)?.projectId).toBe(412)
    expect(openEntry(state, scope)?.categoryId).toBe(15)
  })

  it('takes an entry ProSonata already knows along, so the PUT moves it there too', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    const entry = openEntry(state, scope)!
    state = sent(state, entry.id)

    state = applyProject(state, '/work/shop', 412, 15, at(10, 0))

    expect(state.pending.map((write) => write.entryId)).toEqual([entry.id])
  })

  it('keeps the category when the new project has none yet', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)

    state = applyProject(state, '/work/shop', 412, 0, at(10, 0))

    expect(openEntry(state, scope)?.categoryId).toBe(70)
  })

  it('takes a closed entry along while its write is still pending', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    const entry = openEntry(state, scope)!
    state = close(state, entry.id, 'fertig', at(10, 0), newId)

    state = applyProject(state, '/work/shop', 412, 15, at(10, 1))

    expect(state.entries.find((candidate) => candidate.id === entry.id)?.projectId).toBe(412)
  })

  it('leaves a closed entry alone once its closing write has gone out', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    const entry = openEntry(state, scope)!
    state = close(state, entry.id, 'fertig', at(10, 0), newId)
    state = sent(state, entry.id)

    state = applyProject(state, '/work/shop', 412, 15, at(10, 1))

    expect(state.entries.find((candidate) => candidate.id === entry.id)?.projectId).toBe(166)
  })

  it('leaves another repository alone', () => {
    const clock = fixedClock(NINE)
    const state = startOn(emptyState(), clock)

    expect(applyProject(state, '/work/anderes', 412, 15, at(10, 1))).toBe(state)
  })
})

describe('changing the text of an open entry', () => {
  it('replaces it without closing the entry', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    const entry = openEntry(state, scope)!

    state = setText(state, entry.id, 'Buchungsmodul', at(10, 0))

    expect(openEntry(state, scope)?.text).toBe('Buchungsmodul')
    expect(openEntry(state, scope)?.state).toBe('open')
  })

  it('sends the correction for an entry ProSonata already knows', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    const entry = openEntry(state, scope)!
    state = sent(state, entry.id)

    state = setText(state, entry.id, 'Rabattstufen', at(10, 0))

    expect(state.pending.map((write) => write.entryId)).toEqual([entry.id])
  })

  it('leaves a closed entry alone', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    const entry = openEntry(state, scope)!
    state = close(state, entry.id, 'fertig', at(10, 0), newId)

    expect(setText(state, entry.id, 'doch nicht', at(10, 1))).toBe(state)
  })
})

describe('answering "closed on another machine"', () => {
  const parked = () => ({
    ...emptyState(),
    entries: [
      {
        id: 'e1',
        key: 'a3f9c1',
        scope,
        projectId: 166,
        categoryId: 70,
        text: 'Buchungsmodul',
        seconds: 2 * 3600,
        foreignSeconds: 3600,
        lastWritten: 3600,
        timeId: 4711,
        state: 'open' as const,
        awaitingDecision: true,
        remoteFinalSeconds: 2 * 3600,
      },
    ],
  })

  it('counts as unwritten only what ProSonata does not hold', () => {
    // Locally 3 h, over there 2 h — one hour never made it.
    expect(unwrittenSeconds(parked().entries[0]!)).toBe(3600)
  })

  it('"new" keeps that hour and lets go of the old entry', () => {
    const state = resumeAsNew(parked(), 'e1')
    const entry = state.entries[0]!

    expect(entry.seconds).toBe(3600)
    expect(entry.foreignSeconds).toBe(0)
    expect(entry.timeId).toBeNull()
    expect(entry.lastWritten).toBeNull()
    expect(entry.awaitingDecision).toBeUndefined()
  })

  it('"add" starts at zero, because everything has just gone out', () => {
    const state = resumeAfterAdding(parked(), 'e1')
    const entry = state.entries[0]!

    expect(entry.seconds).toBe(0)
    expect(entry.timeId).toBeNull()
    expect(entry.awaitingDecision).toBeUndefined()
  })

  it('parks only once and drops the pending write', () => {
    const entries = parked().entries.map(({ awaitingDecision, remoteFinalSeconds, ...rest }) => rest)
    const state = { ...emptyState(), entries, pending: [{ entryId: 'e1', since: at(9), closing: false }] }
    const first = parkClosedElsewhere(state, 'e1', 7200)

    expect(first.entries[0]?.awaitingDecision).toBe(true)
    expect(first.pending).toHaveLength(0)
    expect(parkClosedElsewhere(first, 'e1', 7200)).toBe(first)
  })
})

describe('a segment that ran too long', () => {
  it('is measured on its own, not on the entry it feeds', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(3600)
    state = pause(state, clock, scope)

    // The entry holds an hour, but nothing is running.
    expect(currentSeconds(state, clock, scope)).toBe(3600)
    expect(runningSeconds(state, clock, scope)).toBe(0)

    state = startOn(state, clock)
    clock.advance(60)
    expect(runningSeconds(state, clock, scope)).toBe(60)
  })

  it('books only what was kept and stops the timer', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(14 * 3600) // over night

    state = keepFromRunning(state, clock, scope, 2 * 3600)

    expect(openEntry(state, scope)?.seconds).toBe(2 * 3600)
    expect(state.timers[0]?.startedAt).toBeNull()
  })

  it('never books more than actually ran', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)

    state = keepFromRunning(state, clock, scope, 3600)

    expect(openEntry(state, scope)?.seconds).toBe(600)
  })

  it('drops the segment entirely when nothing is kept', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(14 * 3600)

    state = keepFromRunning(state, clock, scope, 0)

    expect(openEntry(state, scope)?.seconds).toBe(0)
    expect(state.timers[0]?.startedAt).toBeNull()
  })
})

describe('pausing an entry ProSonata knows', () => {
  it('queues a write, so the running mark is taken back', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    state.entries[0]!.timeId = 4711
    clock.advance(600)

    state = pause(state, clock, scope)

    expect(state.pending.map((write) => write.entryId)).toEqual([state.entries[0]!.id])
  })

  it('queues nothing for an entry ProSonata has never seen', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)

    state = pause(state, clock, scope)

    expect(state.pending).toHaveLength(0)
  })
})

describe('winding the clock', () => {
  it('moves the start back, so more counts', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)

    const shift = shiftStart(state, clock, scope, 900, 0)
    state = shift.state

    expect(shift.seconds).toBe(900)
    expect(currentSeconds(state, clock, scope)).toBe(1500)
  })

  it('moves the start forward, so less counts', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(3600)

    state = shiftStart(state, clock, scope, -900, 0).state

    expect(currentSeconds(state, clock, scope)).toBe(2700)
  })

  // Everything before the last segment is already booked; counting it again
  // would invent time.
  it('never reaches behind the end of the last segment', () => {
    const clock = fixedClock(NINE)
    const floor = clock.now()

    // Ten minutes of break, then the timer starts again and runs for twenty.
    clock.advance(600)
    let state = startOn(emptyState(), clock)
    clock.advance(1200)

    const shift = shiftStart(state, clock, scope, 3600, floor)

    // An hour was asked for, ten minutes were free.
    expect(shift.seconds).toBe(600)
    expect(currentSeconds(shift.state, clock, scope)).toBe(1800)
  })

  it('does not take time away when the floor lies after the start', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)

    expect(shiftStart(state, clock, scope, 900, clock.now()).seconds).toBe(0)
  })

  it('never lets the start slide into the future', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)

    const shift = shiftStart(state, clock, scope, -3600, 0)

    expect(shift.seconds).toBe(-600)
    expect(currentSeconds(shift.state, clock, scope)).toBe(0)
  })
})

describe('a correction while nothing runs', () => {
  const options = { scope, key: 'a3f9c1', projectId: 166, categoryId: 70, mode: 'branch' as const, newId }

  it('adds to the open entry', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)
    state = pause(state, clock, scope)

    const shift = bookCorrection(state, options, 900)

    expect(shift.seconds).toBe(900)
    expect(openEntry(shift.state, scope)?.seconds).toBe(1500)
  })

  it('never takes an entry below zero', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    clock.advance(600)
    state = pause(state, clock, scope)

    const shift = bookCorrection(state, options, -3600)

    expect(shift.seconds).toBe(-600)
    expect(openEntry(shift.state, scope)?.seconds).toBe(0)
  })

  it('opens an entry when the branch has none yet', () => {
    const shift = bookCorrection(emptyState(), options, 1800)

    expect(openEntry(shift.state, scope)?.seconds).toBe(1800)
  })

  it('leaves an entry that waits for a decision alone', () => {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock)
    state.entries[0]!.awaitingDecision = true

    expect(bookCorrection(state, options, 900).seconds).toBe(0)
  })
})

describe('moving follow-up time onto a closed entry', () => {
  /** A commit on main: the entry is closed, the timer runs on into a new one. */
  function afterCommit() {
    const clock = fixedClock(NINE)
    let state = startOn(emptyState(), clock, main)
    clock.advance(2 * 3600)
    state = commit(state, {
      scope: main,
      mode: 'commit',
      text: 'Kirby Update',
      fromTrailer: false,
      sha: 'deadbee',
      at: clock.now(),
      newId,
      projectId: 166,
      categoryId: 70,
      key: 'a3f9c1',
    }).state

    const closed = state.entries.find((entry) => entry.state === 'closed')!
    closed.timeId = 2112
    const open = openEntry(state, main)!
    open.seconds = 300
    return { state, closedId: closed.id, openId: open.id }
  }

  it('is the last closed entry of this branch that gets it', () => {
    const { state, closedId } = afterCommit()

    expect(lastClosedEntry(state, main)?.id).toBe(closedId)
    // Another branch has its own history and must not be reached from here.
    expect(lastClosedEntry(state, scope)).toBeUndefined()
  })

  it('moves the seconds and leaves the finished entry finished', () => {
    const { state, closedId, openId } = afterCommit()

    const next = moveToClosed(state, openId, closedId, 300)

    const closed = next.entries.find((entry) => entry.id === closedId)!
    expect(closed.seconds).toBe(2 * 3600 + 300)
    expect(closed.timeId).toBe(2112)
    expect(closed.text).toBe('Kirby Update')
    expect(closed.state).toBe('closed')
    expect(next.entries.find((entry) => entry.id === openId)?.seconds).toBe(0)
  })

  it('refuses an entry ProSonata does not know, since nothing could be written there', () => {
    const { state, closedId, openId } = afterCommit()
    state.entries.find((entry) => entry.id === closedId)!.timeId = null

    expect(moveToClosed(state, openId, closedId, 300)).toBe(state)
  })
})
