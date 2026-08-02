import { describe, expect, it } from 'vitest'

import { duration, noteFor, planAdjustment, readAdjustment, timeOfDay, type Situation } from './adjust.js'

/** 2026-08-01, 11:00 local time. */
const NOW = new Date(2026, 7, 1, 11, 0, 0).getTime()
const minutes = (value: number) => value * 60

describe('a duration', () => {
  it('reads plain minutes and h:mm', () => {
    expect(duration('25')).toBe(minutes(25))
    expect(duration('1:30')).toBe(minutes(90))
    expect(duration('0:05')).toBe(minutes(5))
  })

  it('refuses what it cannot read', () => {
    expect(duration('bald')).toBeNull()
    expect(duration('')).toBeNull()
  })
})

describe('a time of day', () => {
  it('lands on today when it is in the past', () => {
    expect(timeOfDay('9:40', NOW)).toBe(new Date(2026, 7, 1, 9, 40, 0).getTime())
  })

  // 23:30 asked at 11:00 can only have meant last night.
  it('falls back to yesterday when it would be in the future', () => {
    expect(timeOfDay('23:30', NOW)).toBe(new Date(2026, 6, 31, 23, 30, 0).getTime())
  })

  it('refuses an impossible clock', () => {
    expect(timeOfDay('25:00', NOW)).toBeNull()
    expect(timeOfDay('9:70', NOW)).toBeNull()
  })
})

describe('what somebody typed', () => {
  it('offers both readings of a bare number', () => {
    const offers = readAdjustment('25', NOW)

    expect(offers.map((offer) => (offer.kind === 'amount' ? offer.seconds : null))).toEqual([minutes(25), -minutes(25)])
    expect(offers[0]?.label).toBe('+25 Minuten')
  })

  it('takes a sign as the answer', () => {
    const [offer] = readAdjustment('-1:30', NOW)
    expect(offer).toEqual({ kind: 'amount', seconds: -minutes(90), label: '-1:30 Stunden' })
  })

  // The two mistakes this exists for, in the words the user used. An anchor is
  // absolute — it says when, not how much.
  it('reads "ab 9:40" as the moment the work began', () => {
    const [offer] = readAdjustment('ab 9:40', NOW)

    expect(offer).toEqual({ kind: 'startAt', at: timeOfDay('9:40', NOW), label: 'ab 9:40 zählen' })
  })

  it('reads "bis 9:40" as the moment it ended', () => {
    const [offer] = readAdjustment('bis 9:40', NOW)

    expect(offer).toEqual({ kind: 'stopAt', at: timeOfDay('9:40', NOW), label: 'nur bis 9:40 zählen' })
  })

  it('offers both when a bare time leaves the direction open', () => {
    expect(readAdjustment('9:40', NOW).map((offer) => offer.kind)).toEqual(['startAt', 'stopAt'])
  })

  it('offers nothing for nonsense', () => {
    expect(readAdjustment('ab bald', NOW)).toEqual([])
    expect(readAdjustment('   ', NOW)).toEqual([])
  })
})

/*
 * A finished segment says: everything up to here is recorded correctly. An
 * anchor may therefore never reach behind it — and needs to do no more than
 * move the beginning of the one stretch that follows.
 */
describe('what an adjustment does', () => {
  const NINE_FORTY = timeOfDay('9:40', NOW)!
  const situation = (overrides: Partial<Situation> = {}): Situation => ({
    now: NOW,
    runningSince: null,
    lastSegmentEnd: 0,
    booked: 3 * 3600,
    ...overrides,
  })

  it('ends the running segment at the moment given, and stops', () => {
    const plan = planAdjustment(
      { kind: 'stopAt', at: NINE_FORTY, label: '' },
      situation({ runningSince: timeOfDay('9:00', NOW)! }),
    )

    expect(plan.action).toBe('stop')
    expect(plan.at).toBe(NINE_FORTY)
    expect(plan.delta).toBe(-minutes(80))
  })

  it('moves the running beginning onto the moment given', () => {
    const plan = planAdjustment(
      { kind: 'startAt', at: NINE_FORTY, label: '' },
      situation({ runningSince: timeOfDay('10:00', NOW)! }),
    )

    expect(plan.action).toBe('shift')
    expect(plan.at).toBe(NINE_FORTY)
    expect(plan.delta).toBe(minutes(20))
  })

  it('reaches no further back than the end of the last segment', () => {
    const nineFifty = timeOfDay('9:50', NOW)!
    const plan = planAdjustment(
      { kind: 'startAt', at: NINE_FORTY, label: '' },
      situation({ runningSince: timeOfDay('10:00', NOW)!, lastSegmentEnd: nineFifty }),
    )

    expect(plan.at).toBe(nineFifty)
    expect(plan.delta).toBe(minutes(10))
    expect(plan.skipped).toBe(minutes(10))
  })

  /*
   * Only the running segment can be changed. With nothing running there is no
   * segment a time of day could refer to — and shortening a finished one would
   * not say which of them should shrink.
   */
  it('offers nothing for a time of day while nothing runs', () => {
    for (const kind of ['startAt', 'stopAt'] as const) {
      const plan = planAdjustment({ kind, at: NINE_FORTY, label: '' }, situation())

      expect(plan.action).toBe('impossible')
      expect(plan.delta).toBe(0)
    }
  })

  it('still books an amount while nothing runs', () => {
    const plan = planAdjustment({ kind: 'amount', seconds: minutes(20), label: '' }, situation())

    expect(plan.action).toBe('correct')
    expect(plan.delta).toBe(minutes(20))
  })

  it('never takes more than the entry holds', () => {
    const plan = planAdjustment({ kind: 'amount', seconds: -5 * 3600, label: '' }, situation({ booked: 600 }))

    expect(plan.delta).toBe(-600)
  })
})

