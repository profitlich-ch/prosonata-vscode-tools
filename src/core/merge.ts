import type { RemoteEntry } from './api.js'
import type { Segment } from './segments.js'
import { gridStep, hoursToSeconds, toHours, type TimeGrid } from './working-time.js'

/**
 * Putting several time entries back into one (KONZEPT.md §3).
 *
 * **Rounding belongs to a piece of work, not to a record.** Whoever merges is
 * saying: this was done in one go — so it is rounded once. Three commits of
 * twenty minutes cost half an hour each on a quarter-hour grid, 1:30 in all;
 * as one entry the same work is 1:00. The difference is not a discount, it is
 * the inflation that the split caused in the first place.
 *
 * That only holds while the raw seconds are actually here. The segment log
 * knows what **this** machine measured; a share from the other computer, or an
 * entry older than the log, is missing from it. Then the principle cannot be
 * applied honestly, and the sum of what ProSonata holds is proposed instead —
 * said out loud, rather than quietly handing over a number that is short.
 */

export interface MergePlan {
  /** The entry that stays; the others are deleted once its write is through. */
  keep: RemoteEntry
  drop: RemoteEntry[]
  /** Seconds ProSonata holds today, already rounded per entry. */
  addedSeconds: number
  /**
   * Seconds recomputed from the segment log, rounded once — or null when the
   * log does not cover every entry, in which case there is nothing honest to
   * recompute from.
   */
  recomputedSeconds: number | null
  /** The texts, joined, for the field the user edits. */
  text: string
  /** The day the merged entry lands on: the latest of them. */
  date: string
  /** Entries that cannot take part, with the reason. */
  refused: { entry: RemoteEntry; reason: 'invoiced' }[]
}

/** Marker and key stripped; a merged text is written fresh. */
function withoutMarker(detail: string): string {
  return detail.replace(/^\[[^\]]*\](?:\[[^\]]*\])?\s*/, '').trim()
}

/**
 * Seconds measured here per `timeID`, from the segment log.
 *
 * A segment carries the **local** entry id, so the join runs over the state,
 * which knows both. An entry missing from the map was never measured on this
 * machine — that is "unknown", not "zero", and the two must not be confused.
 *
 * **The closing line is left out**, and that is the whole point of this
 * function. It carries `seconds: 0` on purpose — its time already stands in the
 * segments above it — so counting it would put the entry in the map without
 * contributing anything measured. "Unknown" would then look like "zero", and a
 * merge would propose 0:00 for entries that hold real hours.
 */
export function measuredPerEntry(segments: Segment[], timeIdOf: Map<string, number>): Map<number, number> {
  const seconds = new Map<number, number>()
  for (const segment of segments) {
    if (segment.reason === 'entry') continue

    const timeId = timeIdOf.get(segment.entryId)
    if (timeId === undefined) continue
    seconds.set(timeId, (seconds.get(timeId) ?? 0) + Math.max(0, segment.seconds))
  }
  return seconds
}

export function planMerge(entries: RemoteEntry[], measured: Map<number, number>, grid: TimeGrid): MergePlan | null {
  const refused = entries.filter((entry) => entry.isInvoiced).map((entry) => ({ entry, reason: 'invoiced' as const }))
  const usable = entries.filter((entry) => !entry.isInvoiced).sort((a, b) => a.timeID - b.timeID)
  if (usable.length < 2) return null

  const [keep, ...drop] = usable as [RemoteEntry, ...RemoteEntry[]]

  const addedSeconds = usable.reduce((sum, entry) => sum + Math.round(entry.hours * 3600), 0)

  /*
   * Recomputing has to be earned, and two things earn it.
   *
   * Every entry must appear with time of its own — present with zero is not
   * coverage, whatever else the log knows about it.
   *
   * And the measured total must be able to explain the booked one. Rounding is
   * the only thing that may separate them, and it can add at most one step per
   * entry; anything beyond that means the hours came from somewhere this log
   * never saw. That happens for real: a share measured on another machine, an
   * entry older than the log — and, at this account, the days on which a fault
   * cut the log into thirty-second scraps. In every one of those cases the
   * honest number is what ProSonata holds, not a recomputation from a fraction.
   *
   * The distance is checked in **both** directions. Measuring more than
   * ProSonata holds means somebody lowered the entry there by hand, and a
   * recomputation would quietly undo that correction and raise the invoice.
   */
  const rawSeconds = usable.reduce((sum, entry) => sum + (measured.get(entry.timeID) ?? 0), 0)
  const everyEntryKnown = usable.every((entry) => (measured.get(entry.timeID) ?? 0) > 0)
  const explainsTheHours = Math.abs(rawSeconds - addedSeconds) <= usable.length * gridStep(grid)
  const covered = everyEntryKnown && explainsTheHours

  return {
    keep,
    drop,
    addedSeconds,
    recomputedSeconds: covered ? Math.round(toHours(rawSeconds, grid) * 3600) : null,
    text: joinTexts(usable.map((entry) => withoutMarker(entry.detail))),
    date: usable.map((entry) => entry.date).sort().at(-1) ?? keep.date,
    refused,
  }
}

/**
 * The texts one after another, without repeating one that says the same thing
 * twice — the commonest merge is a duplicate, where two identical lines would
 * only be in the way.
 */
export function joinTexts(texts: string[]): string {
  const seen: string[] = []
  for (const text of texts) {
    const trimmed = text.trim()
    if (trimmed !== '' && !seen.includes(trimmed)) seen.push(trimmed)
  }
  return seen.join('; ')
}

/** What deleting a selection would do. */
export interface RemovalPlan {
  /** The entries that would actually go. */
  remove: RemoteEntry[]
  /** The ones left standing because they are invoiced. */
  invoiced: RemoteEntry[]
  /** Their measured total, for the question put before the deletion. */
  seconds: number
}

/**
 * Plans the deletion of a selection, or `null` when nothing may go.
 *
 * Invoiced entries are separated out rather than quietly skipped: they belong to
 * an invoice, not to this tool (KONZEPT.md §3), and a list that silently does
 * less than it says is worse than one that explains itself. They are handed back
 * so the question can name them.
 */
export function planRemoval(entries: RemoteEntry[]): RemovalPlan | null {
  const remove = entries.filter((entry) => !entry.isInvoiced)
  if (remove.length === 0) return null

  return {
    remove,
    invoiced: entries.filter((entry) => entry.isInvoiced),
    seconds: remove.reduce((sum, entry) => sum + hoursToSeconds(entry.hours), 0),
  }
}
