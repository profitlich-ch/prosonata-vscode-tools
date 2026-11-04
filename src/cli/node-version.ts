import { t } from '../core/l10n.js'

/**
 * The oldest Node the CLI runs on: the first with a global `fetch`. What the
 * code needs, not `engines.node` — that is the oldest line still supported,
 * and refusing a Node that works would only cost a booking (KONZEPT.md §8).
 */
export const OLDEST_NODE = 18

/**
 * Why this Node cannot run the CLI, or `undefined` when it can.
 *
 * @param version `process.versions.node`, such as `"16.20.2"`
 * @param execPath the binary, so that the message names which of several Nodes is meant
 */
export function nodeTooOld(version: string, execPath: string): string | undefined {
  const major = Number.parseInt(version, 10)
  if (major >= OLDEST_NODE) return undefined
  return t(
    'prosonata needs Node.js {0} or newer, this is {1} at {2}. Install a newer one; if the Git hook runs this one, run "prosonata init" again with the newer one.\n',
    OLDEST_NODE,
    version,
    execPath,
  )
}
