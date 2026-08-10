import { describe, expect, it } from 'vitest'

import {
  branchKey,
  buildMarker,
  identityTerm,
  isMarkedOpen,
  readKey,
  readRunningSince,
  searchTerm,
  stripMarker,
  withIdentity,
  withMarker,
} from './marker.js'
import { localDate } from './clock.js'
import { EXACT, parseWorkingTime, toHours, workingTime } from './working-time.js'

describe('the branch key', () => {
  it('is the same on every machine for the same repo and branch', () => {
    const root = '9f1c2e4a5b6d7e8f90a1b2c3d4e5f60718293a4b'
    expect(branchKey(root, 'feature/buchung')).toBe(branchKey(root, 'feature/buchung'))
  })

  it('differs per branch and per repository', () => {
    const a = '9f1c2e4a5b6d7e8f90a1b2c3d4e5f60718293a4b'
    const b = '1122334455667788990011223344556677889900'

    expect(branchKey(a, 'feature/buchung')).not.toBe(branchKey(a, 'fix/login'))
    expect(branchKey(a, 'feature/buchung')).not.toBe(branchKey(b, 'feature/buchung'))
  })

  it('does not reveal the branch name', () => {
    expect(branchKey('9f1c2e', 'feature/geheimer-kunde')).not.toContain('kunde')
  })
})

describe('the marker', () => {
  it('goes in front of the text', () => {
    expect(withMarker('Buchungsmodul', 'a3f9c1')).toBe('[LAUFEND:a3f9c1] Buchungsmodul')
  })

  it('stands alone while there is no text yet', () => {
    expect(withMarker('', 'a3f9c1')).toBe('[LAUFEND:a3f9c1]')
  })

  it('disappears completely when the entry is closed', () => {
    expect(stripMarker('[LAUFEND:a3f9c1] Buchungsmodul')).toBe('Buchungsmodul')
    expect(stripMarker('[LAUFEND:a3f9c1]')).toBe('')
  })

  it('leaves a text without a marker untouched', () => {
    expect(stripMarker('Korrektur der Rabattberechnung')).toBe('Korrektur der Rabattberechnung')
  })

  it('reads the key back', () => {
    expect(readKey('[LAUFEND:a3f9c1] Buchungsmodul')).toBe('a3f9c1')
    expect(readKey('Buchungsmodul')).toBeNull()
  })

  it('honours a configured word', () => {
    const detail = withMarker('Buchungsmodul', 'a3f9c1', 'RUNNING')
    expect(detail).toBe('[RUNNING:a3f9c1] Buchungsmodul')
    expect(stripMarker(detail, 'RUNNING')).toBe('Buchungsmodul')
  })

  it('offers a search term the detail filter matches as a substring', () => {
    const term = searchTerm('a3f9c1')
    expect(buildMarker('a3f9c1')).toContain(term)
    expect(term).not.toContain('[')
  })
})

/**
 * Since when a timer runs — in our own namespace, because an API field for a
 * status costs the field and carries no day (KONZEPT.md §2).
 */
describe('the time bracket of a running timer', () => {
  const EIGHT_TWELVE = new Date(2026, 7, 2, 8, 12, 0).getTime()

  it('carries the day and the minute the timer started', () => {
    expect(withMarker('Kirby Update', 'a3f9c1', undefined, EIGHT_TWELVE)).toBe(
      '[LAUFEND:a3f9c1][260802-08:12] Kirby Update',
    )
  })

  it('is absent while nothing runs', () => {
    expect(withMarker('Kirby Update', 'a3f9c1')).toBe('[LAUFEND:a3f9c1] Kirby Update')
    expect(withMarker('Kirby Update', 'a3f9c1', undefined, null)).toBe('[LAUFEND:a3f9c1] Kirby Update')
  })

  it('reads back the moment it was written from', () => {
    const detail = withMarker('Kirby Update', 'a3f9c1', undefined, EIGHT_TWELVE)

    expect(readRunningSince(detail)).toBe(EIGHT_TWELVE)
    expect(readRunningSince('[LAUFEND:a3f9c1] Kirby Update')).toBeNull()
    expect(readRunningSince('Kirby Update')).toBeNull()
  })

  // The other machine may still run an older version, and its entries must stay
  // readable — otherwise a missing marker would read as "closed elsewhere".
  it('leaves a marker from before it existed fully readable', () => {
    expect(readKey('[LAUFEND:a3f9c1] Kirby Update')).toBe('a3f9c1')
    expect(stripMarker('[LAUFEND:a3f9c1] Kirby Update')).toBe('Kirby Update')
  })

  it('disappears with the marker when the entry is closed', () => {
    expect(stripMarker('[LAUFEND:a3f9c1][260802-08:12] Kirby Update')).toBe('Kirby Update')
    expect(stripMarker('[LAUFEND:a3f9c1][260802-08:12]')).toBe('')
  })

  it('does not stop the search from finding the entry', () => {
    const detail = withMarker('Kirby Update', 'a3f9c1', undefined, EIGHT_TWELVE)
    expect(detail).toContain(searchTerm('a3f9c1'))
  })

  it('reads the key even with the time in the way', () => {
    expect(readKey('[LAUFEND:a3f9c1][260802-08:12] Kirby Update')).toBe('a3f9c1')
  })
})

