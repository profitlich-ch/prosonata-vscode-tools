import type { RemoteEntry } from './api.js'
import type { BrowseRow } from './browse-view.js'
import { entryIsOpen, entryKey, entryText } from './identity.js'
import { billedTime, hoursToSeconds, type TimeGrid } from './working-time.js'

/**
 * The rows of the table of time entries, decided in the extension host
 * (docs/adr/0001). The webview only draws them.
 */

/** Where the branch of an entry can be read from, best source first. */
export interface BranchSources {
  /** From the local state: an entry this machine sent knows its branch by name. */
  byTimeId: Map<number, string>
  /**
   * From the branch key in `apiComments` or the old marker. The branch name
   * never reaches ProSonata, only its hash — so this map is built backwards,
   * from every name that could have produced a key here: local branches and
   * the branches of entries in the state.
   */
  byKey: Map<string, string>
}

export interface RowOptions {
  measured: Map<number, number>
  branches: BranchSources
  markerWord: string
  grid: TimeGrid
}

export function browseRows(entries: RemoteEntry[], options: RowOptions): BrowseRow[] {
  const rows = entries.map((entry): BrowseRow => {
    const key = entryKey(entry, options.markerWord)
    const seconds = hoursToSeconds(entry.hours)
    return {
      timeID: entry.timeID,
      date: entry.date,
      week: isoWeek(entry.date),
      text: entry.detail,
      seconds,
      hours: billedTime(seconds, options.grid),
      branch: options.branches.byTimeId.get(entry.timeID) ?? (key === null ? undefined : options.branches.byKey.get(key)) ?? null,
      measured: options.measured.get(entry.timeID) ?? null,
      invoiced: entry.isInvoiced,
      notInvoiceable: entry.notInvoiceable,
      open: entryIsOpen(entry, options.markerWord),
      duplicate: false,
    }
  })
  return markDuplicates(rows, entries, options.markerWord)
}

/**
 * Same branch, same day, same text: the shape of the 61 entries a fault
 * created twice (CLAUDE.md). A hint, not a verdict — two commits on main can
 * honestly say the same thing on one day — so it only marks, it decides
 * nothing. Without a branch or without a text there is nothing to compare.
 */
function markDuplicates(rows: BrowseRow[], entries: RemoteEntry[], word: string): BrowseRow[] {
  const textOf = new Map(entries.map((entry) => [entry.timeID, entryText(entry, word).trim()]))
  const signature = (row: BrowseRow): string | null => {
    const text = textOf.get(row.timeID) ?? ''
    return row.branch === null || text === '' ? null : `${row.branch}\n${row.date}\n${text}`
  }

  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = signature(row)
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return rows.map((row) => {
    const key = signature(row)
    return key !== null && (counts.get(key) ?? 0) > 1 ? { ...row, duplicate: true } : row
  })
}

/**
 * `2026-W46` for a date. ISO weeks, as calendars in Switzerland and Germany
 * count them: Monday first, and week 1 is the one with the year's first
 * Thursday — so 1 January can belong to week 53 of the year before.
 */
export function isoWeek(date: string): string {
  const day = new Date(`${date}T12:00:00Z`)
  const weekday = (day.getUTCDay() + 6) % 7
  // The Thursday of the same week decides which year the week belongs to.
  day.setUTCDate(day.getUTCDate() - weekday + 3)
  const year = day.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)
  const week = 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return `${year}-W${String(week).padStart(2, '0')}`
}
