/**
 * Reading what somebody typed to correct a time (KONZEPT.md §3).
 *
 * Two mistakes, one in each direction: the timer ran through a phone call, or
 * it was never started although the work happened. People remember them as a
 * clock time — "at 9:40 the phone rang" — much more reliably than as a
 * difference, so both forms are understood:
 *
 *   +25, -25, 25          minutes
 *   +1:30, -1:30          hours and minutes
 *   until 9:40            count only up to then: everything after it goes
 *   from 9:40             count from then on: the time since is added
 *
 * `bis` and `ab` are understood as well. In `core` because both front ends
 * must read the same words the same way.
 */

import { t } from './l10n.js'

/**
 * What was meant, not yet what it does. An anchor is absolute: „ab 9:40" says
 * where the work began, not by how much to shift — with a running timer those
 * two are only the same by accident.
 */
export type Adjustment =
  | { kind: 'amount'; seconds: number; label: string }
  | { kind: 'startAt'; at: number; label: string }
  | { kind: 'stopAt'; at: number; label: string }

/** The state a plan has to reckon with; all times in epoch milliseconds. */
export interface Situation {
  now: number
  /** When the running segment began, null while the timer stands still. */
  runningSince: number | null
  /**
   * End of the last segment measured here — the earliest an anchor may reach.
   *
   * A finished segment is a statement: everything up to here is recorded
   * correctly. Nothing before it needs filling, and nothing before it may be
   * counted again.
   */
  lastSegmentEnd: number
  /** What the open entry already holds, in seconds. */
  booked: number
}

export interface Plan {
  /**
   * `shift` moves the running start, `stop` ends the segment at a moment,
   * `correct` changes the entry by an amount, `impossible` says why nothing
   * can happen.
   */
  action: 'shift' | 'stop' | 'correct' | 'impossible'
  /** How the branch's total changes, after every limit was applied. */
  delta: number
  /** The moment this settles on — for `stop` its end, for an anchor its limited beginning. */
  at?: number
  /**
   * How much of the wish could not be granted, in seconds — because it was
   * already measured, or would fall below zero. Shown before the choice is
   * made: a number that comes out smaller than asked for must say why.
   */
  skipped: number
}

/**
 * What an adjustment would do in this situation (KONZEPT.md §3).
 *
 * Pure and in `core` because both front ends need it twice: once to show what a
 * line will do before it is chosen, once to do it.
 *
 * Every limit here exists so that no time is invented: nothing may reach behind
 * the last segment, nothing into the future, and an entry cannot go below zero.
 */
export function planAdjustment(adjustment: Adjustment, situation: Situation): Plan {
  const { now, runningSince, lastSegmentEnd, booked } = situation
  const seconds = (millis: number) => Math.round(millis / 1000)

  /*
   * A time of day changes the segment that is running — there is nothing else
   * it could change. A finished segment is not rewritten: the log is an archive,
   * and "everything after 17:15 does not count" says nothing about which of the
   * finished stretches should shrink. Without a timer only an amount remains.
   */
  if (runningSince === null && adjustment.kind !== 'amount') {
    return { action: 'impossible', delta: 0, skipped: 0 }
  }

  if (runningSince !== null) {
    if (adjustment.kind === 'stopAt') {
      const at = Math.min(Math.max(adjustment.at, runningSince), now)
      return { action: 'stop', delta: -seconds(now - at), at, skipped: seconds(at - adjustment.at) }
    }

    /*
     * An anchor is absolute — "I have been working since 9:40" says where this
     * segment began. It is one stretch, so moving its beginning is all it takes;
     * an amount does the same by a difference.
     */
    const wanted = adjustment.kind === 'startAt' ? adjustment.at : runningSince - adjustment.seconds * 1000
    const at = Math.min(Math.max(wanted, Math.min(lastSegmentEnd, runningSince)), now)
    const delta = seconds(runningSince - at)
    const wished = adjustment.kind === 'startAt' ? seconds(runningSince - adjustment.at) : adjustment.seconds

    return { action: 'shift', delta, at, skipped: Math.abs(wished) - Math.abs(delta) }
  }

  // Booking after the fact: not a measurement, so it carries no clock times.
  const amount = adjustment.kind === 'amount' ? adjustment.seconds : 0
  const delta = Math.max(amount, -booked)
  return { action: 'correct', delta, skipped: Math.abs(amount) - Math.abs(delta) }
}

