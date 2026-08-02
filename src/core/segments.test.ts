import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { hoursAndMinutes, renderReport } from './report.js'
import { SegmentLog, atLocal, branchesIn, byDay, type Segment } from './segments.js'

/**
 * The segment log answers what neither the state nor ProSonata can: how much
 * was worked on which day, and on branches that no longer exist.
 */

function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    from: '2026-07-30T08:47:12+02:00',
    until: '2026-07-30T10:31:40+02:00',
    seconds: 6268,
    repoPath: '/work/shop',
    branch: 'feature/buchung',
    projectId: 166,
    entryId: 'e1',
    reason: 'commit',
    ...overrides,
  }
}

function log(): SegmentLog {
  return new SegmentLog(join(mkdtempSync(join(tmpdir(), 'prosonata-segments-')), 'segments.jsonl'))
}

describe('the log', () => {
  it('keeps what it was given, line by line', () => {
    const file = log()
    file.append(segment())
    file.append(segment({ branch: 'main', seconds: 600 }))

    expect(file.read().map((entry) => entry.branch)).toEqual(['feature/buchung', 'main'])
  })

  it('is empty rather than absent before the first segment', () => {
    expect(log().read()).toEqual([])
  })

  it('drops a segment of no length, but keeps a trimmed one', () => {
    const file = log()
    file.append(segment({ seconds: 0 }))
    file.append(segment({ seconds: 0, reason: 'trimmed', ranSeconds: 50280 }))

    expect(file.read()).toHaveLength(1)
    expect(file.read()[0]?.reason).toBe('trimmed')
  })
})

describe('the branches it knows', () => {
  it('include one git has forgotten, newest first', () => {
    const segments = [
      segment({ branch: 'feature/altbau', until: '2026-07-31T11:48:19+02:00' }),
      segment({ branch: 'feature/buchung', until: '2026-08-01T09:25:00+02:00' }),
      segment({ branch: 'feature/buchung', until: '2026-07-30T10:31:40+02:00', seconds: 100 }),
    ]

    const branches = branchesIn(segments)
    expect(branches.map((entry) => entry.branch)).toEqual(['feature/buchung', 'feature/altbau'])
    expect(branches[0]?.seconds).toBe(6268 + 100)
  })

  it('stay apart per repository, even under the same name', () => {
    const segments = [segment(), segment({ repoPath: '/work/anderes' })]

    expect(branchesIn(segments)).toHaveLength(2)
    expect(branchesIn(segments, '/work/shop')).toHaveLength(1)
  })
})

describe('by day', () => {
  it('sums each day and puts the newest first', () => {
    const days = byDay([
      segment({ until: '2026-07-30T10:31:40+02:00', seconds: 3600 }),
      segment({ until: '2026-08-01T09:25:00+02:00', seconds: 1800 }),
      segment({ until: '2026-07-30T17:12:31+02:00', seconds: 1800 }),
    ])

    expect(days.map((day) => day.date)).toEqual(['2026-08-01', '2026-07-30'])
    expect(days[1]?.seconds).toBe(5400)
  })

  // The day is the local one: an evening segment must not slide into tomorrow.
  it('takes the day from the local time, not from UTC', () => {
    const evening = atLocal(new Date(2026, 7, 1, 23, 30, 0).getTime())
    expect(byDay([segment({ until: evening })])[0]?.date).toBe('2026-08-01')
  })
})

describe('the report', () => {
  it('names how long a trimmed segment really ran', () => {
    const text = renderReport([segment({ reason: 'trimmed', seconds: 5400, ranSeconds: 50280 })], {
      branch: null,
      grid: { kind: 'exact' },
    })

    expect(text).toContain('gekürzt von 13:58')
    expect(text).toContain('1:30')
  })

  it('says so when a branch has nothing', () => {
    expect(renderReport([segment()], { branch: 'gibt-es-nicht', grid: { kind: 'exact' } })).toContain(
      'Keine Segmente aufgezeichnet',
    )
  })
})

describe('a correction', () => {
  it('is the one line whose seconds may be negative', () => {
    const file = log()
    file.append(segment({ seconds: -1500, reason: 'correction' }))
    // Anything else negative is a bug and stays out.
    file.append(segment({ seconds: -1500, reason: 'pause' }))

    expect(file.read()).toHaveLength(1)
    expect(file.read()[0]?.seconds).toBe(-1500)
  })

  it('lowers the day it belongs to', () => {
    const day = byDay([segment({ seconds: 3600 }), segment({ seconds: -1500, reason: 'correction' })])[0]

    expect(day?.seconds).toBe(2100)
  })

  it('is named in the report', () => {
    const text = renderReport([segment({ seconds: -1500, reason: 'correction' })], {
      branch: null,
      grid: { kind: 'exact' },
    })

    expect(text).toContain('Korrektur')
  })
})