describe('what could not be granted', () => {
  const NINE_FORTY = timeOfDay('9:40', NOW)!
  const base = (overrides: Partial<Situation> = {}): Situation => ({
    now: NOW,
    runningSince: null,
    lastSegmentEnd: 0,
    booked: 3 * 3600,
    ...overrides,
  })

  // The case from the screenshot: the wish reaches behind a finished segment,
  // and the line must say so before it is clicked.
  it('names the hour from which the anchor is possible', () => {
    const anchor = { kind: 'startAt' as const, at: NINE_FORTY, label: '' }
    const plan = planAdjustment(
      anchor,
      base({ runningSince: timeOfDay('10:40', NOW)!, lastSegmentEnd: timeOfDay('10:10', NOW)! }),
    )

    expect(plan.delta).toBe(minutes(30))
    expect(noteFor(plan, anchor)).toBe('erst ab 10:10 → so weit reicht das letzte Segment')
  })

  it('says nothing when the wish was granted whole', () => {
    const anchor = { kind: 'startAt' as const, at: NINE_FORTY, label: '' }
    const plan = planAdjustment(anchor, base({ runningSince: timeOfDay('10:00', NOW)! }))

    expect(noteFor(plan, anchor)).toBeNull()
  })

  it('explains what to do instead when no timer runs', () => {
    const anchor = { kind: 'startAt' as const, at: NINE_FORTY, label: '' }
    const plan = planAdjustment(anchor, base())

    expect(noteFor(plan, anchor)).toBe('Uhrzeiten ändern das laufende Segment. Nimm eine Dauer, etwa −0:06.')
  })

  // An amount is answered in its own currency: what it may be, then why. The
  // hour belongs in the reason, where it names the segment that stands in the way.
  it('offers the amount that is left, and blames the last segment', () => {
    const wish = { kind: 'amount' as const, seconds: minutes(15), label: '' }
    const plan = planAdjustment(
      wish,
      base({ runningSince: timeOfDay('10:06', NOW)!, lastSegmentEnd: timeOfDay('10:05', NOW)! }),
    )

    expect(plan.delta).toBe(minutes(1))
    expect(noteFor(plan, wish)).toBe('nur +1 Minute → letztes Segment reicht bis 10:05')
  })

  // Forward is bounded by the segment itself, not by the one before it — and
  // says so, or the reason would point at the wrong thing.
  it('blames the running segment when the wish reaches past now', () => {
    const wish = { kind: 'amount' as const, seconds: -minutes(15), label: '' }
    const plan = planAdjustment(wish, base({ runningSince: NOW - minutes(4) * 1000 }))

    expect(plan.delta).toBe(-minutes(4))
    expect(noteFor(plan, wish)).toBe('nur −4 Minuten → so lange läuft das Segment erst')
  })

  it('names what the segments do not have', () => {
    const wish = { kind: 'amount' as const, seconds: -2 * 3600, label: '' }
    const plan = planAdjustment(wish, base({ booked: 600 }))

    expect(noteFor(plan, wish)).toBe('nur −10 Minuten → mehr haben die Segmente nicht')
  })

  it('stays quiet about a rounding second', () => {
    const wish = { kind: 'amount' as const, seconds: -601, label: '' }
    const plan = planAdjustment(wish, base({ booked: 600 }))

    expect(plan.skipped).toBe(1)
    expect(noteFor(plan, wish)).toBeNull()
  })
})

describe('the hour a stop settles on', () => {
  const situation = (runningSince: number): Situation => ({
    now: NOW,
    runningSince,
    lastSegmentEnd: 0,
    booked: 0,
  })

  // The screenshot: "bis 16:20" while the timer only started at 10:00 — the
  // segment cannot end before it began, and the line has to say which hour.
  it('is the start of the timer when the wish lies before it', () => {
    const wish = { kind: 'stopAt' as const, at: timeOfDay('9:40', NOW)!, label: '' }
    const started = timeOfDay('10:00', NOW)!
    const plan = planAdjustment(wish, situation(started))

    expect(plan.at).toBe(started)
    expect(noteFor(plan, wish)).toBe('gebucht wird bis 10:00 → erst ab dann lief der Timer')
  })

  it('is the hour asked for when the timer was already running', () => {
    const wish = { kind: 'stopAt' as const, at: timeOfDay('10:30', NOW)!, label: '' }
    const plan = planAdjustment(wish, situation(timeOfDay('10:00', NOW)!))

    expect(plan.at).toBe(timeOfDay('10:30', NOW))
    expect(noteFor(plan, wish)).toBeNull()
  })
})
