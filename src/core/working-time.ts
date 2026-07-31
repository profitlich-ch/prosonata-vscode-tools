/**
 * Turning seconds into ProSonata's `workingTime` (KONZEPT.md §3).
 *
 * The value is the absolute total in decimal hours, never a difference — that
 * is what makes every write idempotent. Measured against the account: a PUT
 * replaces the value, it does not add to it.
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

/** Parses what the API returns, which is a string on GET and a number on write. */
export function parseWorkingTime(value: unknown): number {
  const hours = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(hours) ? hours : 0
}

export function hoursToSeconds(hours: number): number {
  return Math.round(hours * 3600)
}
