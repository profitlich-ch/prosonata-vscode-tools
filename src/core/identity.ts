import type { Api, RemoteEntry } from './api.js'
import { keyTerm, readComments } from './api-comments.js'
import { identityTerm, isMarkedOpen, readKey, readRunningSince, stripMarker } from './marker.js'

/**
 * What an entry in ProSonata says about itself: whose branch it is, whether it
 * is still open, since when a timer runs (KONZEPT.md §3).
 *
 * Read from `apiComments` first, from the marker in the text otherwise. Entries
 * written before the field existed carry only the marker, and the first write of
 * this version moves them over — until then the text is all there is.
 */

export function entryKey(remote: RemoteEntry, word: string): string | null {
  return readComments(remote.apiComments)?.key ?? readKey(remote.detail, word)
}

export function entryIsOpen(remote: RemoteEntry, word: string): boolean {
  const own = readComments(remote.apiComments)
  return own ? own.open : isMarkedOpen(remote.detail, word)
}

export function entryRunningSince(remote: RemoteEntry, word: string): number | null {
  const own = readComments(remote.apiComments)
  return own ? own.running : readRunningSince(remote.detail, word)
}

/** The text a customer reads, whatever marker stands in front of it. */
export function entryText(remote: RemoteEntry, word: string): string {
  return stripMarker(remote.detail, word)
}

/**
 * The not yet invoiced entries of a branch that `wanted` accepts — open ones for
 * adopting, closed ones for adding follow-up time.
 *
 * The field is searched first. Only when it has nothing does a second call look
 * for an old marker in the text, so the everyday case stays one call; the
 * fallback runs where the local state knows no entry, which is rare. Every hit
 * is checked for its key again, because both filters match substrings.
 */
export async function findOfBranch(
  api: Api,
  projectId: number,
  key: string,
  word: string,
  wanted: (remote: RemoteEntry) => boolean,
): Promise<RemoteEntry[]> {
  const ours = (remote: RemoteEntry) => entryKey(remote, word) === key && wanted(remote)

  const byField = (await api.findByComments(projectId, keyTerm(key))).filter(ours)
  if (byField.length > 0) return byField
  return (await api.findByDetail(projectId, identityTerm(key))).filter(ours)
}
