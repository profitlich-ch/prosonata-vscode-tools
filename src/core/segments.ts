import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * `segments.jsonl` — every measured segment, on this machine (KONZEPT.md §7).
 *
 * An archive, unlike `log.jsonl` next to it: that one is a buffer for pending
 * writes and gets trimmed, this one is kept. It answers a question nothing else
 * can, not even ProSonata: how much was worked on which day. An entry carries
 * one sum and one date — the date of its last write — so a branch that ran for
 * three weeks tells you nothing about the Tuesday in the middle.
 *
 * It also survives the branch. The list of branches is read from here, which is
 * why deleted ones are still in it.
 *
 * What it does not know: the other machine. Segments are measured where they
 * happen; ProSonata holds the sum of both, this file the detail of one.
 */

export interface Segment {
  /** Start and end of the measured span, local time with offset. */
  from: string
  until: string
  seconds: number
  repoPath: string
  branch: string
  projectId: number
  entryId: string
  /** What ended the segment. `trimmed` is one the user shortened by hand. */
  reason: 'pause' | 'commit' | 'trimmed'
  /** For `trimmed`: how long it really ran before the answer cut it. */
  ranSeconds?: number
}

export class SegmentLog {
  constructor(private readonly file: string) {}

  append(segment: Segment): void {
    if (segment.seconds <= 0 && segment.reason !== 'trimmed') return

    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, `${JSON.stringify(segment)}\n`, { mode: 0o600 })
  }

  read(): Segment[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Segment]
        } catch {
          // A line torn by a crash costs us that line, not the file.
          return []
        }
      })
  }
}

export interface BranchSummary {
  branch: string
  repoPath: string
  seconds: number
  /** Newest segment of that branch, for sorting and for showing an age. */
  last: string
}

/**
 * The branches the log knows, newest first — including those that no longer
 * exist in git. That is the point: a deleted branch keeps its hours.
 */
export function branchesIn(segments: Segment[], repoPath?: string): BranchSummary[] {
  const byBranch = new Map<string, BranchSummary>()

  for (const segment of segments) {
    if (repoPath !== undefined && segment.repoPath !== repoPath) continue
    const key = `${segment.repoPath}\n${segment.branch}`
    const known = byBranch.get(key)
    if (known) {
      known.seconds += segment.seconds
      if (segment.until > known.last) known.last = segment.until
    } else {
      byBranch.set(key, {
        branch: segment.branch,
        repoPath: segment.repoPath,
        seconds: segment.seconds,
        last: segment.until,
      })
    }
  }

  return [...byBranch.values()].sort((a, b) => b.last.localeCompare(a.last))
}

export interface Day {
  /** `2026-08-01`, the day the segment ended on. */
  date: string
  seconds: number
  segments: Segment[]
}

/** Segments by day, newest day first, and inside a day in the order measured. */
export function byDay(segments: Segment[]): Day[] {
  const days = new Map<string, Day>()

  for (const segment of segments) {
    const date = segment.until.slice(0, 10)
    const known = days.get(date)
    if (known) {
      known.seconds += segment.seconds
      known.segments.push(segment)
    } else {
      days.set(date, { date, seconds: segment.seconds, segments: [segment] })
    }
  }

  return [...days.values()]
    .map((day) => ({ ...day, segments: day.segments.sort((a, b) => a.from.localeCompare(b.from)) }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** `2026-08-01T09:12:03+02:00` — local time, so a day is the day it felt like. */
export function atLocal(epochMillis: number): string {
  const date = new Date(epochMillis)
  const pad = (value: number) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  )
}
