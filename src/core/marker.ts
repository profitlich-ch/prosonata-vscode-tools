import { createHash } from 'node:crypto'

/**
 * The marker in the text of an entry: `[LAUFEND] Text` while it is open,
 * nothing once it is closed (KONZEPT.md §3).
 *
 * It has one reader left, the person preparing an invoice: an entry nobody
 * closed stands out exactly where it matters. The machine data — branch key,
 * state, since when a timer runs — lives in `apiComments` (api-comments.ts), so
 * the two channels serve different readers and no longer depend on each other.
 *
 * **Reading still understands the old marker**, `[LAUFEND:a3f9c1][260802-08:12]`
 * while open and `[a3f9c1]` once closed. Entries written before the field
 * existed carry nothing else, and until one of them is written again, this is
 * the only place its branch and state can be read from. The word carried the
 * state there too, the key the identity, and the time bracket the start of the
 * running measurement.
 *
 * Measured against the account: square brackets survive unchanged, and the
 * `detail` filter matches substrings, so an old marker is searchable.
 */

export const DEFAULT_MARKER_WORD = 'LAUFEND'

/** Characters of the hash that make up the branch key. */
const KEY_LENGTH = 6

/**
 * Branch identity: the repository's root commit and the branch name.
 * Both are identical in every clone, so every machine computes the same key
 * without any coordination. The branch name itself never reaches ProSonata.
 */
export function branchKey(rootCommitSha: string, branch: string): string {
  return createHash('sha256').update(`${rootCommitSha}\n${branch}`).digest('hex').slice(0, KEY_LENGTH)
}

/** Prefixes the text with the marker. An empty text yields the marker alone. */
export function withMarker(text: string, word = DEFAULT_MARKER_WORD): string {
  return text ? `[${word}] ${text}` : `[${word}]`
}

/** Removes a leading marker, old or new, with its time bracket. */
export function stripMarker(detail: string, word = DEFAULT_MARKER_WORD): string {
  const match = markerPattern(word).exec(detail)
  return match ? detail.slice(match[0].length).trimStart() : detail
}

/** The key of an old marker, open or closed, or null — the new marker has none. */
export function readKey(detail: string, word = DEFAULT_MARKER_WORD): string | null {
  const match = markerPattern(word).exec(detail)
  return match?.[2] ?? match?.[3] ?? null
}

/**
 * Whether the marker carries the word. For an entry written before
 * `apiComments`, the one signal that says it is unfinished: closing dropped the
 * word and kept the key, so the question has to be asked about the word.
 */
export function isMarkedOpen(detail: string, word = DEFAULT_MARKER_WORD): boolean {
  return markerPattern(word).exec(detail)?.[1] !== undefined
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
  const stamp = match?.[4]
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

/**
 * What finds **any** old entry of this branch, open or closed. The closing bracket
 * belongs to it: without it, six hex characters could turn up inside an ordinary
 * word, and the filter searches substrings.
 */
export function identityTerm(key: string): string {
  return `${key}]`
}

/**
 * Every marker there has been: the word alone (today), the word with a key
 * (open, before `apiComments`), the key alone (closed, before), each optionally
 * followed by the time bracket of the old form.
 */
function markerPattern(word: string): RegExp {
  return new RegExp(
    `^\\[(?:(${escapeRegExp(word)})(?::([0-9a-f]+))?|([0-9a-f]+))\\](?:\\[(\\d{6}-\\d{2}:\\d{2})\\])?\\s*`,
    'i',
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
