/**
 * Turning seconds into ProSonata's `workingTime` (KONZEPT.md §3).
 *
 * The value is the absolute total in decimal hours, never a difference — that
 * is what makes every write idempotent. Measured against the account: a PUT
 * replaces the value, it does not add to it.
 *
 * No imports, and it has to stay that way: the webview of the time entries
 * bundles this file into the browser, for the same notation and the same
 * parsing of hours as the host (docs/adr/0001).
 */

/** Rounding grid, configurable per repository. Minutes, or exact. */
export type TimeGrid = { kind: 'exact' } | { kind: 'minutes'; minutes: number }

export const EXACT: TimeGrid = { kind: 'exact' }

/** Two decimals are the finest ProSonata stores: 0.01 h = 36 s. */
const DECIMALS = 2

/**
 * Decimal hours as a string with a dot, ready for the API.
 *
 * A string, not a number: the API returns `workingTime` as a string on GET and
 * as a number on write, so we never rely on either — but we always *send* a
 * well-formed decimal.
 */
export function workingTime(seconds: number, grid: TimeGrid = EXACT): string {
  return toHours(seconds, grid).toFixed(DECIMALS)
}

export function toHours(seconds: number, grid: TimeGrid = EXACT): number {
  if (seconds <= 0) return 0

  if (grid.kind === 'minutes') {
    const step = grid.minutes * 60
    return Math.ceil(seconds / step) * (step / 3600)
  }

  const hours = seconds / 3600
  const factor = 10 ** DECIMALS
  return Math.round(hours * factor) / factor
}

/**
 * `1:23` — hours and minutes. Seconds would be noise over a day.
 *
 * The sign goes in front of the whole thing: a correction of a quarter of an
 * hour is `−0:15`, not `-1:-15`, which is what dividing a negative number into
 * hours and minutes gives you.
 */
export function hoursAndMinutes(seconds: number): string {
  const amount = Math.abs(seconds)
  return `${seconds < 0 ? '−' : ''}${Math.floor(amount / 3600)}:${String(Math.floor((amount % 3600) / 60)).padStart(2, '0')}`
}

/**
 * What ProSonata will hold for a stretch of time, in the notation people read:
 * `1:16 h`, not `1.27 h`. Decimal hours are what the API stores and what every
 * write sends — but nobody reads `1.27` as a quarter past.
 */
export function billedTime(seconds: number, grid: TimeGrid): string {
  /*
   * To the nearest minute, not down to it. A measured stretch is floored,
   * because a timer must not claim a minute it has not reached — but this is a
   * value already fixed by the grid, and 0.33 h is nearer twenty minutes than
   * nineteen. Flooring also made the notation unstable: the browser fills its
   * field with this text, and `0:20` typed back came out as `0:19`.
   */
  return hoursAndMinutes(Math.round((toHours(seconds, grid) * 3600) / 60) * 60)
}

/** Parses what the API returns, which is a string on GET and a number on write. */
export function parseWorkingTime(value: unknown): number {
  const hours = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(hours) ? hours : 0
}

export function hoursToSeconds(hours: number): number {
  return Math.round(hours * 3600)
}

/**
 * Hours as a person types them, in seconds. `null` when it is neither form.
 *
 * Two notations, and the separator decides which: a colon means hours and
 * minutes (`1:30` is ninety minutes), a dot or comma means decimal hours
 * (`1,5` is the same, `1.30` is 78 minutes). Both are needed because the field
 * is prefilled as `h:mm` while ProSonata shows decimals everywhere — someone
 * reading a number off ProSonata and typing it back must not be turned away.
 *
 * The number goes straight onto an invoice, so anything else is refused rather
 * than guessed at: no bare hours, no negative values, minutes below sixty.
 */
export function parseHours(value: string): number | null {
  const text = value.trim()

  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(text)
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60

  const decimal = /^(\d{1,3})[.,](\d{1,2})$/.exec(text)
  if (decimal) return hoursToSeconds(Number(`${decimal[1]}.${decimal[2]}`))

  return null
}

/**
 * One step of the grid in seconds: what a single entry can gain by rounding.
 *
 * The exact grid holds hundredths of an hour, so its step is 36 seconds.
 */
export function gridStep(grid: TimeGrid): number {
  return grid.kind === 'exact' ? 36 : grid.minutes * 60
}
