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

/**
 * Pauses a running timer and books the running segment to its entry.
 *
 * An entry ProSonata already knows is queued for a write: while measuring, its
 * `workingTimeStart` says "running here", and pausing has to take that back.
 * The write goes out with the usual delay — or right away when VS Code closes,
 * which flushes.
 */
export function pause(state: State, clock: Clock, scope: Scope): State {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  const startedAt = timer?.startedAt
  if (!timer || startedAt === null || startedAt === undefined) return state

  bookSegment(next, timer.entryId, startedAt, clock.now())
  timer.startedAt = null
  if (findEntry(next, timer.entryId)?.timeId !== null) queueWrite(next, timer.entryId, clock.now(), false)
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

/*
 * Closed on another machine (KONZEPT.md §3).
 *
 * The entry belongs to whoever closed it: its final text is set, the marker is
 * gone, and corrections made in ProSonata must survive. Writing into it again
 * would undo all three. But the time measured here since the last write is
 * real, and it has to go somewhere.
 *
 * The tool does not decide that. It parks the entry — nothing is written, the
 * timer keeps running into it, so the answer covers everything that accrues in
 * the meantime — and asks where somebody can answer: not in the `post-commit`
 * hook, where this is usually noticed, but in the editor or on the terminal.
 */

/** What ProSonata does not know about this entry yet. */
export function unwrittenSeconds(entry: TimeEntry): number {
  return Math.max(0, entry.foreignSeconds + entry.seconds - (entry.remoteFinalSeconds ?? 0))
}

/** Stops every write to an entry that was closed elsewhere, and asks nothing. */
export function parkClosedElsewhere(state: State, entryId: string, remoteSeconds: number): State {
  const next = structuredClone(state)
  const entry = findEntry(next, entryId)
  if (!entry || entry.state === 'closed' || entry.awaitingDecision) return state

  entry.awaitingDecision = true
  entry.remoteFinalSeconds = remoteSeconds
  next.pending = next.pending.filter((write) => write.entryId !== entryId)
  return next
}

/** Every entry waiting for that answer, so a front end can ask. */
export function awaitingDecision(state: State, scope?: Scope): TimeEntry[] {
  return state.entries.filter(
    (entry) =>
      entry.awaitingDecision === true &&
      (scope === undefined || (entry.scope.repoPath === scope.repoPath && entry.scope.branch === scope.branch)),
  )
}

/**
 * The answer "begin a new entry": what ProSonata never saw stays here and
 * becomes an entry of its own with the next write. The old `timeID` is let go.
 */
export function resumeAsNew(state: State, entryId: string): State {
  return detach(state, entryId, (entry) => unwrittenSeconds(entry))
}

/**
 * The answer "add it to the closed entry", after that write has gone out. Since
 * everything measured has now reached ProSonata, this entry starts at zero —
 * and at the next write it becomes a new one, because the old is finished.
 */
export function resumeAfterAdding(state: State, entryId: string): State {
  return detach(state, entryId, () => 0)
}

function detach(state: State, entryId: string, secondsOf: (entry: TimeEntry) => number): State {
  const next = structuredClone(state)
  const entry = findEntry(next, entryId)
  if (!entry?.awaitingDecision) return state

  entry.seconds = secondsOf(entry)
  entry.foreignSeconds = 0
  entry.timeId = null
  entry.lastWritten = null
  delete entry.awaitingDecision
  delete entry.remoteFinalSeconds
  return next
}

/**
 * Changes the text of an entry that is still open (KONZEPT.md §8). A typo in a
 * trailer would otherwise only be correctable by another commit.
 *
 * An entry ProSonata already knows is queued for a write; one it does not know
 * travels with the next commit anyway, and queueing it here would create it
 * there ahead of any measured time.
 */
export function setText(state: State, entryId: string, text: string, at: number): State {
  const next = structuredClone(state)
  const entry = findEntry(next, entryId)
  if (!entry || entry.state === 'closed' || entry.text === text) return state

  entry.text = text
  if (entry.timeId !== null) queueWrite(next, entry.id, at, false)
  return next
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

/**
 * Seconds the current segment has been running, zero while paused.
 *
 * The measure for "has this been forgotten": the entry's total says nothing
 * about it — a branch can hold twenty hours and still have started a minute
 * ago.
 */
export function runningSeconds(state: State, clock: Clock, scope: Scope): number {
  const timer = findTimer(state, scope)
  return isRunning(timer) ? elapsed(timer.startedAt, clock.now()) : 0
}

/**
 * Keeps part of the running segment and stops the timer (KONZEPT.md §3).
 *
 * A timer that ran overnight measured wall time, not work. The tool cannot know
 * how much of it counts — only the person who was there can — so this takes the
 * answer instead of guessing: `seconds` are booked, the rest is dropped, and
 * the timer stands still afterwards.
 */
export function keepFromRunning(state: State, clock: Clock, scope: Scope, seconds: number): State {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  if (!timer || timer.startedAt === null) return state

  const now = clock.now()
  const kept = Math.max(0, Math.min(seconds, elapsed(timer.startedAt, now)))
  if (kept > 0) bookSegment(next, timer.entryId, now - kept * 1000, now)
  timer.startedAt = null
  if (findEntry(next, timer.entryId)?.timeId !== null) queueWrite(next, timer.entryId, now, false)
  return next
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

/*
 * Project and category are frozen into an entry when it is created. Both are
 * settings of the repository, though, and both can be corrected afterwards —
 * so a correction has to reach the entries that are still under way, or it
 * would only apply to whatever is started next.
 *
 * What decides is the close, not whether ProSonata has seen the entry: an open
 * one is written from early on and keeps growing there, so being known is no
 * reason to leave it. Under way is therefore everything still open, plus a
 * closed entry whose closing write is still pending. Only once that write is
 * out is the entry finished — and possibly invoiced.
 *
 * Both functions work on one repository. The settings live in its `git config`,
 * so another clone booking to the same project keeps its own.
 */

function unfinishedIn(state: State, repoPath: string): TimeEntry[] {
  return state.entries.filter(
    (entry) =>
      entry.scope.repoPath === repoPath &&
      (entry.state !== 'closed' || state.pending.some((write) => write.entryId === entry.id)),
  )
}

/**
 * A newly chosen time category. Without it an entry begun with no category at
 * all would never be sent, because that write is held back (KONZEPT.md §6).
 */
export function applyCategory(state: State, repoPath: string, projectId: number, categoryId: number, at: number): State {
  if (categoryId <= 0) return state

  const next = structuredClone(state)
  let changed = false
  for (const entry of unfinishedIn(next, repoPath)) {
    if (entry.projectId !== projectId || entry.categoryId === categoryId) continue
    entry.categoryId = categoryId
    changed = true
    if (entry.timeId !== null) queueWrite(next, entry.id, at, false)
  }
  return changed ? next : state
}

/**
 * A corrected project (KONZEPT.md §6). It is a correction, not a switch: time
 * that is still running was measured for this work, not for the project that
 * was picked by mistake, so every unfinished entry of the repository moves —
 * not just the one of the current branch.
 *
 * The category moves with it where one is known, because it is remembered per
 * project and the one of the old project may not even exist for the new
 * customer. Without one the entry keeps what it has, and the caller asks.
 *
 * An entry ProSonata already knows is queued for a write, and that PUT carries
 * `projectID` — so it moves there instead of a second one appearing. Only an
 * already invoiced entry cannot follow: `writeEntry` then deliberately creates
 * a successor rather than changing an invoice.
 */
export function applyProject(state: State, repoPath: string, projectId: number, categoryId: number, at: number): State {
  const next = structuredClone(state)
  let changed = false
  for (const entry of unfinishedIn(next, repoPath)) {
    const category = categoryId > 0 ? categoryId : entry.categoryId
    if (entry.projectId === projectId && entry.categoryId === category) continue
    entry.projectId = projectId
    entry.categoryId = category
    changed = true
    if (entry.timeId !== null) queueWrite(next, entry.id, at, false)
  }
  return changed ? next : state
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
