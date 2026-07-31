import { createHash } from 'node:crypto'

/**
 * The marker of an open entry: `[LAUFEND:a3f9c1] Text` (KONZEPT.md §3).
 *
 * It does two jobs. It makes an unfinished entry visible in ProSonata — the API
 * has no status field — and it carries the branch identity so another machine
 * can find the entry again.
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

export function buildMarker(key: string, word = DEFAULT_MARKER_WORD): string {
  return `[${word}:${key}]`
}

/** Prefixes the text with the marker. An empty text yields the marker alone. */
export function withMarker(text: string, key: string, word = DEFAULT_MARKER_WORD): string {
  const marker = buildMarker(key, word)
  return text ? `${marker} ${text}` : marker
}

/** Removes a leading marker. Used when an entry is closed. */
export function stripMarker(detail: string, word = DEFAULT_MARKER_WORD): string {
  const match = markerPattern(word).exec(detail)
  return match ? detail.slice(match[0].length).trimStart() : detail
}

/** The key of a leading marker, or null if there is none. */
export function readKey(detail: string, word = DEFAULT_MARKER_WORD): string | null {
  const match = markerPattern(word).exec(detail)
  return match?.[1] ?? null
}

/** What the `detail` filter is given to find an open entry of this branch. */
export function searchTerm(key: string, word = DEFAULT_MARKER_WORD): string {
  return `${word}:${key}`
}

function markerPattern(word: string): RegExp {
  return new RegExp(`^\\[${escapeRegExp(word)}:([0-9a-f]+)\\]\\s*`, 'i')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
