import { describe, expect, it } from 'vitest'

import type { RemoteEntry } from './api.js'
import { joinTexts, measuredPerEntry, planMerge, planRemoval } from './merge.js'
import type { Segment } from './segments.js'
import { EXACT, type TimeGrid } from './working-time.js'

const quarter: TimeGrid = { kind: 'minutes', minutes: 15 }

function remote(timeID: number, hours: number, overrides: Partial<RemoteEntry> = {}): RemoteEntry {
  return {
    timeID,
    projectID: 166,
    category: 70,
    date: '2026-08-29',
    detail: `Arbeit ${timeID}`,
    hours,
    isInvoiced: false,
    notInvoiceable: false,
    workingTimeStart: null,
    workingTimeEnd: null,
    ...overrides,
  } as RemoteEntry
}

function segment(entryId: string, seconds: number): Segment {
  return {
    from: '2026-08-29T09:00:00+02:00',
    until: '2026-08-29T09:20:00+02:00',
    seconds,
    repoPath: '/work/shop',
    branch: 'main',
    projectId: 166,
    entryId,
    reason: 'commit',
  }
}

describe('what a merge would do', () => {
  /*
   * The point of the whole thing: rounding belongs to a piece of work, not to a
   * record. Three commits of twenty minutes cost half an hour each on a
   * quarter-hour grid; the same work as one entry is rounded once.
   */
  it('offers the sum as it stands and the same work rounded once', () => {
    const entries = [remote(1, 0.5), remote(2, 0.5), remote(3, 0.5)]
    const measured = new Map([
      [1, 1200],
      [2, 1200],
      [3, 1200],
    ])

    const plan = planMerge(entries, measured, quarter)!

    expect(plan.addedSeconds).toBe(Math.round(1.5 * 3600))
    expect(plan.recomputedSeconds).toBe(3600)
  })

  it('keeps the oldest and drops the rest', () => {
    const plan = planMerge([remote(9, 1), remote(3, 1), remote(7, 1)], new Map(), quarter)!

    expect(plan.keep.timeID).toBe(3)
    expect(plan.drop.map((entry) => entry.timeID)).toEqual([7, 9])
  })

  /*
   * The segment log knows only this machine. A share measured elsewhere leaves
   * no trace in it, so recomputing would not be an honest rounding but an
   * incomplete sum — and a number that is short must not be handed over quietly.
   */
  it('refuses to recompute when the log does not cover every entry', () => {
    const entries = [remote(1, 0.5), remote(2, 0.5)]
    const plan = planMerge(entries, new Map([[1, 1200]]), quarter)!

    expect(plan.recomputedSeconds).toBeNull()
    expect(plan.addedSeconds).toBe(3600)
  })

  it('leaves invoiced entries out and says so', () => {
    const entries = [remote(1, 1), remote(2, 1, { isInvoiced: true }), remote(3, 1)]
    const plan = planMerge(entries, new Map(), EXACT)!

    expect(plan.refused.map((refusal) => refusal.entry.timeID)).toEqual([2])
    expect([plan.keep.timeID, ...plan.drop.map((entry) => entry.timeID)]).toEqual([1, 3])
  })

  it('has nothing to do when one entry is left after the refusals', () => {
    const entries = [remote(1, 1), remote(2, 1, { isInvoiced: true })]
    expect(planMerge(entries, new Map(), EXACT)).toBeNull()
  })

  it('lands on the latest of the days, because an entry carries only one', () => {
    const entries = [remote(1, 1, { date: '2026-08-29' }), remote(2, 1, { date: '2026-09-02' })]
    expect(planMerge(entries, new Map(), EXACT)?.date).toBe('2026-09-02')
  })

  it('strips the marker, because a merged text is written fresh', () => {
    const entries = [remote(1, 1, { detail: '[a3f9c1] Erstes' }), remote(2, 1, { detail: '[LAUFEND:a3f9c1][260829-08:12] Zweites' })]
    expect(planMerge(entries, new Map(), EXACT)?.text).toBe('Erstes; Zweites')
  })
})

describe('joining the texts', () => {
  // The commonest merge is a duplicate; two identical lines would only be in the way.
  it('says the same thing once', () => {
    expect(joinTexts(['Backlog-Fixes', 'Backlog-Fixes'])).toBe('Backlog-Fixes')
  })

  it('keeps different ones in order', () => {
    expect(joinTexts(['Erstes', 'Zweites'])).toBe('Erstes; Zweites')
  })

  it('drops the empty ones', () => {
    expect(joinTexts(['', 'Erstes', '  '])).toBe('Erstes')
  })
})

