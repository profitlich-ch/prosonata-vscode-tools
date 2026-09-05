import { describe, expect, it } from 'vitest'

import { billedTime } from './report.js'
import { hoursToSeconds, parseHours, parseWorkingTime, toHours, workingTime, EXACT, type TimeGrid } from './working-time.js'

/**
 * This is where measured seconds become the number on the invoice. Untested
 * until now, which is the wrong way round: everything else can be corrected
 * afterwards, a wrong amount has already been billed.
 */

const quarter: TimeGrid = { kind: 'minutes', minutes: 15 }

describe('the exact grid', () => {
  it('sends a dot-decimal string, never a number', () => {
    // The API returns `workingTime` as a string on GET and a number on write, so
    // we rely on neither — but what we send is always well formed.
    expect(workingTime(3600)).toBe('1.00')
    expect(workingTime(5400)).toBe('1.50')
  })

  it('keeps two decimals, the finest ProSonata stores', () => {
    expect(workingTime(4560)).toBe('1.27')
  })

  /*
   * 0.01 h is 36 seconds, so anything shorter has no representation at all and
   * rounding decides which way it falls. Per-commit mode manufactures exactly
   * such fragments — a commit that follows another by seconds. The zero is not a
   * fault here; it is the reason those fragments must not become their own
   * invoice lines.
   */
  it('rounds work under eighteen seconds to nothing', () => {
    expect(workingTime(17)).toBe('0.00')
    expect(workingTime(18)).toBe('0.01')
  })

  it('never sends a negative amount', () => {
    expect(workingTime(0)).toBe('0.00')
    expect(workingTime(-500)).toBe('0.00')
  })
})

describe('a minutes grid', () => {
  /*
   * Upwards, always: the agreed unit is what the customer pays, and a started
   * quarter of an hour is a quarter of an hour (KONZEPT.md §3).
   */
  it('rounds up to the next step, never to the nearest', () => {
    expect(workingTime(2 * 3600 + 300, quarter)).toBe('2.25')
    // One second past two hours already costs the next quarter.
    expect(workingTime(2 * 3600 + 1, quarter)).toBe('2.25')
    expect(workingTime(2 * 3600, quarter)).toBe('2.00')
  })

  it('turns the smallest measured moment into a whole step', () => {
    expect(workingTime(1, quarter)).toBe('0.25')
  })

  /*
   * The reason the mode matters on an invoice: rounding happens per entry, so
   * three commits of twenty minutes cost half an hour each, while the same work
   * on one branch entry is rounded once.
   */
  it('costs more the more entries the work is split into', () => {
    const perCommit = 3 * toHours(1200, quarter)
    const perBranch = toHours(3 * 1200, quarter)

    expect(perCommit).toBeCloseTo(1.5, 2)
    expect(perBranch).toBeCloseTo(1.0, 2)
  })
})

describe('reading back what the API returns', () => {
  // Measured: a string on GET, a number in write answers — the client must take
  // both and rely on neither.
  it('takes both the string and the number form', () => {
    expect(parseWorkingTime('1.25')).toBe(1.25)
    expect(parseWorkingTime(1.25)).toBe(1.25)
  })

  it('treats anything unreadable as nothing, rather than as NaN', () => {
    expect(parseWorkingTime(null)).toBe(0)
    expect(parseWorkingTime(undefined)).toBe(0)
    expect(parseWorkingTime('kaputt')).toBe(0)
  })

  it('converts hours back to whole seconds', () => {
    expect(hoursToSeconds(1.25)).toBe(4500)
    expect(hoursToSeconds(0.01)).toBe(36)
  })
})

describe('the default grid', () => {
  it('is exact, so nothing rounds up unless a repository asks for it', () => {
    expect(workingTime(2 * 3600 + 300)).toBe(workingTime(2 * 3600 + 300, EXACT))
    expect(workingTime(2 * 3600 + 300)).toBe('2.08')
  })
})

/*
 * These seconds go straight onto an invoice: someone types a number into the
 * browser and it becomes a billed amount. Getting the notation wrong here is
 * not a display fault, it is a wrong invoice line.
 */
describe('hours as a person types them', () => {
  it('reads hours and minutes when a colon separates them', () => {
    expect(parseHours('1:30')).toBe(5400)
    expect(parseHours('0:05')).toBe(300)
    expect(parseHours('120:00')).toBe(432_000)
  })

  // ProSonata shows decimals everywhere; the number read off it must go back in.
  it('reads decimal hours when a dot or a comma separates them', () => {
    expect(parseHours('1,5')).toBe(5400)
    expect(parseHours('1.5')).toBe(5400)
    expect(parseHours('2.25')).toBe(8100)
  })

  // The dangerous pair: same digits, different notation, twelve minutes apart.
  it('keeps the two notations apart', () => {
    expect(parseHours('1:30')).toBe(5400)
    expect(parseHours('1.30')).toBe(4680)
  })

  it('refuses anything it would have to guess at', () => {
    for (const value of ['', '90', 'abc', '1:60', '-1:00', '1:5', '1:', ':30', '1:30:00']) {
      expect(parseHours(value), value).toBeNull()
    }
  })

  /*
   * The browser fills the field with the billed time and reads the answer back.
   * That round trip is lossy — five minutes are 0.08 h on the exact grid, which
   * reads back as 0:04 — so it must at least be *stable*: filling the field
   * again with what came back has to show the same thing. Otherwise an entry
   * would shrink a little every time somebody opened it.
   */
  it('is stable across the round trip through the input field', () => {
    for (const seconds of [300, 1234, 5400, 8100, 36_000]) {
      const shown = billedTime(seconds, EXACT)
      expect(billedTime(parseHours(shown)!, EXACT), shown).toBe(shown)
    }
  })
})
