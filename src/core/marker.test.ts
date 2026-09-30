import { describe, expect, it } from 'vitest'

import { branchKey, identityTerm, isMarkedOpen, readKey, readRunningSince, stripMarker, withMarker } from './marker.js'
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
  it('goes in front of the text, without a key', () => {
    expect(withMarker('Buchungsmodul')).toBe('[LAUFEND] Buchungsmodul')
  })

  it('stands alone while there is no text yet', () => {
    expect(withMarker('')).toBe('[LAUFEND]')
  })

  it('is stripped again', () => {
    expect(stripMarker('[LAUFEND] Buchungsmodul')).toBe('Buchungsmodul')
    expect(stripMarker('[LAUFEND]')).toBe('')
  })

  it('leaves a text without a marker untouched', () => {
    expect(stripMarker('Korrektur der Rabattberechnung')).toBe('Korrektur der Rabattberechnung')
  })

  it('says open, and carries no key and no time', () => {
    expect(isMarkedOpen('[LAUFEND] Buchungsmodul')).toBe(true)
    expect(readKey('[LAUFEND] Buchungsmodul')).toBeNull()
    expect(readRunningSince('[LAUFEND] Buchungsmodul')).toBeNull()
  })

  it('honours a configured word', () => {
    const detail = withMarker('Buchungsmodul', 'RUNNING')
    expect(detail).toBe('[RUNNING] Buchungsmodul')
    expect(stripMarker(detail, 'RUNNING')).toBe('Buchungsmodul')
    expect(isMarkedOpen(detail, 'RUNNING')).toBe(true)
  })
})

/**
 * The marker before `apiComments`: key, state and running time in the text
 * (KONZEPT.md §3). Nothing writes it any more, but entries carrying it stay
 * readable until they are written again.
 */
describe('the old marker', () => {
  const EIGHT_TWELVE = new Date(2026, 7, 2, 8, 12, 0).getTime()

  it('gives up its key, open or closed', () => {
    expect(readKey('[LAUFEND:a3f9c1] Buchungsmodul')).toBe('a3f9c1')
    expect(readKey('[LAUFEND:a3f9c1][260802-08:12] Kirby Update')).toBe('a3f9c1')
    expect(readKey('[a3f9c1] Buchungsmodul, fertig')).toBe('a3f9c1')
    expect(readKey('Buchungsmodul')).toBeNull()
  })

  // The word carried the state; closing dropped it and kept the key.
  it('is open by the word, not by the bracket', () => {
    expect(isMarkedOpen('[LAUFEND:a3f9c1] läuft')).toBe(true)
    expect(isMarkedOpen('[LAUFEND:a3f9c1][260803-08:12] läuft')).toBe(true)
    expect(isMarkedOpen('[a3f9c1] fertig')).toBe(false)
    expect(isMarkedOpen('Buchungsmodul')).toBe(false)
  })

  it('reads back the moment a timer started', () => {
    expect(readRunningSince('[LAUFEND:a3f9c1][260802-08:12] Kirby Update')).toBe(EIGHT_TWELVE)
    expect(readRunningSince('[LAUFEND:a3f9c1] Kirby Update')).toBeNull()
    expect(readRunningSince('[a3f9c1] fertig')).toBeNull()
  })

  it('is stripped in every form, so an adopted text stays clean', () => {
    expect(stripMarker('[LAUFEND:a3f9c1] Buchungsmodul')).toBe('Buchungsmodul')
    expect(stripMarker('[LAUFEND:a3f9c1][260802-08:12] Kirby Update')).toBe('Kirby Update')
    expect(stripMarker('[LAUFEND:a3f9c1][260802-08:12]')).toBe('')
    expect(stripMarker('[a3f9c1] Buchungsmodul, fertig')).toBe('Buchungsmodul, fertig')
  })

  // Six hex characters could sit inside an ordinary word; the closing bracket
  // is what makes the search term specific.
  it('is found by a term both forms contain', () => {
    expect(identityTerm('a3f9c1')).toBe('a3f9c1]')
    expect('[LAUFEND:a3f9c1][260802-08:12] läuft').toContain(identityTerm('a3f9c1'))
    expect('[a3f9c1] fertig').toContain(identityTerm('a3f9c1'))
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
