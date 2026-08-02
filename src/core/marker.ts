import { createHash } from 'node:crypto'

/**
 * The marker of an open entry: `[LAUFEND:a3f9c1][260802-08:12] Text`
 * (KONZEPT.md §3).
 *
 * It does three jobs. It makes an unfinished entry visible in ProSonata — the
 * API has no status field — it carries the branch identity so another machine
 * can find the entry again, and the second bracket says since when a timer is
 * running: `[JJMMTT-HH:MM]`, present only while measuring.
 *
 * That second bracket used to be `workingTimeStart`. Borrowing an API field for
 * a status cost us the field itself and gave a time without a day, so a mark
 * forgotten on another machine still read as "running since 08:12" a week
 * later. Our own namespace can carry a whole moment.
 *
 * Its own bracket, not a longer first one: an older version reads
 * `^\[LAUFEND:([0-9a-f]+)\]` and would no longer recognise a marker with the
 * time inside it — it would conclude the entry was closed elsewhere and park
 * running hours. Beside it, its pattern still matches.
 *
 * Measured against the account: square brackets survive unchanged, and the
 * `detail` filter matches substrings, so the marker is searchable.
 */

export const DEFAULT_MARKER_WORD = 'LAUFEND'

/** Characters of the hash kept in the marker. */
const KEY_LENGTH = 6

/**
 * Branch identity: the repository's root commit and the branch name.
 * Both are identical in every clone, so every machine computes the same key
 * without any coordination. The branch name itself never reaches ProSonata.
 */
export function branchKey(rootCommitSha: string, branch: string): string {
  return createHash('sha256').update(`${rootCommitSha}\n${branch}`).digest('hex').slice(0, KEY_LENGTH)
}

export function buildMarker(key: string, word = DEFAULT_MARKER_WORD, runningSince?: number | null): string {
  return `[${word}:${key}]${runningSince == null ? '' : buildSince(runningSince)}`
}

/** Prefixes the text with the marker. An empty text yields the marker alone. */
export function withMarker(
  text: string,
  key: string,
  word = DEFAULT_MARKER_WORD,
  runningSince?: number | null,
): string {
  const marker = buildMarker(key, word, runningSince)
  return text ? `${marker} ${text}` : marker
}

/** Removes a leading marker, with its time bracket. Used when an entry is closed. */
export function stripMarker(detail: string, word = DEFAULT_MARKER_WORD): string {
  const match = markerPattern(word).exec(detail)
  return match ? detail.slice(match[0].length).trimStart() : detail
}

/** The key of a leading marker, or null if there is none. */
export function readKey(detail: string, word = DEFAULT_MARKER_WORD): string | null {
  const match = markerPattern(word).exec(detail)
  return match?.[1] ?? null
}

/**
 * When the timer behind this marker was started, in epoch milliseconds — null
 * while nothing runs, and null for a marker written before this existed.
 *
 * A two-digit year, read as 2000 + JJ. Local time on both ends: the bracket is
 * written where the work happens and read where somebody asks about it, and a
 * time zone would only be right for one of the two.
 */
export function readRunningSince(detail: string, word = DEFAULT_MARKER_WORD): number | null {
  const match = markerPattern(word).exec(detail)
  const stamp = match?.[2]
  if (!stamp) return null

  const at = new Date(
    2000 + Number(stamp.slice(0, 2)),
    Number(stamp.slice(2, 4)) - 1,
    Number(stamp.slice(4, 6)),
    Number(stamp.slice(7, 9)),
    Number(stamp.slice(10, 12)),
  )
  return Number.isNaN(at.getTime()) ? null : at.getTime()
}

function buildSince(at: number): string {
  const time = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `[${pad(time.getFullYear() % 100)}${pad(time.getMonth() + 1)}${pad(time.getDate())}-${pad(time.getHours())}:${pad(time.getMinutes())}]`
}

/** What the `detail` filter is given to find an open entry of this branch. */
export function searchTerm(key: string, word = DEFAULT_MARKER_WORD): string {
  return `${word}:${key}`
}

/**
 * The whole marker: key bracket, optionally the time bracket. Optional because
 * a paused entry has none — and because markers written before it existed have
 * to stay readable.
 */
function markerPattern(word: string): RegExp {
  return new RegExp(`^\\[${escapeRegExp(word)}:([0-9a-f]+)\\](?:\\[(\\d{6}-\\d{2}:\\d{2})\\])?\\s*`, 'i')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
