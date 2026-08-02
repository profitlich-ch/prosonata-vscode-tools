import { byDay, type BranchSummary, type Segment } from './segments.js'
import { toHours, type TimeGrid } from './working-time.js'

/**
 * The segment log as a text both front ends show — the editor opens it as a
 * document, the terminal prints it (KONZEPT.md §8). Rendering belongs in `core`
 * for the same reason the rules do: one wording, one set of sums, tested once.
 */

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
  return hoursAndMinutes(Math.round(toHours(seconds, grid) * 3600))
}

/**
 * What all of this becomes in ProSonata — rounded **per time entry**, because
 * that is where rounding happens: one written value per entry, never per day
 * and never over a whole report. Since the grid rounds up, the sum of the
 * roundings is larger than the rounding of the sum; taking the total in one go
 * would quietly understate what the customer is charged.
 *
 * Two things it cannot know: a share measured on another machine is not in this
 * log, and segments recorded before their entry existed carry no id — they are
 * counted as one group of their own.
 */
export function billedSeconds(segments: Segment[], grid: TimeGrid): number {
  const perEntry = new Map<string, number>()
  for (const segment of segments) {
    perEntry.set(segment.entryId, (perEntry.get(segment.entryId) ?? 0) + segment.seconds)
  }

  return [...perEntry.values()].reduce((sum, seconds) => sum + Math.round(toHours(seconds, grid) * 3600), 0)
}

function timeOf(iso: string): string {
  return iso.slice(11, 16)
}

export interface ReportOptions {
  /** Null for every branch the log knows. */
  branch: string | null
  grid: TimeGrid
}

export function renderReport(segments: Segment[], options: ReportOptions): string {
  const chosen = options.branch === null ? segments : segments.filter((segment) => segment.branch === options.branch)
  const title = options.branch === null ? 'Alle Branches' : options.branch

  /*
   * The reach of this document, before its numbers rather than after them: a
   * reader who does not know what is missing reads every sum below wrongly —
   * and on an empty list it is the likeliest explanation of all.
   */
  const scope = [
    'Aufgezeichnet wird auf diesem Rechner. Zeiten, die auf einem anderen Rechner',
    'gemessen wurden, stehen in ProSonata, aber nicht hier.',
    '',
  ]

  if (chosen.length === 0) {
    return [`# ${title}`, '', ...scope, 'Keine Segmente aufgezeichnet.', ''].join('\n')
  }

  const total = chosen.reduce((sum, segment) => sum + segment.seconds, 0)
  // Closing notes are not segments; counting them would inflate the number.
  const measuredCount = chosen.filter((segment) => segment.reason !== 'entry').length
  const billed = hoursAndMinutes(billedSeconds(chosen, options.grid))
  const measured = hoursAndMinutes(total)
  const lines = [
    `# ${title}`,
    '',
    ...scope,
    // Only when the grid actually moves the number: `5:01 h, abgerechnet 5:01 h`
    // says the same thing twice and reads like a mistake.
    `**${measured} h** in ${measuredCount} Segmenten${billed === measured ? '.' : `, abgerechnet ${billed} h.`}`,
    '',
  ]

  // The branch column only earns its place when several are shown; on a single
  // branch it repeats the heading on every row.
  const withBranch = options.branch === null

  for (const day of byDay(chosen)) {
    lines.push(`## ${day.date} — ${hoursAndMinutes(day.seconds)} h`, '')
    lines.push(
      withBranch ? '| Von | Bis | Dauer | Branch | Ende |' : '| Von | Bis | Dauer | Ende |',
      withBranch ? '|---|---|---|---|---|' : '|---|---|---|---|',
    )
    for (const segment of day.segments) {
      const cells = [
        segment.from === undefined ? '—' : timeOf(segment.from),
        segment.reason === 'entry' ? '—' : timeOf(segment.until),
        hoursAndMinutes(segment.reason === 'entry' ? (segment.bookedSeconds ?? 0) : segment.seconds),
        ...(withBranch ? [segment.branch] : []),
        describeReason(segment),
      ]
      lines.push(`| ${cells.join(' | ')} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function describeReason(segment: Segment): string {
  if (segment.reason === 'entry') return '**Zeiteintrag**'
  if (segment.reason === 'commit') return 'Commit'
  if (segment.reason === 'pause') return 'Pause'
  if (segment.reason === 'correction') return 'Korrektur'
  return segment.ranSeconds === undefined
    ? 'gekürzt'
    : `gekürzt von ${hoursAndMinutes(segment.ranSeconds)}`
}

/** `feature/buchung · 12:30 h · zuletzt 2026-08-01` for a pick list. */
export function describeBranch(summary: BranchSummary): string {
  return `${hoursAndMinutes(summary.seconds)} h · zuletzt ${summary.last.slice(0, 10)}`
}
