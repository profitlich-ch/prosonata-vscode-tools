import { randomUUID } from 'node:crypto'

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

  const entry =
    openEntry(next, options.scope) ??
    createEntry(next, {
      ...options,
      ...(options.mode === 'branch-day' ? { day: dayOf(clock.now()) } : {}),
    })
  next.timers.push({
    id: options.newId(),
    origin: 'local',
    remoteTimerId: null,
    scope: options.scope,
    startedAt: clock.now(),
    entryId: entry.id,
  })
  /*
   * Starting is worth a write of its own — under the placeholder if there is no
   * text yet. Until the entry exists in ProSonata, a second machine cannot find
   * it and would open a second one for the same branch; and a lost `state.json`
   * would take the whole entry with it. Ten minutes later, not now: the delay
   * still keeps a rolled-back commit from ever arriving.
   */
  queueWrite(next, entry.id, clock.now(), false)
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
export function pause(state: State, clock: Clock, scope: Scope, newId: () => string = randomId): State {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  const startedAt = timer?.startedAt
  if (!timer || startedAt === null || startedAt === undefined) return state

  bookAcrossDays(next, timer, startedAt, clock.now(), newId)
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
    booked = bookAcrossDays(next, timer, timer.startedAt, options.at, options.newId).reduce(
      (sum, part) => sum + part.seconds,
      0,
    )
    entry = findEntry(next, timer.entryId) ?? entry
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

  /*
   * Nothing measured, and the entry holds nothing either — this commit has no
   * time to record. Closing it anyway would put a 0,00 h line on a customer's
   * invoice, and it would not stop at one: closing creates the successor that
   * the next commit finds, so every further commit adds another empty line.
   *
   * Asked of the entry, not of `hadTimer`: whoever measures, pauses and only
   * then commits has real seconds sitting in the entry, and this commit is what
   * closes them.
   *
   * Only in `commit` mode. On a branch an entry without time is on purpose —
   * the placeholder is what makes it findable from a second machine before the
   * first commit (KONZEPT.md §3).
   */
  if (options.mode === 'commit' && booked === 0 && entry.seconds === 0 && entry.foreignSeconds === 0) {
    return { state, booked: 0, closed: null, hadTimer }
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

/**
 * The open entries of one working directory, across all its branches — what a
 * panel may show beside the branch one is on.
 *
 * Filtered by path, not by repository identity: an entry carries `scope.repoPath`
 * and `key`, and `key` is a hash of root commit and branch name, so the
 * repository cannot be read back out of it. That matches the scope anyway, which
 * is working directory plus branch (KONZEPT.md §5) — two clones of one
 * repository are two workplaces.
 */
export function openEntriesIn(state: State, repoPath: string): TimeEntry[] {
  return state.entries.filter((entry) => entry.state === 'open' && entry.scope.repoPath === repoPath)
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
 * The entry a follow-up may be added to: the last one closed on this branch that
 * ProSonata knows. There is no closing time in the model — entries are appended
 * as they are created, so the last one in that order is the last one there was.
 */
export function lastClosedEntry(state: State, scope: Scope): TimeEntry | undefined {
  return [...state.entries]
    .reverse()
    .find((entry) => entry.state === 'closed' && entry.timeId !== null && sameScope(entry.scope, scope))
}

/**
 * Moves measured time from the open entry onto a closed one (KONZEPT.md §3).
 *
 * The work happened after the commit that closed it and belongs to it — a case
 * only a person can judge, which is why nothing here decides it. The closed
 * entry keeps its `timeId` and its text: what goes out is a `workingTime` alone.
 */
export function moveToClosed(state: State, openId: string, closedId: string, seconds: number): State {
  const next = structuredClone(state)
  const open = findEntry(next, openId)
  const closed = findEntry(next, closedId)
  if (!open || !closed || closed.timeId === null || seconds <= 0) return state

  open.seconds = Math.max(0, open.seconds - seconds)
  closed.seconds += seconds
  // What ProSonata holds after the write — the entry is finished, so this is
  // its final total, not a running one.
  closed.remoteFinalSeconds = (closed.remoteFinalSeconds ?? 0) + seconds
  closed.lastWritten = closed.seconds + closed.foreignSeconds
  return next
}

/**
 * Takes measured seconds off an entry because they went somewhere else. Used
 * when the target of a follow-up lives only in ProSonata, so there is nothing
 * local to credit.
 */
export function takeFromOpen(state: State, entryId: string, seconds: number): State {
  const next = structuredClone(state)
  const entry = findEntry(next, entryId)
  if (!entry || seconds <= 0) return state

  entry.seconds = Math.max(0, entry.seconds - seconds)
  return next
}

/**
 * Lets go of the ProSonata entry this one had — it was deleted over there. What
 * accrues from now on belongs to a new one, so every trace of the old must go:
 * a pending write would otherwise try to reach an entry that no longer exists.
 */
export function forgetRemote(state: State, entryId: string): State {
  const next = structuredClone(state)
  const entry = findEntry(next, entryId)
  if (!entry) return state

  entry.timeId = null
  entry.lastWritten = null
  entry.foreignSeconds = 0
  next.pending = next.pending.filter((write) => write.entryId !== entryId)
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
  // Never without a text. A closed entry is written straight away, and an empty
  // one would appear on the customer's project as a nameless line — while the
  // rule "no text, no write" would no longer catch it, because it only holds
  // back open entries.
  if (text.trim() === '') return state

  entry.text = text
  return closeEntry(next, entry, newId, at)
}

/**
 * Seconds the running timer has put into this entry so far — read, not booked
 * (KONZEPT.md §7).
 *
 * `startedAt` is the only record of the running stretch, and it moves only at a
 * real event: a pause, a commit, a sleep, a branch switch. A write to ProSonata
 * is not one. Booking there — as `settle` does — would advance `startedAt`
 * every thirty seconds, and everything that reads it as "since when" would go
 * blind: the long-run question, the discard, the marker for the other machine,
 * and the segment log, which records from `startedAt` at the next pause.
 *
 * So the send adds this on top of what is booked and stores nothing. That is
 * sound because the written value is an absolute sum: when the stretch is
 * booked for real later, the next sum comes to the same number.
 *
 * In the daily mode only the part inside the entry's day counts. Past midnight
 * the stretch belongs to the next day's entry, which the next event will open —
 * until then it must not swell yesterday's line.
 */
export function runningInto(state: State, entry: TimeEntry, now: number): number {
  const timer = state.timers.find((candidate) => candidate.entryId === entry.id && candidate.startedAt !== null)
  if (!timer || timer.startedAt === null) return 0

  let from = timer.startedAt
  let until = now
  if (entry.day !== undefined) {
    const dayStart = startOfDay(entry.day)
    from = Math.max(from, dayStart)
    until = Math.min(until, nextMidnight(dayStart))
  }
  return elapsed(from, until)
}

/** The first instant of `2026-08-30`, in local time. */
function startOfDay(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, date, 0, 0, 0, 0).getTime()
}

/**
 * Books the running segment without ending it.
 *
 * **Not for the send** — see `runningInto`. Used where a person acts on the
 * stretch as it stands, such as attaching it to the last closed entry.
 */
export function settle(state: State, clock: Clock, scope: Scope, newId: () => string = randomId): State {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  const startedAt = timer?.startedAt
  if (!timer || startedAt === null || startedAt === undefined) return state

  const now = clock.now()
  bookAcrossDays(next, timer, startedAt, now, newId)
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

/*
 * Winding the clock forward and back (KONZEPT.md §3).
 *
 * Two everyday mistakes, one in each direction: the timer kept running through
 * a phone call, or it was never started although the work happened. Both are
 * corrections a person makes from memory — "at 9:40 the phone rang" — so the
 * tool takes an answer instead of measuring something it cannot see.
 *
 * While a timer runs, the correction moves its **start**. It stays a
 * measurement, and the segment is written later anyway, then with the corrected
 * beginning — no separate line in the log, nothing to reconcile.
 */

export interface Shift {
  state: State
  /** What was really shifted; the limits below can cut a wish short. */
  seconds: number
}

/**
 * Moves the start of the running segment by `seconds`, positive meaning "I
 * started earlier, count more".
 *
 * Two limits, both of them about not inventing time: the start must not slide
 * before `floor` — the end of the previous segment, otherwise the same minutes
 * would be counted twice — and never into the future.
 */
export function shiftStart(state: State, clock: Clock, scope: Scope, seconds: number, floor: number): Shift {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  if (!timer?.startedAt) return { state, seconds: 0 }

  /*
   * Each limit guards its own direction, and neither may push the start the
   * other way: asking for more time must never take some away because the floor
   * happens to lie after the current start, and asking for less must never add.
   */
  const wanted = timer.startedAt - seconds * 1000
  const limited =
    seconds > 0
      ? Math.max(wanted, Math.min(floor, timer.startedAt))
      : Math.min(wanted, clock.now())
  if (limited === timer.startedAt) return { state, seconds: 0 }

  const shifted = Math.round((timer.startedAt - limited) / 1000)
  timer.startedAt = limited
  return { state: next, seconds: shifted }
}

/**
 * Adds or removes time while nothing is running — the timer was never started,
 * or time was booked that was not worked. An entry cannot fall below zero, so a
 * correction that would overshoot is cut to what is there.
 *
 * Unlike a shifted start this leaves no trace of its own in the state, which is
 * why the caller writes a line into the segment log: without it the day would
 * add up differently there than in ProSonata.
 */
export function bookCorrection(state: State, options: StartOptions, seconds: number): Shift {
  const next = structuredClone(state)
  const entry = openEntry(next, options.scope) ?? createEntry(next, options)
  if (entry.awaitingDecision) return { state, seconds: 0 }

  const applied = Math.max(seconds, -entry.seconds)
  if (applied === 0) return { state, seconds: 0 }

  entry.seconds += applied
  return { state: next, seconds: applied }
}

/**
 * Ends the running segment at a moment that has passed and stops the timer —
 * "at 9:40 the phone rang and I never came back".
 *
 * Unlike a shifted start this keeps the clock times true: the segment really
 * ran from its beginning until then, and that is what the log will say.
 */
export function pauseAt(state: State, clock: Clock, scope: Scope, at: number): Shift {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  if (!timer?.startedAt) return { state, seconds: 0 }

  const until = Math.min(Math.max(at, timer.startedAt), clock.now())
  const dropped = Math.round((clock.now() - until) / 1000)

  bookSegment(next, timer.entryId, timer.startedAt, until)
  timer.startedAt = null
  if (findEntry(next, timer.entryId)?.timeId !== null) queueWrite(next, timer.entryId, clock.now(), false)
  return { state: next, seconds: -dropped }
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
  /*
   * The kept part is the **beginning** of the stretch, not its end. The question
   * is asked of a timer that ran overnight: the work was done, then the stopping
   * was forgotten. "Two hours count" means the first two — and the clock times
   * the log and the span are built from should say so.
   */
  if (kept > 0) bookSegment(next, timer.entryId, timer.startedAt, timer.startedAt + kept * 1000)
  timer.startedAt = null
  if (findEntry(next, timer.entryId)?.timeId !== null) queueWrite(next, timer.entryId, now, false)
  return next
}

/**
 * Cuts a stretch out of the running segment in which the machine was asleep
 * (KONZEPT.md §3).
 *
 * Unlike `keepFromRunning`, the amount is not guessed and not asked for: the
 * window is measured, and the timer keeps running afterwards. What was worked
 * before falling asleep is booked, the gap is dropped, and the segment starts
 * again at the moment of waking — the person is back and at it.
 *
 * The gap is left as a hole in the segment log rather than written down as a
 * segment of its own: nothing happened in it, and the archive records what was
 * measured, not what was not.
 */
export function skipGap(state: State, scope: Scope, from: number, until: number): State {
  const next = structuredClone(state)
  const timer = findTimerIn(next, scope)
  if (!timer || timer.startedAt === null) return state

  // A gap that lies entirely before the segment began takes nothing away — the
  // timer was started after waking, and the sleep is none of its business.
  if (until <= timer.startedAt) return state

  const worked = Math.max(timer.startedAt, Math.min(from, until))
  bookSegment(next, timer.entryId, timer.startedAt, worked)
  timer.startedAt = until
  return next
}

/**
 * A span cut at every midnight it crosses (KONZEPT.md §3).
 *
 * The day is **half-open**: a stretch ending at midnight belongs to the day that
 * is ending, one beginning there to the day that starts. So a span from 0:00 to
 * 0:00 cannot arise, and no second falls into two days.
 *
 * Needed in every mode, not only the daily one. The segment log groups by the
 * **end** of a segment, so an unsplit 22:00–02:00 lands wholly on the second day
 * and the first loses its two hours — the log would answer the one question it
 * exists for wrongly.
 */
export function daySpans(from: number, until: number): { from: number; until: number }[] {
  if (until <= from) return []

  const spans: { from: number; until: number }[] = []
  let start = from
  while (true) {
    const midnight = nextMidnight(start)
    if (midnight >= until) {
      spans.push({ from: start, until })
      return spans
    }
    spans.push({ from: start, until: midnight })
    start = midnight
  }
}

/** The first instant of the day after the one `at` falls on, in local time. */
export function nextMidnight(at: number): number {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() + 1)
  return day.getTime()
}

/** `2026-08-30` for the local day a moment falls on. */
export function dayOf(at: number): string {
  const day = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/** For the callers that do not bring their own; a roll-over needs a fresh id. */
const randomId = (): string => randomUUID()

/** Narrows to a timer whose segment is running, so `startedAt` is a number. */
function isRunning(timer: Timer | undefined): timer is Timer & { startedAt: number } {
  return timer !== undefined && timer.startedAt !== null
}

function createEntry(
  state: State,
  options: Pick<StartOptions, 'scope' | 'key' | 'projectId' | 'categoryId' | 'newId'> & {
    text?: string
    day?: string
  },
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
    ...(options.day === undefined ? {} : { day: options.day }),
  }
  state.entries.push(entry)
  return entry
}

/**
 * Books a stretch, cut at every midnight it crosses (KONZEPT.md §3).
 *
 * In the daily mode each day gets an entry of its own: the one that is full is
 * closed, and the timer runs on into a successor that inherits the text — the
 * work is the same, only the day is new. In the other two modes the halves land
 * in the same entry, and the cut shows only in the segment log.
 *
 * Returns what was booked, and per day, so the log can write one row per day
 * rather than one that straddles them.
 */
export function bookAcrossDays(
  state: State,
  timer: Timer,
  from: number,
  until: number,
  newId: () => string,
): { from: number; until: number; entryId: string; seconds: number }[] {
  const booked: { from: number; until: number; entryId: string; seconds: number }[] = []

  for (const span of daySpans(from, until)) {
    const entry = findEntry(state, timer.entryId)
    const day = dayOf(span.from)

    /*
     * The entry carries its day, and only entries made in the daily mode do —
     * so the field is the mark, and nothing here needs to be told the mode. That
     * also keeps the send path free of a `git` call: it walks timers from several
     * repositories, whose modes the open window knows nothing about.
     */
    if (entry?.day !== undefined && entry.day !== day) {
      closeEntry(state, entry, newId, span.from, day)
    }

    const seconds = bookSegment(state, timer.entryId, span.from, span.until)
    if (seconds > 0) booked.push({ ...span, entryId: timer.entryId, seconds })
  }
  return booked
}

function closeEntry(
  state: State,
  entry: TimeEntry,
  newId: () => string,
  at = Date.now(),
  /**
   * Set when a day rolls over: the successor takes the new day and **keeps the
   * text**, because it is the same work — only the day is new. Left out, the
   * successor starts blank, as after a commit on the main branch, where the next
   * commit brings its own text.
   */
  nextDay?: string,
): State {
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
      ...(nextDay === undefined ? {} : { day: nextDay, text: entry.text }),
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

/**
 * Marks an entry for the next write from outside these rules — after a
 * correction, where the sum changed without a segment ending.
 */
export function queueWriteFor(state: State, entryId: string, at: number): State {
  const next = structuredClone(state)
  queueWrite(next, entryId, at, false)
  return next
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