/**
 * Why less happened than was asked for — or null when nothing was cut. Lives
 * here so both front ends say it with the same words, right in the line that is
 * about to be clicked.
 */
export function noteFor(plan: Plan, adjustment: Adjustment): string | null {
  if (plan.action === 'impossible') {
    return t('Clock times change the running segment. Use a duration, such as −0:06.')
  }
  if (plan.skipped < 60) return null

  /*
   * What is possible first, the reason second — and the reason names the
   * segment, because that is the thing standing in the way.
   */
  if (plan.action === 'shift' && plan.at !== undefined) {
    const limit = hour(plan.at)
    if (adjustment.kind === 'startAt') return t('only from {0} → that is as far as the last segment reaches', limit)
    if (plan.delta === 0) return t('not possible → last segment reaches until {0}', limit)

    return plan.delta > 0
      ? t('only +{0} → last segment reaches until {1}', formatAmount(plan.delta), limit)
      : t('only −{0} → the segment has not been running longer', formatAmount(-plan.delta))
  }

  if (plan.action === 'stop' && plan.at !== undefined) {
    return t('booked until {0} → the timer only ran from then on', hour(plan.at))
  }

  // The segments of this computer, not the entry: a share measured elsewhere
  // is visible in the entry but cannot be taken back from here.
  return plan.delta > 0
    ? t('only +{0} → the segments hold no more', formatAmount(plan.delta))
    : t('only −{0} → the segments hold no more', formatAmount(Math.abs(plan.delta)))
}

function hour(at: number): string {
  return new Date(at).toTimeString().slice(0, 5)
}

/** `9:40` or `09:40` as epoch milliseconds on the day `now` falls on. */
export function timeOfDay(value: string, now: number): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  const day = new Date(now)
  day.setHours(hours, minutes, 0, 0)
  // A time still ahead of us can only have meant yesterday.
  return day.getTime() > now ? day.getTime() - 24 * 3600 * 1000 : day.getTime()
}

/** `90` or `1:30` as seconds; null when it is neither. */
export function duration(value: string): number | null {
  const trimmed = value.trim()
  const clock = /^(\d{1,3}):(\d{2})$/.exec(trimmed)
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60

  const minutes = /^\d+([.,]\d+)?$/.exec(trimmed)
  return minutes ? Math.round(Number(trimmed.replace(',', '.')) * 60) : null
}

/**
 * Everything the typed text could sensibly mean, in the order it should be
 * offered. Empty when it means nothing.
 *
 * `sinceSeconds` turns a clock time into an amount: how long ago it was.
 */
export function readAdjustment(input: string, now: number): Adjustment[] {
  const text = input.trim()
  if (text === '') return []

  // `ab` and `bis` are the German words, kept so that both languages are read.
  const anchored = /^(from|until|ab|bis)\s+(.+)$/i.exec(text)
  if (anchored) {
    const at = timeOfDay(anchored[2]!, now)
    if (at === null) return []
    const time = anchored[2]!.trim()
    const word = anchored[1]!.toLowerCase()

    return word === 'from' || word === 'ab'
      ? [{ kind: 'startAt', at, label: t('count from {0}', time) }]
      : [{ kind: 'stopAt', at, label: t('count only until {0}', time) }]
  }

  // A bare clock time is ambiguous on purpose: both readings are offered.
  const at = timeOfDay(text, now)
  if (at !== null) {
    return [
      { kind: 'startAt', at, label: t('count from {0}', text) },
      { kind: 'stopAt', at, label: t('count only until {0}', text) },
    ]
  }

  const signed = /^([+-])\s*(.+)$/.exec(text)
  if (signed) {
    const amount = duration(signed[2]!)
    if (amount === null) return []
    const seconds = signed[1] === '-' ? -amount : amount
    return [{ kind: 'amount', seconds, label: `${signed[1]}${formatAmount(amount)}` }]
  }

  const amount = duration(text)
  if (amount === null) return []
  return [
    { kind: 'amount', seconds: amount, label: `+${formatAmount(amount)}` },
    { kind: 'amount', seconds: -amount, label: `−${formatAmount(amount)}` },
  ]
}

function formatAmount(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes === 1) return t('1 minute')
  if (minutes < 60) return t('{0} minutes', minutes)
  return t('{0}:{1} hours', Math.floor(minutes / 60), String(minutes % 60).padStart(2, '0'))
}