describe('a correction without a span', () => {
  it('is written and read back without a beginning', () => {
    const file = log()
    const { from, ...correction } = segment({ seconds: 1200, reason: 'correction' })
    file.append(correction)

    expect(file.read()[0]?.from).toBeUndefined()
    expect(file.read()[0]?.seconds).toBe(1200)
  })

  it('lands on the day it was entered', () => {
    const { from, ...correction } = segment({ seconds: -600, reason: 'correction' })
    const days = byDay([segment({ seconds: 3600 }), correction])

    expect(days).toHaveLength(1)
    expect(days[0]?.seconds).toBe(3000)
  })

  it('shows a dash where a beginning would be', () => {
    const { from, ...correction } = segment({ seconds: 1200, reason: 'correction' })
    const text = renderReport([correction], { branch: null, grid: { kind: 'exact' } })

    expect(text).toContain('| — |')
    expect(text).toContain('Korrektur')
  })
})

describe('a negative duration', () => {
  it('carries its sign in front, not in every part', () => {
    const { from, ...correction } = segment({ seconds: -900, reason: 'correction' })
    const text = renderReport([correction], { branch: null, grid: { kind: 'exact' } })

    expect(text).toContain('−0:15')
    expect(text).not.toContain('-1:-15')
  })

  it('does the same for a day that ends up negative', () => {
    expect(hoursAndMinutes(-4500)).toBe('−1:15')
    expect(hoursAndMinutes(4500)).toBe('1:15')
    expect(hoursAndMinutes(0)).toBe('0:00')
  })
})

/*
 * What the report says will be charged. Rounding happens per time entry — one
 * written value per entry — so the report has to imitate that, or it understates
 * the invoice as soon as a grid rounds up.
 */
describe('the billed total', () => {
  const quarters = { kind: 'minutes' as const, minutes: 15 }
  const of = (entryId: string, seconds: number) => segment({ entryId, seconds })

  /*
   * The numbers are chosen so the two ways of counting disagree — with 37 and 40
   * minutes both give 1:30, and the test would pass either way.
   */
  it('rounds each entry on its own, not the sum', () => {
    const text = renderReport([of('e1', 16 * 60), of('e2', 16 * 60)], { branch: null, grid: quarters })

    // 0:30 apiece. The sum of 0:32 rounded in one go would be 0:45.
    expect(text).toContain('abgerechnet 1:00 h')
  })

  it('grows with the number of entries, because the grid rounds up', () => {
    const three = [of('e1', 20 * 60), of('e2', 20 * 60), of('e3', 20 * 60)]

    // Three times twenty minutes: 0:30 each. Rounded in one go the hour would
    // stay an hour — this is the half hour a busy day of commits costs.
    expect(renderReport(three, { branch: null, grid: quarters })).toContain('abgerechnet 1:30 h')
  })

  it('counts several segments of one entry together', () => {
    const text = renderReport([of('e1', 20 * 60), of('e1', 20 * 60)], { branch: null, grid: quarters })

    // 0:40 in one entry becomes 0:45. Rounding each segment would give 1:00.
    expect(text).toContain('abgerechnet 0:45 h')
  })

  // Saying the same number twice reads like a mistake.
  it('is left out entirely when the grid changes nothing', () => {
    const text = renderReport([of('e1', 15 * 60)], { branch: null, grid: quarters })

    expect(text).toContain('**0:15 h** in 1 Segmenten.')
    expect(text).not.toContain('abgerechnet')
  })
})

/*
 * Where one invoice line ends. Repeating the entry's text on every row would say
 * the same thing ten times; a line under its segments says it once.
 */
describe('the line that closes an entry', () => {
  // Without a beginning at all, not with an empty one: the line is no measurement.
  const closing = (bookedSeconds: number): Segment => {
    const line = segment({ reason: 'entry', seconds: 0, bookedSeconds, until: '2026-07-30T18:10:00+02:00' })
    delete line.from
    return line
  }

  it('shows what the entry became, and no times of its own', () => {
    const text = renderReport([segment({ seconds: 3600 }), closing(4500)], { branch: null, grid: { kind: 'exact' } })

    expect(text).toContain('| — | — | 1:15 | feature/buchung | **Zeiteintrag** |')
  })

  // The time is already in the segments above it. Counting it again would double
  // every day an entry is closed on.
  it('adds nothing to the day and is not counted as a segment', () => {
    const text = renderReport([segment({ seconds: 3600 }), closing(4500)], { branch: null, grid: { kind: 'exact' } })

    expect(text).toContain('**1:00 h** in 1 Segmenten.')
    expect(text).toContain('## 2026-07-30 — 1:00 h')
  })

  it('survives a log that has none, since it is younger than the archive', () => {
    expect(renderReport([segment()], { branch: null, grid: { kind: 'exact' } })).toContain('Commit')
  })
})

describe('the branch column', () => {
  it('is there when several branches are shown', () => {
    expect(renderReport([segment()], { branch: null, grid: { kind: 'exact' } })).toContain('| Von | Bis | Dauer | Branch | Ende |')
  })

  // On a single branch it would repeat the heading on every row.
  it('is gone when the report is about one branch', () => {
    const text = renderReport([segment()], { branch: 'feature/buchung', grid: { kind: 'exact' } })

    expect(text).toContain('| Von | Bis | Dauer | Ende |')
    expect(text).not.toContain('feature/buchung |')
  })
})
