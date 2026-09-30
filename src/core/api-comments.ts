/**
 * The machine data of an entry, in ProSonata's `apiComments` (KONZEPT.md §3
 * and §12). A field nobody reads on an invoice and nobody edits by hand — which
 * is why the branch key and the state live here and no longer in the text.
 *
 * ```json
 * {"profitlich.prosonata-vscode-tools":{"v":1,"key":"a3f9c1","open":true,"running":"2026-09-30T08:12"}}
 * ```
 *
 * **The outer key is the extension's id**, lowercased the way VS Code normalises
 * it, so other integrations can share the field without overwriting each other.
 * Writing therefore keeps whatever else stands there and replaces only our part.
 *
 * **Our part is written in a fixed order.** The search runs over the text as a
 * substring (`"key":"a3f9c1"`), and measured against the account the field is
 * stored character for character — so the text we build is the text we find.
 *
 * **`open` is explicit.** Reading it from a missing `running` would make a paused
 * entry and a finished one look the same, and on that difference hangs the
 * "closed on another machine" check.
 */

/** The extension's id — `publisher.name`, lowercased as VS Code does (KONZEPT.md §10). */
export const EXTENSION_ID = 'profitlich.prosonata-vscode-tools'

const FORMAT_VERSION = 1

export interface OwnComments {
  key: string
  open: boolean
  /** When the timer measuring into this entry started, epoch ms; null while none runs. */
  running: number | null
}

/**
 * The field as it goes out: `existing` with our part replaced. Anything else in
 * it — another integration's part — survives; unreadable content does not,
 * since there is nothing in it to preserve.
 */
export function buildComments(existing: string | null, own: OwnComments): string {
  const mine: Record<string, unknown> = { v: FORMAT_VERSION, key: own.key, open: own.open }
  if (own.running !== null) mine['running'] = formatRunning(own.running)
  return JSON.stringify({ ...parseObject(existing), [EXTENSION_ID]: mine })
}

/**
 * Our part of the field, or null when there is none — an entry from before the
 * field, an empty field (`null` or `""`, both measured), or a broken one. Null
 * sends the reader back to the marker in the text.
 */
export function readComments(raw: string | null): OwnComments | null {
  const mine = parseObject(raw)?.[EXTENSION_ID]
  if (typeof mine !== 'object' || mine === null) return null

  const { key, open, running } = mine as Record<string, unknown>
  if (typeof key !== 'string' || typeof open !== 'boolean') return null
  return { key, open, running: typeof running === 'string' ? parseRunning(running) : null }
}

/**
 * What the `apiComments` filter is given to find the entries of a branch, open
 * or closed. The quotes make it specific; a match is still checked, because
 * another integration may use a `key` of its own.
 */
export function keyTerm(key: string): string {
  return `"key":${JSON.stringify(key)}`
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * `JJJJ-MM-TTTHH:MM` in local time. Local on both ends: it is written where the
 * work happens and read where somebody asks about it, and a time zone would only
 * be right for one of the two.
 */
function formatRunning(at: number): string {
  const time = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}T${pad(time.getHours())}:${pad(time.getMinutes())}`
}

function parseRunning(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute] = match.map(Number)
  const at = new Date(year!, month! - 1, day, hour, minute)
  return Number.isNaN(at.getTime()) ? null : at.getTime()
}
