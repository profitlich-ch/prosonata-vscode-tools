import { ApiError, type Api, type EntryDraft } from './api.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import type { Journal } from './journal.js'
import { isMarkedOpen, stripMarker, withIdentity, withMarker } from './marker.js'
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
  /** Left for the next round because the API budget was nearly spent. */
  deferred: string[]
}

/**
 * Calls kept back when a round stops early (KONZEPT.md §9).
 *
 * The account's quota is 50 requests per fifteen minutes, and one entry costs up
 * to two of them — a read for `isInvoiced` and the write itself. A burst of
 * twenty commits would therefore eat the whole window and leave nothing for the
 * panel, the lookup on arrival, or the user pressing "send now".
 *
 * Sending is deferred anyway (§4), so stopping early costs a delay, never a
 * booking: what is left stays pending and goes out next round.
 */
const RATE_LIMIT_FLOOR = 6

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
  /**
   * Claims the right to create this entry in ProSonata, and returns how to give
   * it back — or null when another actor holds a fresh claim, in which case the
   * entry waits for the next round rather than being created twice.
   *
   * A `POST` is not repeatable the way a `PUT` with an absolute sum is: two
   * actors that both see `timeId: null` produce two entries, and in ProSonata
   * two invoice lines. Left out, nothing is claimed — for a single run with no
   * second writer, and for the tests.
   */
  claimCreate?: (entryId: string) => (() => void) | null
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
  const result: SendResult = {
    sent: [],
    failed: [],
    tooLong: [],
    missingCategory: [],
    awaitingDecision: [],
    deferred: [],
  }

  const due = force ? state.pending.map((write) => write.entryId) : dueWrites(state, clock, config.sendDelaySeconds)
  let next = structuredClone(state)

  for (const [index, entryId] of due.entries()) {
    /*
     * What the account has left, from the last answer — the API reports it in
     * every `meta` (KONZEPT.md §9). Stopping here leaves the rest pending, which
     * is where it already was; hammering on would earn a 429 and still not send
     * anything.
     */
    const budget = deps.api.rateLimit()
    if (budget !== null && budget.remaining <= RATE_LIMIT_FLOOR) {
      result.deferred.push(...due.slice(index))
      break
    }

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

    /*
     * A **closed** entry without a text is refused: it is written straight away
     * and would stand on a customer's project as a nameless, final line.
     *
     * An open one goes out under a placeholder instead of waiting. That is what
     * makes it findable from the second machine before the first commit — the
     * search runs over the marker, and a marker only exists once something has
     * been written (KONZEPT.md §3). The first trailer replaces the placeholder.
     */
    if (entry.state === 'closed' && entry.text === '') continue

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

    /*
     * An entry ProSonata does not know yet has to be created, and a create is
     * the one call that cannot be repeated. Claim it first; if somebody else is
     * creating it right now, leave it pending and try again next round — that
     * costs a delay, while creating it twice costs an invoice line.
     */
    let release: (() => void) | null = null
    if (entry.timeId === null && deps.claimCreate) {
      release = deps.claimCreate(entryId)
      if (release === null) continue
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
      // The quota is spent. Every further entry this round would earn the same
      // answer, so the rest waits rather than burning calls on refusals.
      // `finally` below still gives the claim back — a `break` does not skip it.
      if (error instanceof ApiError && error.status === 429) {
        result.deferred.push(...due.slice(index + 1))
        break
      }
    } finally {
      // Also after a failure: the claim is a lease on the call, not on the
      // outcome. Holding it would only delay the retry.
      release?.()
    }
  }

  return { state: next, result }
}

/**
 * Why a queue is not moving, in one line — or null when the last round was
 * uneventful (KONZEPT.md §10).
 *
 * The panel used to show the number of waiting writes and nothing else, so a
 * wrong key, a text over the limit or a spent quota all looked the same: a count
 * that would not go down. Naming the reason is what §10 asks for when it says
 * 403 and 429 must be reported rather than swallowed.
 *
 * In `core` because the panel and the terminal have to say it the same way.
 */
