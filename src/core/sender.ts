import { ApiError, type Api, type EntryDraft } from './api.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import type { Journal } from './journal.js'
import { readKey, stripMarker, withMarker } from './marker.js'
import { findEntry, parkClosedElsewhere } from './tracking.js'
import type { State, TimeEntry } from './types.js'
import { workingTime, type TimeGrid } from './working-time.js'

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
  /** Entries with no time category yet; `category` is mandatory in ProSonata. */
  missingCategory: string[]
  /** Entries closed on another machine; they wait for an answer, not a write. */
  awaitingDecision: string[]
}

export interface SendDeps {
  api: Api
  clock: Clock
  config: Config
  journal: Journal
  /**
   * The grid of the repository an entry belongs to. A repository may round
   * differently from the default, and the number that matters is the one that
   * goes out — not the one the panel happens to show. Left out, everything
   * rounds by `config.grid`.
   *
   * Asked for at the moment of writing, not frozen into the entry: changing the
   * grid is meant to reach every entry still open, the same way a corrected
   * project or category does.
   */
  gridFor?: (repoPath: string) => TimeGrid
  /**
   * The span of the day an entry was worked, `HH:MM` each, or null when there
   * is none to tell. Null also when the segments straddle days: a span says
   * something only for a single day — `08:12–17:40` over three weeks would
   * claim an attendance that never happened, so the fields are cleared instead.
   */
  spanFor?: (entry: TimeEntry) => { start: string; end: string } | null
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
  const result: SendResult = { sent: [], failed: [], tooLong: [], missingCategory: [], awaitingDecision: [] }

  const due = force ? state.pending.map((write) => write.entryId) : dueWrites(state, clock, config.sendDelaySeconds)
  let next = structuredClone(state)

  for (const entryId of due) {
    const entry = findEntry(next, entryId)
    if (!entry) {
      next.pending = next.pending.filter((write) => write.entryId !== entryId)
      continue
    }

    // Parked because it was closed elsewhere: it waits for an answer, and a
    // commit in the meantime must not queue it back into being written.
    if (entry.awaitingDecision) {
      result.awaitingDecision.push(entryId)
      next.pending = next.pending.filter((write) => write.entryId !== entryId)
      continue
    }

    // An entry is only written once it has a text (KONZEPT.md §4).
    if (entry.state === 'open' && entry.text === '') continue

    // `category` is mandatory in ProSonata. Sending a 0 would either be refused
    // or book onto a category that does not exist, so the write waits for a
    // choice instead — and says so, rather than failing quietly.
    if (entry.categoryId <= 0) {
      result.missingCategory.push(entryId)
      continue
    }

    const detail = detailFor(entry, config, runningSinceOf(next, entry.id))
    if (detail.length > config.detailLimit) {
      // ProSonata truncates silently, so we refuse instead of letting a cut
      // sentence reach an invoice. The write stays pending until the text is
      // shortened by hand.
      result.tooLong.push({ entryId, length: detail.length, limit: config.detailLimit })
      continue
    }

    try {
      const closedElsewhere = await writeEntry(entry, detail, deps.spanFor?.(entry) ?? null, deps)
      if (closedElsewhere !== null) {
        next = parkClosedElsewhere(next, entryId, closedElsewhere)
        result.awaitingDecision.push(entryId)
        journal.append({ kind: 'note', entryId, message: 'auf einem anderen Rechner abgeschlossen — wartet auf Entscheidung' })
        continue
      }
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

/**
 * The text as it goes out: with the marker while open, without once closed. The
 * marker carries the moment the timer started, so another machine sees not only
 * *that* someone is measuring but since when — including the day, which is what
 * tells a running timer from one forgotten last week (KONZEPT.md §2).
 */
export function detailFor(entry: TimeEntry, config: Config, runningSince: number | null = null): string {
  return entry.state === 'open'
    ? withMarker(entry.text, entry.key, config.markerWord, runningSince)
    : stripMarker(entry.text, config.markerWord)
}

/**
 * Writes one entry. Returns null when it went out, or the seconds ProSonata
 * holds when the entry turned out to be closed on another machine — then
 * nothing is written and the caller parks it.
 */
/**
 * When a timer began measuring into this entry, or null while none runs.
 *
 * It rides along with a write that was due anyway — no call of its own. The
 * value is therefore up to the send delay old, which is plenty for what it is
 * for: telling another machine that somebody is working here (KONZEPT.md §2).
 */
function runningSinceOf(state: State, entryId: string): number | null {
  const timer = state.timers.find((candidate) => candidate.entryId === entryId && candidate.startedAt !== null)
  return timer?.startedAt ?? null
}

async function writeEntry(
  entry: TimeEntry,
  detail: string,
  span: { start: string; end: string } | null,
  deps: SendDeps,
): Promise<number | null> {
  const { api, clock, config } = deps
  const grid = deps.gridFor?.(entry.scope.repoPath) ?? config.grid
  const total = entry.foreignSeconds + entry.seconds
  const draft: EntryDraft = {
    projectID: entry.projectId,
    category: entry.categoryId,
    date: clock.today(),
    detail,
    workingTime: workingTime(total, grid),
    // Null clears them; an empty string would write 01:00:00, as measured. So a
    // span that has become multi-day takes the old one away again.
    workingTimeStart: span?.start ?? null,
    workingTimeEnd: span?.end ?? null,
  }

  if (entry.timeId === null) {
    const created = await api.createEntry(draft)
    entry.timeId = created.timeID
    entry.lastWritten = total
    return null
  }

  // The same read serves two purposes: the invoiced check, and noticing that
  // another machine has written in the meantime.
  const remote = await api.getEntry(entry.timeId)
  if (!remote) {
    // Deleted in ProSonata. Start over rather than resurrect it.
    const created = await api.createEntry(draft)
    entry.timeId = created.timeID
    entry.lastWritten = total
    return null
  }

  /*
   * The marker is gone while we still consider the entry open: somebody closed
   * it on another machine. Writing now would put the marker back and overwrite
   * the final text — the entry belongs to whoever closed it (KONZEPT.md §3).
   */
  if (entry.state === 'open' && readKey(remote.detail, config.markerWord) === null) {
    return Math.round(remote.hours * 3600)
  }

  if (remote.isInvoiced) {
    // An invoiced entry must not grow. The follow-up carries what has come in
    // since the last write, and starts with no foreign share of its own.
    const alreadyBilled = entry.lastWritten ?? 0
    const remainder = Math.max(0, total - alreadyBilled)
    const created = await api.createEntry({
      ...draft,
      workingTime: workingTime(remainder, grid),
    })
    entry.timeId = created.timeID
    entry.foreignSeconds = 0
    entry.seconds = remainder
    entry.lastWritten = remainder
    return null
  }

  adoptForeignShare(entry, remote.hours)

  const corrected = entry.foreignSeconds + entry.seconds
  await api.updateEntry(entry.timeId, { ...draft, workingTime: workingTime(corrected, grid) })
  entry.lastWritten = corrected
  return null
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
