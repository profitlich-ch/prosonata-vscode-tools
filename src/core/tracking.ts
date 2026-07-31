import type { Clock } from './clock.js'
import type { EntryMode, PendingWrite, Scope, State, TimeEntry, Timer } from './types.js'

/**
 * Segments and entries (KONZEPT.md §2 and §3).
 *
 * Every function here takes a state and returns a new one. No file access, no
 * network, no clock of its own — that is what makes the rules testable and
 * keeps `core` free of any dependency on VS Code.
 *
 * The rules in one paragraph: a timer measures, a commit cuts. On a branch the
 * time flows into the one entry of that branch, which stays open. On the main
 * branch each commit closes an entry of its own. A timer is never stopped by a
 * commit — the next segment belongs to the next entry.
 */

export interface StartOptions {
  scope: Scope
  key: string
  projectId: number
  categoryId: number
  mode: EntryMode
  /** Text of a new entry; empty until the first commit asks for one. */
  text?: string
  newId: () => string
}

export function findTimer(state: State, scope: Scope): Timer | undefined {
  return state.timers.find((timer) => sameScope(timer.scope, scope))
}

export function findEntry(state: State, id: string): TimeEntry | undefined {
  return state.entries.find((entry) => entry.id === id)
}

/** The open entry of a scope, if there is one. */
export function openEntry(state: State, scope: Scope): TimeEntry | undefined {
  return state.entries.find((entry) => entry.state === 'open' && sameScope(entry.scope, scope))
}

/**
 * Starts a timer in a scope. Resuming a paused timer is the same call — there
 * is at most one timer per scope, and starting it again just sets `startedAt`.
 */
export function start(state: State, clock: Clock, options: StartOptions): State {
  const running = findTimer(state, options.scope)
  if (isRunning(running)) return state

  const next = structuredClone(state)
  if (running) {
    const timer = findTimerIn(next, options.scope)!
    timer.startedAt = clock.now()
    return next
  }

  const entry = openEntry(next, options.scope) ?? createEntry(next, options)
  next.timers.push({
    id: options.newId(),
    origin: 'local',
    remoteTimerId: null,
    scope: options.scope,
    startedAt: clock.now(),
    entryId: entry.id,
  })
  return next
}

/** Pauses a running timer and books the running segment to its entry. */
export function pause(state: State, clock: Clock, scope: Scope): State {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  const startedAt = timer?.startedAt
  if (!timer || startedAt === null || startedAt === undefined) return state

  bookSegment(next, timer.entryId, startedAt, clock.now())
  timer.startedAt = null
  return next
}

export interface CommitOptions {
  scope: Scope
  mode: EntryMode
  /** Text from the trailer, or the commit subject as fallback. */
  text: string
  /** Whether the text came from a trailer — on a branch only then it replaces. */
  fromTrailer: boolean
  sha: string
  /** Commit time in epoch milliseconds; the running segment is cut here. */
  at: number
  newId: () => string
  projectId: number
  categoryId: number
  key: string
}

/**
 * A commit. Cuts the running segment at the commit's own time, then either
 * closes the entry (main branch, or a branch switched to per-commit) or leaves
 * it open to grow.
 *
 * Returns the state and what happened, so callers can tell the user about a
 * commit that arrived while no timer was running.
 */
export function commit(
  state: State,
  options: CommitOptions,
): { state: State; booked: number; closed: TimeEntry | null; hadTimer: boolean } {
  const next = structuredClone(state)
  const timer = findTimerIn(next, options.scope)
  const hadTimer = isRunning(timer)

  let booked = 0
  let entry = openEntry(next, options.scope)

  if (isRunning(timer)) {
    entry ??= findEntry(next, timer.entryId)
    booked = bookSegment(next, timer.entryId, timer.startedAt, options.at)
    // The commit is the dividing line: the next segment starts here.
    timer.startedAt = options.at
  }

  if (!entry) {
    if (!hadTimer) return { state, booked: 0, closed: null, hadTimer: false }
    entry = createEntry(next, {
      scope: options.scope,
      key: options.key,
      projectId: options.projectId,
      categoryId: options.categoryId,
      newId: options.newId,
    })
  }

  if (options.mode === 'commit') {
    entry.text = options.text
    entry.sha = options.sha
    return { state: closeEntry(next, entry, options.newId), booked, closed: entry, hadTimer }
  }

  // On a branch a trailer replaces the text — the last one wins.
  if (options.fromTrailer) entry.text = options.text

  queueWrite(next, entry.id, options.at, false)
  return { state: next, booked, closed: null, hadTimer }
}

