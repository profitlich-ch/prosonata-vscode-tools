import { byDay, type BranchSummary, type Segment } from './segments.js'
import { workingTime, type TimeGrid } from './working-time.js'

/**
 * The segment log as a text both front ends show — the editor opens it as a
 * document, the terminal prints it (KONZEPT.md §8). Rendering belongs in `core`
 * for the same reason the rules do: one wording, one set of sums, tested once.
 */

/** `1:23` — hours and minutes. Seconds would be noise over a day. */
export function hoursAndMinutes(seconds: number): string {
  return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`
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

  if (chosen.length === 0) {
    return `# ${title}\n\nKeine Segmente aufgezeichnet.\n`
  }

  const total = chosen.reduce((sum, segment) => sum + segment.seconds, 0)
  const lines = [
    `# ${title}`,
    '',
    `**${hoursAndMinutes(total)} h** in ${chosen.length} Segmenten, ` +
      `abgerechnet ${workingTime(total, options.grid)} h.`,
    '',
  ]

  for (const day of byDay(chosen)) {
    lines.push(`## ${day.date} — ${hoursAndMinutes(day.seconds)} h`, '')
    lines.push('| Von | Bis | Dauer | Branch | Ende |', '|---|---|---|---|---|')
    for (const segment of day.segments) {
      lines.push(
        `| ${timeOf(segment.from)} | ${timeOf(segment.until)} | ${hoursAndMinutes(segment.seconds)} ` +
          `| ${segment.branch} | ${describeReason(segment)} |`,
      )
    }
    lines.push('')
  }

  lines.push(
    '---',
    '',
    'Aufgezeichnet wird auf diesem Rechner. Zeiten, die auf einem anderen Rechner',
    'gemessen wurden, stehen in ProSonata, aber nicht hier.',
    '',
  )
  return lines.join('\n')
}

function describeReason(segment: Segment): string {
  if (segment.reason === 'commit') return 'Commit'
  if (segment.reason === 'pause') return 'Pause'
  return segment.ranSeconds === undefined
    ? 'gekürzt'
    : `gekürzt von ${hoursAndMinutes(segment.ranSeconds)}`
}

/** `feature/buchung · 12:30 h · zuletzt 2026-08-01` for a pick list. */
export function describeBranch(summary: BranchSummary): string {
  return `${hoursAndMinutes(summary.seconds)} h · zuletzt ${summary.last.slice(0, 10)}`
}