describe('working time', () => {
  it('is the absolute total in decimal hours with a dot', () => {
    expect(workingTime(6300)).toBe('1.75')
    expect(workingTime(3600)).toBe('1.00')
    expect(workingTime(0)).toBe('0.00')
  })

  it('resolves down to 0.01 h, which is 36 seconds', () => {
    expect(workingTime(36)).toBe('0.01')
    expect(workingTime(18)).toBe('0.01')
    expect(workingTime(17)).toBe('0.00')
  })

  it('rounds up to the grid when one is configured', () => {
    const quarter = { kind: 'minutes', minutes: 15 } as const

    expect(toHours(60, quarter)).toBe(0.25)
    expect(toHours(900, quarter)).toBe(0.25)
    expect(toHours(901, quarter)).toBe(0.5)
    expect(toHours(0, quarter)).toBe(0)
  })

  it('is exact by default', () => {
    expect(toHours(6300, EXACT)).toBe(1.75)
  })

  it('accepts both shapes the API returns', () => {
    // A string on GET, a number on write — measured, see KONZEPT.md §9.
    expect(parseWorkingTime('1.25')).toBe(1.25)
    expect(parseWorkingTime(1.25)).toBe(1.25)
    expect(parseWorkingTime(null)).toBe(0)
    expect(parseWorkingTime('nonsense')).toBe(0)
  })
})

describe('the local date', () => {
  it('is the day the user sits in, not UTC', () => {
    // 23:30 local on 30 July is still 30 July, even where UTC has moved on.
    expect(localDate(new Date(2026, 6, 30, 23, 30))).toBe('2026-07-30')
    expect(localDate(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })
})

/**
 * What a closed entry keeps (KONZEPT.md §3). The word carries the state, the key
 * carries the identity — and only the identity has a job left once the entry is
 * finished: being found again.
 */
describe('the mark of a closed entry', () => {
  it('is the key alone', () => {
    expect(withIdentity('Buchungsmodul, fertig', 'a3f9c1')).toBe('[a3f9c1] Buchungsmodul, fertig')
    expect(withIdentity('', 'a3f9c1')).toBe('[a3f9c1]')
  })

  it('still gives up its key', () => {
    expect(readKey('[a3f9c1] Buchungsmodul, fertig')).toBe('a3f9c1')
  })

  // The one signal that says "unfinished". Before the key survived a close, the
  // absence of the whole marker said it — now only the word does.
  it('is not marked open, while an open one is', () => {
    expect(isMarkedOpen('[a3f9c1] fertig')).toBe(false)
    expect(isMarkedOpen('[LAUFEND:a3f9c1] läuft')).toBe(true)
    expect(isMarkedOpen('[LAUFEND:a3f9c1][260803-08:12] läuft')).toBe(true)
    expect(isMarkedOpen('Buchungsmodul')).toBe(false)
  })

  it('is stripped like any other, so an adopted text stays clean', () => {
    expect(stripMarker('[a3f9c1] Buchungsmodul, fertig')).toBe('Buchungsmodul, fertig')
  })

  it('carries no time of its own', () => {
    expect(readRunningSince('[a3f9c1] fertig')).toBeNull()
  })

  // Six hex characters could sit inside an ordinary word; the closing bracket
  // is what makes the search term specific.
  it('is found by a term that both forms contain', () => {
    expect(withIdentity('fertig', 'a3f9c1')).toContain(identityTerm('a3f9c1'))
    expect(withMarker('läuft', 'a3f9c1')).toContain(identityTerm('a3f9c1'))
    expect(identityTerm('a3f9c1')).toBe('a3f9c1]')
  })
})
