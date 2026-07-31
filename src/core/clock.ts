/**
 * The clock is injected so tests do not depend on the machine's time.
 *
 * `today()` deliberately uses the *local* date of this machine, not UTC:
 * `date` is a plain date in the API, so nothing is converted — the only
 * question is which day the user considers today (KONZEPT.md §3).
 */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number
  /** Local calendar date as `YYYY-MM-DD`. */
  today(): string
}

export function localDate(at: Date): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const systemClock: Clock = {
  now: () => Date.now(),
  today: () => localDate(new Date()),
}

/** Test double. `advance` moves it forward without waiting. */
export function fixedClock(startMs: number): Clock & { advance(seconds: number): void } {
  let ms = startMs
  return {
    now: () => ms,
    today: () => localDate(new Date(ms)),
    advance: (seconds: number) => {
      ms += seconds * 1000
    },
  }
}
