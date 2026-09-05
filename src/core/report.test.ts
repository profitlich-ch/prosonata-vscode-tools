import { describe, expect, it } from 'vitest'

import { billedSeconds, billedTime, hoursAndMinutes } from './report.js'
import type { Segment } from './segments.js'
import { EXACT, type TimeGrid } from './working-time.js'

/**
 * The report has to show the number that will actually be invoiced. It once did
 * not — the send knew the repository's grid and the report only the default, so
 * a repository could display a rounding that never happened (KONZEPT.md §3).
 */

const quarter: TimeGrid = { kind: 'minutes', minutes: 15 }

function segment(entryId: string, seconds: number): Segment {
  return {
    from: '2026-08-30T09:00:00+02:00',
    until: '2026-08-30T09:20:00+02:00',
    seconds,
    repoPath: '/work/shop',
    branch: 'main',
    projectId: 166,
    entryId,
    reason: 'commit',
  }
}

describe('what will be invoiced', () => {
  /*
   * The heart of it: rounding happens once per entry, so the sum of the
   * roundings is what the customer pays. Rounding the total instead would
   * understate it — and the report would then contradict the invoice.
   */
  it('rounds per entry, not over the whole report', () => {
    const three = [segment('a', 1200), segment('b', 1200), segment('c', 1200)]

    // Three times twenty minutes, each rounded up to a quarter hour: 1:30.
    expect(billedSeconds(three, quarter)).toBe(Math.round(1.5 * 3600))
    // The same hour on one entry is rounded once: 1:00.
    expect(billedSeconds([segment('a', 3600)], quarter)).toBe(3600)
  })

  it('adds up the segments of one entry before rounding it', () => {
    const split = [segment('a', 600), segment('a', 600), segment('a', 600)]

    // One entry, half an hour — not three quarters of an hour.
    expect(billedSeconds(split, quarter)).toBe(1800)
  })

  it('leaves an exact grid alone', () => {
    const two = [segment('a', 1234), segment('b', 4321)]
    expect(billedSeconds(two, EXACT)).toBe(Math.round(1234 / 36) * 36 + Math.round(4321 / 36) * 36)
  })

  /*
   * Segments recorded before their entry existed carry no id. They are counted
   * as one group of their own rather than dropped: measured time may not vanish
   * from the report just because its entry is not known yet.
   */
  it('counts segments without an entry rather than losing them', () => {
    const orphans = [segment('', 1200), segment('', 1200)]
    expect(billedSeconds(orphans, quarter)).toBe(Math.round(0.75 * 3600))
  })
})

describe('the notation people read', () => {
  it('shows decimal hours as hours and minutes', () => {
    // 1.27 h is a quarter past one, not "one point two seven".
    expect(billedTime(4560, EXACT)).toBe('1:16')
  })

  it('shows what the grid will make of it, not what was measured', () => {
    expect(billedTime(2 * 3600 + 300, quarter)).toBe('2:15')
  })

  it('puts the sign in front of the whole thing', () => {
    // Not `-0:-15`, which is what dividing a negative into hours and minutes gives.
    expect(hoursAndMinutes(-900)).toBe('−0:15')
    expect(hoursAndMinutes(900)).toBe('0:15')
  })

  it('drops the seconds, which would be noise over a day', () => {
    expect(hoursAndMinutes(3659)).toBe('1:00')
  })
})
