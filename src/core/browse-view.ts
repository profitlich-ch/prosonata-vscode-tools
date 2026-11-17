/**
 * The table of time entries as the webview draws it, and the messages between
 * it and the extension (docs/adr/0001).
 *
 * **Nothing in here imports anything but types**, and nothing may: the webview
 * bundles this file into the browser, where neither Node nor `vscode` exist.
 * What reaches into the invoice — planning a merge, rounding, deleting — stays
 * in the extension host; the rows arrive here finished, with branch, coverage
 * and the duplicate flag already decided, and what is left is how to look at
 * them: filter, sort, group, add up.
 */

/** One time entry, decided and formatted by the extension host. */
export interface BrowseRow {
  timeID: number
  /** `2026-11-12`. */
  date: string
  /** ISO week the date falls in, `2026-W46` — the key of the week groups. */
  week: string
  /** `detail` as ProSonata holds it; this is what an edit starts from. */
  text: string
  /** ProSonata's hours, in seconds. */
  seconds: number
  /** The same in the notation an edit is prefilled with, `2:15`. */
  hours: string
  /** Null where nothing here knows the branch — an entry made in ProSonata, say. */
  branch: string | null
  /**
   * Seconds the segment log of this machine holds for the entry. Null is
   * "unknown", which is not zero (merge.ts) — the column shows the difference.
   */
  measured: number | null
  invoiced: boolean
  notInvoiceable: boolean
  /** Still collecting time on its branch. */
  open: boolean
  /** Same branch, same day, same text as another row (browse.ts in core). */
  duplicate: boolean
}

/** What a merge of the ticked rows would come to, as the extension planned it. */
export interface MergePreview {
  /** The rows the preview was made for, so a late answer can be recognised. */
  ids: number[]
  keep: number
  /** An open entry stays whatever is chosen (merge.ts); the form then offers no choice. */
  keepFixed: boolean
  /** Every entry of the merge, the one that stays among them, oldest first. */
  members: { timeID: number; date: string; hours: string; text: string; open: boolean }[]
  /** What ProSonata holds now, rounded per entry. */
  added: string
  /** Rounded once from the segment log; null when the log does not cover all of them. */
  recomputed: string | null
  /** What the hours field is prefilled with. */
  proposed: string
  text: string
  date: string
  /** Why the proposal is the number it is, in the language of the window. */
  note: string
}

export interface BrowseData {
  /** `24-017 Feature Buchungsmodul`. */
  project: string
  /** The whole project, every user — not the sum of these rows. */
  budget: { needed: number; planned: number; text: string } | null
  /** `15 min` or `exact`, translated. */
  grid: string
  rows: BrowseRow[]
}

/** Extension → webview. */
export type ToView =
  | { kind: 'show'; locale: string; strings: Record<string, string>; data: BrowseData }
  | { kind: 'busy'; busy: boolean }
  | { kind: 'preview'; preview: MergePreview | null; ids: number[]; reason?: string }
  | { kind: 'failed'; message: string; timeID?: number; field?: 'text' | 'hours' }
  | { kind: 'saved'; timeID: number }
  | { kind: 'merged' }

/** Webview → extension. Intentions only; every one is checked against ProSonata again. */
export type ToHost =
  | { kind: 'ready' }
  | { kind: 'refresh' }
  | { kind: 'preview'; ids: number[]; keep?: number }
  | { kind: 'edit'; timeID: number; field: 'text' | 'hours'; value: string }
  | { kind: 'merge'; ids: number[]; keep: number; text: string; hours: string }
  | { kind: 'remove'; ids: number[] }

export type Grouping = 'branch' | 'week' | 'day' | 'none'
export type SortKey = 'date' | 'hours' | 'id'

export interface RowGroup {
  /** Branch name, ISO week, date, or `''` for the one group without a branch. */
  key: string
  rows: BrowseRow[]
  seconds: number
}

/** Whether a row matches what was typed into the search field: text, number, branch. */
export function matches(row: BrowseRow, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') return true
  const haystack = `${row.text} #${row.timeID} ${row.timeID} ${row.branch ?? ''}`.toLowerCase()
  return wanted.split(/\s+/).every((word) => haystack.includes(word))
}

/**
 * Sorted by one column, ties broken by number — ProSonata hands its ids out in
 * order, so within a day the later entry comes first when descending.
 */
export function sortRows(rows: BrowseRow[], key: SortKey, direction: 1 | -1): BrowseRow[] {
  const value = (row: BrowseRow): number | string =>
    key === 'hours' ? row.seconds : key === 'id' ? row.timeID : row.date
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)]
    if (x !== y) return (x < y ? -1 : 1) * direction
    return (a.timeID - b.timeID) * direction
  })
}

/**
 * The rows in groups, newest group first.
 *
 * By branch, because that is the unit of work and of the invoice line; by week
 * for the question "what did I book last week", by day for "what did I book
 * on Tuesday". Rows without a branch form one
 * group of their own at the end — they are what the table cannot explain, and
 * mixing them in by date would hide that.
 */
export function groupRows(rows: BrowseRow[], by: Grouping, key: SortKey, direction: 1 | -1): RowGroup[] {
  if (by === 'none') return [{ key: '', rows: sortRows(rows, key, direction), seconds: sumSeconds(rows) }]

  const groups = new Map<string, BrowseRow[]>()
  for (const row of rows) {
    const name = by === 'branch' ? (row.branch ?? '') : by === 'week' ? row.week : row.date
    groups.set(name, [...(groups.get(name) ?? []), row])
  }
  const latest = (members: BrowseRow[]) => members.reduce((last, row) => (row.date > last ? row.date : last), '')
  return [...groups]
    .sort(([a, x], [b, y]) => {
      if ((a === '') !== (b === '')) return a === '' ? 1 : -1
      const [p, q] = [latest(x), latest(y)]
      return p === q ? a.localeCompare(b) : p < q ? 1 : -1
    })
    .map(([name, members]) => ({ key: name, rows: sortRows(members, key, direction), seconds: sumSeconds(members) }))
}

export function sumSeconds(rows: BrowseRow[]): number {
  return rows.reduce((sum, row) => sum + row.seconds, 0)
}

/** The rows that can be ticked: an invoiced entry belongs to its invoice, not to this tool. */
export function selectable(rows: BrowseRow[]): BrowseRow[] {
  return rows.filter((row) => !row.invoiced)
}

/**
 * The ticked ids that still stand for a row that can be ticked. After a reload
 * a merged or deleted entry is gone, and an entry may have been invoiced in the
 * meantime; carrying either along would act on something that is not there.
 */
export function keepSelection(selected: number[], rows: BrowseRow[]): number[] {
  const open = new Set(selectable(rows).map((row) => row.timeID))
  return selected.filter((id) => open.has(id))
}

/** `{0}` and friends filled in, the way `@vscode/l10n` does it in the host. */
export function format(message: string, args: Array<string | number>): string {
  return message.replace(/\{(\d+)\}/g, (whole, index: string) => {
    const value = args[Number(index)]
    return value === undefined ? whole : String(value)
  })
}
