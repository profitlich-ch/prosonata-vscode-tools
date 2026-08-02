import type { Api } from './api.js'
import type { Config } from './config.js'
import { localDate } from './clock.js'
import { readKey, readRunningSince, stripMarker } from './marker.js'
import { openEntry, parkClosedElsewhere } from './tracking.js'
import type { Scope, State, TimeEntry } from './types.js'

/**
 * Reconciling the local state with ProSonata (KONZEPT.md §3 and §7).
 *
 * This is the same mechanism twice over. A machine that has never seen a branch
 * and a machine whose `state.json` was lost are indistinguishable — both look
 * for the branch key among the open entries of the project and adopt what they
 * find. Recovery is therefore not a special case.
 *
 * When an entry is adopted, the remote total becomes the foreign share and the
 * own sum starts at zero. Nothing is counted twice and nothing is lost: later
 * writes only add what accrues from now on.
 */

export interface SyncOutcome {
  state: State
  /** Adopted an entry another machine had created. */
  adopted: boolean
  /** The entry was closed elsewhere; it now waits for an answer. */
  closedElsewhere: boolean
  /**
   * When the marker of this entry says a timer was started, while nothing is
   * measuring here: somebody else is working on this branch — or forgot to stop.
   * Epoch milliseconds, so the day is part of the answer.
   */
  runningElsewhereSince: number | null
}

export interface SyncOptions {
  scope: Scope
  key: string
  projectId: number
  categoryId: number
  newId: () => string
}

export async function sync(state: State, api: Api, config: Config, options: SyncOptions): Promise<SyncOutcome> {
  const next = structuredClone(state)
  const local = openEntry(next, options.scope)
  const measuringHere = next.timers.some(
    (timer) => timer.startedAt !== null && timer.scope.repoPath === options.scope.repoPath && timer.scope.branch === options.scope.branch,
  )
  /* Only worth reporting when we are not the ones measuring — otherwise the
   * mark is most likely our own from the last write. Read from the marker, not
   * from `workingTimeStart`: the marker carries the day as well, and without a
   * day a mark forgotten last week reads exactly like one from this morning. */
  const runningElsewhere = (remote: { detail: string }): number | null =>
    measuringHere ? null : readRunningSince(remote.detail, config.markerWord)

  // An entry we already know: check whether it is still open over there.
  if (local?.timeId != null) {
    const remote = await api.getEntry(local.timeId)
    if (remote && readKey(remote.detail, config.markerWord) === null) {
      // The marker is gone: somebody closed it. Nothing is written to it any
      // more — the time measured here waits for an answer (KONZEPT.md §3).
      return {
        state: parkClosedElsewhere(next, local.id, Math.round(remote.hours * 3600)),
        adopted: false,
        closedElsewhere: true,
        runningElsewhereSince: null,
      }
    }
    return {
      state: next,
      adopted: false,
      closedElsewhere: false,
      runningElsewhereSince: remote ? runningElsewhere(remote) : null,
    }
  }

  const found = await api.findByKey(options.projectId, options.key, config.markerWord)
  const match = found.find((entry) => readKey(entry.detail, config.markerWord) === options.key)
  if (!match) return { state: next, adopted: false, closedElsewhere: false, runningElsewhereSince: null }

  const seconds = Math.round(match.hours * 3600)
  if (local) {
    local.timeId = match.timeID
    local.foreignSeconds = seconds
    local.lastWritten = seconds + local.seconds
    if (local.text === '') local.text = stripMarker(match.detail, config.markerWord)
  } else {
    const adopted: TimeEntry = {
      id: options.newId(),
      key: options.key,
      scope: options.scope,
      projectId: options.projectId,
      categoryId: options.categoryId,
      text: stripMarker(match.detail, config.markerWord),
      seconds: 0,
      foreignSeconds: seconds,
      lastWritten: seconds,
      timeId: match.timeID,
      state: 'open',
    }
    next.entries.push(adopted)
  }

  return { state: next, adopted: true, closedElsewhere: false, runningElsewhereSince: runningElsewhere(match) }
}

/**
 * How a timer running on another machine is put into words (KONZEPT.md §2).
 *
 * Lives here so the editor and the terminal say the same thing — and because
 * the wording depends on the age: past a day it is no longer news that somebody
 * is working, it is the suspicion that a timer was forgotten. Nothing is
 * silently dropped, because the timer may really still be running.
 */
export function describeRunningElsewhere(since: number, now: number): string {
  const day = new Date(since)
  const time = `${String(day.getHours()).padStart(2, '0')}:${String(day.getMinutes()).padStart(2, '0')}`
  const today = localDate(new Date(now))
  const yesterday = localDate(new Date(now - 24 * 3600 * 1000))
  const on = localDate(day)

  if (on === today) return `auf einem anderen Rechner läuft seit ${time} ein Timer auf diesem Branch`
  if (on === yesterday) return `auf einem anderen Rechner läuft seit gestern ${time} ein Timer auf diesem Branch`

  const date = `${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}.`
  return `ein anderer Rechner trägt seit ${date} ${time} eine laufende Messung auf diesem Branch — dort wurde vermutlich das Anhalten vergessen`
}