describe('what this machine measured per entry', () => {
  it('joins segments to time entries over the local id', () => {
    const segments = [segment('e1', 600), segment('e1', 600), segment('e2', 300)]
    const timeIdOf = new Map([
      ['e1', 2287],
      ['e2', 2289],
    ])

    const measured = measuredPerEntry(segments, timeIdOf)

    expect(measured.get(2287)).toBe(1200)
    expect(measured.get(2289)).toBe(300)
  })

  it('leaves out what has no time entry, rather than counting it as nothing', () => {
    const measured = measuredPerEntry([segment('e9', 600)], new Map())
    expect(measured.has(2287)).toBe(false)
    expect(measured.size).toBe(0)
  })
})

/*
 * Deleting is the one action here that cannot be taken back, and the selection
 * comes from a list where an invoiced entry looks like any other. What may go
 * is therefore decided before anything is asked, not while it is being done.
 */
describe('planning a deletion', () => {
  it('takes only what is not invoiced, and says what stays', () => {
    const plan = planRemoval([remote(1, 1), remote(2, 2, { isInvoiced: true }), remote(3, 0.5)])

    expect(plan?.remove.map((entry) => entry.timeID)).toEqual([1, 3])
    expect(plan?.invoiced.map((entry) => entry.timeID)).toEqual([2])
  })

  it('sums what would be deleted, so the question can name it', () => {
    expect(planRemoval([remote(1, 1.5), remote(2, 0.25)])?.seconds).toBe(6300)
  })

  // Not an empty plan that deletes nothing: the caller has to say why.
  it('refuses altogether when everything in the selection is invoiced', () => {
    expect(planRemoval([remote(1, 1, { isInvoiced: true })])).toBeNull()
    expect(planRemoval([])).toBeNull()
  })
})

/*
 * The bug this guards against reached the screen: two entries holding 0:13
 * together were offered for merging with 0:00 prefilled. Confirming it would
 * have written 0.00 h and deleted the other entry — thirteen minutes gone, on
 * an invoice, silently.
 */
describe('what counts as measured', () => {
  function segment(entryId: string, seconds: number, reason: Segment['reason']): Segment {
    return { until: '2026-09-05T10:00:00', seconds, repoPath: '/work/shop', branch: 'main', projectId: 166, entryId, reason }
  }

  // It carries seconds: 0 on purpose — its time is already in the lines above.
  it('does not take the line that closes an entry for a measurement', () => {
    const measured = measuredPerEntry([segment('e1', 0, 'entry')], new Map([['e1', 2477]]))

    expect(measured.has(2477)).toBe(false)
  })

  it('still counts everything that was actually measured', () => {
    const rows = [segment('e1', 600, 'pause'), segment('e1', 180, 'commit'), segment('e1', 0, 'entry')]

    expect(measuredPerEntry(rows, new Map([['e1', 2477]])).get(2477)).toBe(780)
  })

  /*
   * The other door to the same fault: discarding a running segment leaves a
   * `trimmed` line, and it may legitimately carry nothing. Present with zero is
   * not coverage — whatever the log knows about that entry, it is not where its
   * hours came from.
   */
  it('does not call an entry covered whose only line carries no time', () => {
    const measured = measuredPerEntry(
      [segment('e1', 600, 'pause'), segment('e2', 0, 'trimmed')],
      new Map([['e1', 1], ['e2', 2]]),
    )

    expect(planMerge([remote(1, 0.17), remote(2, 0.11)], measured, EXACT)!.recomputedSeconds).toBeNull()
  })

  it('proposes the ProSonata sum when an entry has no measured time here', () => {
    const entries = [remote(1, 0.11), remote(2, 0.11)]
    // The log knows both entries, but only as closing lines.
    const measured = measuredPerEntry(
      [segment('e1', 0, 'entry'), segment('e2', 0, 'entry')],
      new Map([['e1', 1], ['e2', 2]]),
    )

    const plan = planMerge(entries, measured, EXACT)!

    expect(plan.recomputedSeconds).toBeNull()
    expect(plan.addedSeconds).toBe(792)
  })
})