export function describeTrouble(result: SendResult): string | null {
  const [tooLong] = result.tooLong
  if (tooLong) return `Text zu lang: ${tooLong.length} von ${tooLong.limit} Zeichen`
  if (result.missingCategory.length > 0) return 'ohne Zeitkategorie wird nicht gesendet'
  if (result.deferred.length > 0) return 'ProSonata-Kontingent aufgebraucht — geht später raus'

  const [failure] = result.failed
  if (!failure) return null

  const error = failure.error
  if (!(error instanceof ApiError)) return error.message
  if (error.status === 429) return 'ProSonata-Kontingent aufgebraucht — geht später raus'
  if (error.status === 403) return 'ProSonata verweigert den Zugriff — API-Key oder Rechte prüfen'
  if (error.status === 401) return 'ProSonata weist den API-Key ab'
  return error.message
}

/**
 * Folds the outcome of a send onto the state as it stands *now* (KONZEPT.md §7).
 *
 * Between reading the state and writing it back lies an HTTP round-trip, and in
 * that window the hook, the CLI or another window may have booked time or queued
 * a write. Replacing the state with the snapshot `send` worked on would throw
 * exactly that away — which is how queued writes went missing.
 *
 * So identity is taken over, but anything that accumulates is applied as a
 * **difference**: `after − before` added to what stands now. The invoiced branch
 * resets `seconds` to the remainder, and taking that as a value would delete
 * seconds booked in the meantime; as a difference it stays right either way.
 */
export function applySend(current: State, before: State, after: State, result: SendResult): State {
  const next = structuredClone(current)

  for (const entryId of [...result.sent, ...result.awaitingDecision]) {
    const was = findEntry(before, entryId)
    const now = findEntry(after, entryId)
    const mine = findEntry(next, entryId)
    if (!was || !now || !mine) continue

    /*
     * Only claim the id when nobody moved it under us. If it differs, another
     * actor wrote first — then theirs is the one the state already points at,
     * and overwriting it would strand their entry instead of ours. With the
     * creation claim in place this cannot normally happen; it is the backstop.
     */
    if (mine.timeId === was.timeId) {
      mine.timeId = now.timeId
      mine.lastWritten = now.lastWritten
    }

    mine.seconds += now.seconds - was.seconds
    mine.foreignSeconds += now.foreignSeconds - was.foreignSeconds
    if (now.awaitingDecision !== undefined) mine.awaitingDecision = now.awaitingDecision
    if (now.remoteFinalSeconds !== undefined) mine.remoteFinalSeconds = now.remoteFinalSeconds

    next.pending = next.pending.filter((write) => write.entryId !== entryId)
  }

  return next
}

/**
 * The text as it goes out: with the marker while open, without once closed. The
 * marker carries the moment the timer started, so another machine sees not only
 * *that* someone is measuring but since when — including the day, which is what
 * tells a running timer from one forgotten last week (KONZEPT.md §2).
 */
export function detailFor(entry: TimeEntry, config: Config, runningSince: number | null = null): string {
  // Closed: the word goes, the key stays. It is what makes the entry findable
  // later — for follow-up time, for a lost state, for a rolled-back commit.
  if (entry.state !== 'open') return withIdentity(stripMarker(entry.text, config.markerWord), entry.key)
  // The placeholder lives on the wire, never in the entry: locally it stays
  // text-less, so the panel keeps asking for a text and nothing mistakes the
  // stand-in for the line a customer will read.
  return withMarker(entry.text || config.placeholderText, entry.key, config.markerWord, runningSince)
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
    // The day the work happened, not the day it was written — that is the whole
    // point of the daily mode (KONZEPT.md §3).
    date: entry.day ?? clock.today(),
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
  if (entry.state === 'open' && !isMarkedOpen(remote.detail, config.markerWord)) {
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
