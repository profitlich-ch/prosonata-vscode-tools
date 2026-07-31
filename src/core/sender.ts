import { ApiError, type Api, type EntryDraft } from './api.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import type { Journal } from './journal.js'
import { stripMarker, withMarker } from './marker.js'
import { findEntry } from './tracking.js'
import type { State, TimeEntry } from './types.js'
import { workingTime } from './working-time.js'

/**
 * The deferred send (KONZEPT.md §4).
 *
 * Nothing goes out at commit time. A write becomes due once it is older than
 * the configured delay, and then leaves with the next event. Rolled-back
 * commits therefore never reach ProSonata in the first place, without binding
 * the whole thing to a remote.
 *
 * The sum written is `foreign + own`, never the local total (KONZEPT.md §3).
 * Otherwise the office machine would overwrite the hours worked at home. The
 * value does not depend on what was just read, so a retry stays idempotent.
 */

export interface SendResult {
  sent: string[]
  failed: { entryId: string; error: Error }[]
  /** Texts that were too long and were therefore not sent. */
  tooLong: { entryId: string; length: number; limit: number }[]
}

export interface SendDeps {
  api: Api
  clock: Clock
  config: Config
  journal: Journal
}

/** Entry ids whose write is due now. */
export function dueWrites(state: State, clock: Clock, delaySeconds: number): string[] {
  const cutoff = clock.now() - delaySeconds * 1000
  return state.pending.filter((write) => write.since <= cutoff).map((write) => write.entryId)
}

/**
 * Sends everything that is due. Returns the new state; failures stay pending
 * and are tried again at the next event.
 */
export async function send(state: State, deps: SendDeps, force = false): Promise<{ state: State; result: SendResult }> {
  const { clock, config, journal } = deps
  const result: SendResult = { sent: [], failed: [], tooLong: [] }

  const due = force ? state.pending.map((write) => write.entryId) : dueWrites(state, clock, config.sendDelaySeconds)
  let next = structuredClone(state)

  for (const entryId of due) {
    const entry = findEntry(next, entryId)
    if (!entry) {
      next.pending = next.pending.filter((write) => write.entryId !== entryId)
      continue
    }

    // An entry is only written once it has a text (KONZEPT.md §4).
    if (entry.state === 'open' && entry.text === '') continue

    const detail = detailFor(entry, config)
    if (detail.length > config.detailLimit) {
      // ProSonata truncates silently, so we refuse instead of letting a cut
      // sentence reach an invoice. The write stays pending until the text is
      // shortened by hand.
      result.tooLong.push({ entryId, length: detail.length, limit: config.detailLimit })
      continue
    }

    try {
      await writeEntry(entry, detail, deps)
      journal.append(entry.timeId === null ? { kind: 'sent', entryId } : { kind: 'sent', entryId, timeId: entry.timeId })
      next.pending = next.pending.filter((write) => write.entryId !== entryId)
      result.sent.push(entryId)
    } catch (error) {
      result.failed.push({ entryId, error: error as Error })
      // Transient failures simply wait for the next event; anything else is
      // reported but also kept, because dropping it would lose time.
      if (!(error instanceof ApiError) || !error.transient) {
        journal.append({ kind: 'note', entryId, message: (error as Error).message })
      }
    }
  }

  return { state: next, result }
}

/** The text as it goes out: with the marker while open, without once closed. */
export function detailFor(entry: TimeEntry, config: Config): string {
  return entry.state === 'open' ? withMarker(entry.text, entry.key, config.markerWord) : stripMarker(entry.text, config.markerWord)
}

async function writeEntry(entry: TimeEntry, detail: string, deps: SendDeps): Promise<void> {
  const { api, clock, config } = deps
  const total = entry.foreignSeconds + entry.seconds
  const draft: EntryDraft = {
    projectID: entry.projectId,
    category: entry.categoryId,
    date: clock.today(),
    detail,
    workingTime: workingTime(total, config.grid),
  }

  if (entry.timeId === null) {
    const created = await api.createEntry(draft)
    entry.timeId = created.timeID
    entry.lastWritten = total
    return
  }

  // The same read serves two purposes: the invoiced check, and noticing that
  // another machine has written in the meantime.
  const remote = await api.getEntry(entry.timeId)
  if (!remote) {
    // Deleted in ProSonata. Start over rather than resurrect it.
    const created = await api.createEntry(draft)
    entry.timeId = created.timeID
    entry.lastWritten = total
    return
  }

  if (remote.isInvoiced) {
    // An invoiced entry must not grow. The follow-up carries what has come in
    // since the last write, and starts with no foreign share of its own.
    const alreadyBilled = entry.lastWritten ?? 0
    const remainder = Math.max(0, total - alreadyBilled)
    const created = await api.createEntry({
      ...draft,
      workingTime: workingTime(remainder, config.grid),
    })
    entry.timeId = created.timeID
    entry.foreignSeconds = 0
    entry.seconds = remainder
    entry.lastWritten = remainder
    return
  }

  adoptForeignShare(entry, remote.hours)

  const corrected = entry.foreignSeconds + entry.seconds
  await api.updateEntry(entry.timeId, { ...draft, workingTime: workingTime(corrected, config.grid) })
  entry.lastWritten = corrected
}

/**
 * If the remote total differs from what we last wrote, another machine added to
 * it. That difference is the foreign share from now on.
 */
export function adoptForeignShare(entry: TimeEntry, remoteHours: number): void {
  const remoteSeconds = Math.round(remoteHours * 3600)
  if (entry.lastWritten === null) {
    entry.foreignSeconds = remoteSeconds
    return
  }
  const grownElsewhere = remoteSeconds - entry.lastWritten
  if (grownElsewhere > 0) entry.foreignSeconds += grownElsewhere
}