/**
 * Closes an entry by hand with its final text (KONZEPT.md §3). After this the
 * tool never writes to that `timeID` again.
 */
export function close(state: State, entryId: string, text: string, at: number, newId: () => string): State {
  const next = structuredClone(state)
  const entry = findEntry(next, entryId)
  if (!entry || entry.state === 'closed') return state

  entry.text = text
  return closeEntry(next, entry, newId, at)
}

/** Books the running segment without ending it. Used before a write goes out. */
export function settle(state: State, clock: Clock, scope: Scope): State {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  const startedAt = timer?.startedAt
  if (!timer || startedAt === null || startedAt === undefined) return state

  const now = clock.now()
  bookSegment(next, timer.entryId, startedAt, now)
  timer.startedAt = now
  return next
}

/** Seconds a scope would book right now, including the running segment. */
export function currentSeconds(state: State, clock: Clock, scope: Scope): number {
  const timer = findTimer(state, scope)
  const running = isRunning(timer) ? elapsed(timer.startedAt, clock.now()) : 0
  return (openEntry(state, scope)?.seconds ?? 0) + running
}

/** Narrows to a timer whose segment is running, so `startedAt` is a number. */
function isRunning(timer: Timer | undefined): timer is Timer & { startedAt: number } {
  return timer !== undefined && timer.startedAt !== null
}

function createEntry(
  state: State,
  options: Pick<StartOptions, 'scope' | 'key' | 'projectId' | 'categoryId' | 'newId'> & { text?: string },
): TimeEntry {
  const entry: TimeEntry = {
    id: options.newId(),
    key: options.key,
    scope: options.scope,
    projectId: options.projectId,
    categoryId: options.categoryId,
    text: options.text ?? '',
    seconds: 0,
    foreignSeconds: 0,
    lastWritten: null,
    timeId: null,
    state: 'open',
  }
  state.entries.push(entry)
  return entry
}

function closeEntry(state: State, entry: TimeEntry, newId: () => string, at = Date.now()): State {
  entry.state = 'closed'
  queueWrite(state, entry.id, at, true)

  // The timer keeps running; its next segment belongs to a new entry.
  const timer = state.timers.find((candidate) => candidate.entryId === entry.id)
  if (timer) {
    const successor = createEntry(state, {
      scope: entry.scope,
      key: entry.key,
      projectId: entry.projectId,
      categoryId: entry.categoryId,
      newId,
    })
    timer.entryId = successor.id
  }
  return state
}

function queueWrite(state: State, entryId: string, at: number, closing: boolean): void {
  const existing = state.pending.find((write) => write.entryId === entryId)
  if (existing) {
    existing.closing ||= closing
    return
  }
  const write: PendingWrite = { entryId, since: at, closing }
  state.pending.push(write)
}

/** Adds a finished segment to its entry. Takes plain numbers, not the timer,
 *  so callers stay free to set `startedAt` afterwards. */
function bookSegment(state: State, entryId: string, from: number, until: number): number {
  const seconds = elapsed(from, until)
  if (seconds <= 0) return 0

  const entry = findEntry(state, entryId)
  if (entry) entry.seconds += seconds
  return seconds
}

function elapsed(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 1000))
}

function findTimerIn(state: State, scope: Scope): Timer | undefined {
  return state.timers.find((timer) => sameScope(timer.scope, scope))
}

export function sameScope(a: Scope, b: Scope): boolean {
  return a.repoPath === b.repoPath && a.branch === b.branch
}
