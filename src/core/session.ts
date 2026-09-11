import { randomUUID } from 'node:crypto'

import { HttpApi, type Api, type RemoteEntry } from './api.js'
import { localDate, systemClock, type Clock } from './clock.js'
import { paths, readConfig, type Config } from './config.js'
import { describeRepo, mainBranch, type GitRepo } from './git.js'
import { Journal } from './journal.js'
import { branchKey, identityTerm, isMarkedOpen } from './marker.js'
import { measuredPerEntry, type MergePlan } from './merge.js'
import { modeFor, readRepoConfig, type RepoConfig } from './repo-config.js'
import { billedTime } from './report.js'
import { applySend, describeTrouble, send, type SendResult } from './sender.js'
import { planAdjustment, type Adjustment, type Plan, type Situation } from './adjust.js'
import type { AttachPlan, Attachment } from './attach.js'
import { SegmentLog, atLocal, type Segment } from './segments.js'
import { StateStore } from './state-store.js'
import { sync } from './sync.js'
import {
  bookCorrection,
  close,
  commit,
  forgetRemote,
  currentSeconds,
  findEntry,
  keepFromRunning,
  lastClosedEntry,
  moveToClosed,
  openEntry,
  pause,
  pauseAt,
  queueWriteFor,
  resumeAfterAdding,
  resumeAsNew,
  daySpans,
  dayOf,
  nextMidnight,
  sameScope,
  settle,
  shiftStart,
  skipGap,
  start,
  takeFromOpen,
  unwrittenSeconds,
} from './tracking.js'
import type { EntryMode, Scope, State, TimeEntry } from './types.js'
import { workingTime, type TimeGrid } from './working-time.js'

/**
 * How long a claim on creating an entry holds before another actor may take it
 * over. Long enough for a slow round-trip, short enough that a process which
 * died mid-write costs one entry a round or two — not a stuck file.
 */
const CREATE_LEASE_MS = 60_000

/**
 * Wires the pieces together for the two front ends, the CLI and the extension.
 * `core` still knows nothing about VS Code — this is plain Node.
 */

export interface RepoContext {
  repo: GitRepo
  scope: Scope
  key: string
  mainBranch: string
  mode: EntryMode
  config: RepoConfig
  projectId: number
  categoryId: number
}

export class NotConfigured extends Error {
  constructor(readonly repoPath: string) {
    super(`diesem Repository ist noch kein Projekt zugeordnet — führe "prosonata init" in ${repoPath} aus`)
    this.name = 'NotConfigured'
  }
}

export class Session {
  readonly store: StateStore
  readonly journal: Journal
  readonly segments: SegmentLog
  readonly clock: Clock
  private cachedApi: Api | null = null

  constructor(
    readonly config: Config,
    options: { clock?: Clock; api?: Api; store?: StateStore; journal?: Journal; segments?: SegmentLog } = {},
  ) {
    this.clock = options.clock ?? systemClock
    this.store = options.store ?? new StateStore(paths.state())
    this.journal = options.journal ?? new Journal(paths.journal())
    this.segments = options.segments ?? new SegmentLog(paths.segments())
    this.cachedApi = options.api ?? null
  }

  static open(options: { clock?: Clock; api?: Api } = {}): Session {
    return new Session(readConfig(), options)
  }

  get api(): Api {
    this.cachedApi ??= new HttpApi(
      this.config.appId === undefined
        ? { baseUrl: this.config.baseUrl, apiKey: this.config.apiKey }
        : { baseUrl: this.config.baseUrl, apiKey: this.config.apiKey, appId: this.config.appId },
    )
    return this.cachedApi
  }

  /** Everything about the repository at `cwd`, or null if it is not one. */
  context(cwd: string): RepoContext | null {
    const repo = describeRepo(cwd)
    if (!repo) return null

    const config = readRepoConfig(repo.root)
    const main = mainBranch(repo.root)
    const key = branchKey(repo.rootCommit, repo.branch)
    const projectId = config.activeProjectId
    if (projectId === null) throw new NotConfigured(repo.root)

    return {
      repo,
      scope: { repoPath: repo.root, branch: repo.branch },
      key,
      mainBranch: main,
      mode: modeFor(config, repo.branch, main, key),
      config,
      projectId,
      categoryId: config.categories.get(projectId) ?? 0,
    }
  }

  state(): State {
    const { state, recovery } = this.store.read()
    if (recovery) {
      this.journal.append({
        kind: 'note',
        entryId: '-',
        message: `state.json was ${recovery.reason}, moved to ${recovery.quarantinedAt}`,
      })
    }
    return state
  }

  /**
   * A branch switch in the terminal, with no VS Code window open, is noticed by
   * nobody while it happens — a `post-checkout` hook is deliberately rejected
   * (KONZEPT.md §5). It surfaces here, at the next write access, in retrospect
   * and without a known moment.
   *
   * The whole elapsed time therefore goes to the scope it was started in, and
   * the timer is paused. Asking is left to the next window.
   */
  reconcileBranchSwitch(context: RepoContext): string | null {
    let switched: string | null = null
    this.store.update((state) => {
      switched = null
      const stray = state.timers.find(
        (timer) =>
          timer.startedAt !== null &&
          timer.scope.repoPath === context.scope.repoPath &&
          timer.scope.branch !== context.scope.branch,
      )
      if (!stray) return state

      switched = stray.scope.branch
      return pause(state, this.clock, stray.scope)
    })
    return switched
  }

  /**
   * Whether this branch is one the tool has never measured.
   *
   * Neither an entry nor a single segment line — then arriving at it is the
   * moment somebody starts working on something new, and the only moment at
   * which a question about the timer is worth asking (KONZEPT.md §3).
   */
  neverMeasured(context: RepoContext): boolean {
    const known = this.state().entries.some(
      (entry) => entry.scope.repoPath === context.scope.repoPath && entry.scope.branch === context.scope.branch,
    )
    if (known) return false

    return !this.segments
      .read()
      .some(
        (segment) =>
          segment.repoPath === context.scope.repoPath && segment.branch === context.scope.branch,
      )
  }

  /**
   * Starts the timer. Arriving at a branch with no entry of its own is exactly
   * the moment to look whether ProSonata already holds one — from the other
   * machine, or from a state file that was lost (KONZEPT.md §3).
   *
   * The lookup must never keep the timer from starting: measuring works without
   * a network, sending does not. A failure is therefore noted and swallowed.
   */
  async start(context: RepoContext): Promise<State> {
    this.reconcileBranchSwitch(context)
    if (!openEntry(this.state(), context.scope)) await this.syncQuietly(context)

    return this.store.update((state) =>
      start(state, this.clock, {
        scope: context.scope,
        key: context.key,
        projectId: context.projectId,
        categoryId: context.categoryId,
        mode: context.mode,
        newId: randomUUID,
      }),
    )
  }

  /** The lookup where a failure is not worth interrupting anyone over. */
  async syncQuietly(context: RepoContext): Promise<void> {
    try {
      await this.sync(context)
    } catch (error) {
      this.journal.append({ kind: 'note', entryId: '-', message: `Abgleich nicht möglich: ${(error as Error).message}` })
    }
  }

  pause(context: RepoContext): State {
    const startedAt = this.runningSince(context)
    const state = this.store.update((current) => pause(current, this.clock, context.scope, randomUUID))
    if (startedAt !== null) this.recordSegmentAt(context, startedAt, this.clock.now(), 'pause')
    return state
  }

  /**
   * Keeps part of a segment that ran too long and stops the timer. The log gets
   * the shortened span and how long it really ran — the one place where measured
   * time disappears on purpose, so it must not disappear silently as well.
   */
  keepFromRunning(context: RepoContext, seconds: number): State {
    const startedAt = this.runningSince(context)
    if (startedAt === null) return this.state()

    const now = this.clock.now()
    const state = this.store.update((current) => keepFromRunning(current, this.clock, context.scope, seconds))
    const kept = Math.min(seconds, Math.max(0, Math.floor((now - startedAt) / 1000)))
    this.recordSegmentAt(context, startedAt, startedAt + kept * 1000, 'trimmed', Math.floor((now - startedAt) / 1000))
    return state
  }

  /**
   * Winds the clock forward or back by `seconds`, positive meaning "count more"
   * (KONZEPT.md §3).
   *
   * While a timer runs its start moves — the measurement stays a measurement,
   * and the segment reaches the log later with the corrected beginning. While
   * nothing runs the entry is changed directly, and that needs a line of its
   * own in the log; otherwise a day would add up differently there than in
   * ProSonata.
   *
   * Returns what was really applied: the limits below can cut a wish short.
   */
  adjust(context: RepoContext, adjustment: Adjustment): Plan {
    const runningSince = this.runningSince(context)
    const plan = planAdjustment(adjustment, this.situation(context))
    if (plan.action === 'impossible') return plan
    if (plan.delta === 0 && plan.action !== 'stop') return plan

    if (plan.action === 'stop' && runningSince !== null) {
      const at = plan.at ?? this.clock.now()
      this.store.update((state) => pauseAt(state, this.clock, context.scope, at).state)
      // The true span, so the log does not claim work at the wrong hour.
      this.recordSegmentAt(context, runningSince, at, 'pause')
      return plan
    }

    if (plan.action === 'shift') {
      this.store.update((state) => shiftStart(state, this.clock, context.scope, plan.delta, this.lastSegmentEnd(context)).state)
      return plan
    }

    this.store.update((state) => bookCorrection(state, this.startOptionsFor(context), plan.delta).state)
    // Without a beginning: an amount booked after the fact is not a measurement,
    // and no clock times may be invented for it.
    this.recordCorrection(context, plan.delta)
    this.queueIfKnown(context)
    return plan
  }

  /**
   * Closes an entry with its final text and notes it in the log (KONZEPT.md §7).
   *
   * Both front ends go through here, so the note cannot be forgotten in one of
   * them. It is what makes the log readable: the segments above the line belong
   * to that entry, and the next one starts below it — without repeating the same
   * text on every row.
   */
  closeEntry(entryId: string, text: string): State {
    const state = this.store.update((current) => close(current, entryId, text, this.clock.now(), randomUUID))
    const entry = state.entries.find((candidate) => candidate.id === entryId)
    if (entry?.state === 'closed') this.recordEntryClosed(entry)
    return state
  }

  /**
   * The line that ends an entry in the log. It carries no time of its own —
   * that is already in the segments — but the total the entry was closed with,
   * the share from another machine included. That total is the invoice line.
   */
  private recordEntryClosed(entry: TimeEntry): void {
    this.segments.append({
      until: atLocal(this.clock.now()),
      seconds: 0,
      bookedSeconds: entry.foreignSeconds + entry.seconds,
      repoPath: entry.scope.repoPath,
      branch: entry.scope.branch,
      projectId: entry.projectId,
      entryId: entry.id,
      reason: 'entry',
    })
  }

  /** A correction carries only its amount and the moment it was entered. */
  private recordCorrection(context: RepoContext, seconds: number): void {
    const entry = openEntry(this.state(), context.scope)
    this.segments.append({
      until: atLocal(this.clock.now()),
      seconds,
      repoPath: context.scope.repoPath,
      branch: context.scope.branch,
      projectId: context.projectId,
      entryId: entry?.id ?? '-',
      reason: 'correction',
    })
  }

  /** A correction changes the sum without a segment ending; the write must follow. */
  private queueIfKnown(context: RepoContext): void {
    const entry = openEntry(this.state(), context.scope)
    if (entry && entry.timeId !== null) {
      this.store.update((state) => queueWriteFor(state, entry.id, this.clock.now()))
    }
  }

  /** What an adjustment would do, without doing it — for showing it first. */
  situation(context: RepoContext): Situation {
    return {
      now: this.clock.now(),
      runningSince: this.runningSince(context),
      lastSegmentEnd: this.lastSegmentEnd(context),
      booked: openEntry(this.state(), context.scope)?.seconds ?? 0,
    }
  }

  /**
   * The end of the last segment **measured** on this branch — the floor a
   * shifted start must not fall below, because the minutes before it are
   * already booked. Nothing measured yet means no floor.
   *
   * Corrections are left out on purpose: their `until` is the moment somebody
   * typed an amount, not the end of any work. Letting that count would block a
   * later segment from reaching back over a stretch nobody ever measured.
   */
  lastSegmentEnd(context: RepoContext): number {
    const ends = this.segments
      .read()
      .filter(
        (segment) =>
          segment.reason !== 'correction' &&
          segment.repoPath === context.scope.repoPath &&
          segment.branch === context.scope.branch,
      )
      .map((segment) => Date.parse(segment.until))
      .filter((value) => Number.isFinite(value))

    return ends.length === 0 ? 0 : Math.max(...ends)
  }

  private startOptionsFor(context: RepoContext) {
    return {
      scope: context.scope,
      key: context.key,
      projectId: context.projectId,
      categoryId: context.categoryId,
      mode: context.mode,
      newId: randomUUID,
    }
  }

  /** When the running segment of this scope began, or null while paused. */
  private runningSince(context: RepoContext): number | null {
    const timer = this.state().timers.find(
      (candidate) =>
        candidate.startedAt !== null &&
        candidate.scope.repoPath === context.scope.repoPath &&
        candidate.scope.branch === context.scope.branch,
    )
    return timer?.startedAt ?? null
  }

  private recordSegmentAt(
    context: RepoContext,
    from: number,
    until: number,
    reason: Segment['reason'],
    ranSeconds?: number,
    /**
     * The entry this time was booked into. Needed after a commit: it closed its
     * entry and opened the successor, so asking for the *open* one now would
     * hang the segment on the entry that comes after the work.
     */
    bookedInto?: string,
  ): void {
    const entry = bookedInto
      ? this.state().entries.find((candidate) => candidate.id === bookedInto)
      : openEntry(this.state(), context.scope) ?? this.state().entries.find((candidate) => candidate.key === context.key)

    /*
     * One row per calendar day. The log groups by the end of a segment, so a
     * stretch from 22:00 to 02:00 written as one row would land wholly on the
     * second day and the first would lose its hours — the archive would answer
     * the one question it exists for wrongly (KONZEPT.md §3).
     */
    const parts = daySpans(from, until)
    for (const part of parts.length > 0 ? parts : [{ from, until }]) {
      // In the daily mode the parts belong to different entries — the one whose
      // day the part falls on. Everywhere else there is only the one.
      const day = dayOf(part.from)
      const owner =
        this.state().entries.find((candidate) => candidate.day === day && sameScope(candidate.scope, context.scope)) ??
        entry
      this.segments.append({
        from: atLocal(part.from),
        until: atLocal(part.until),
        seconds: Math.max(0, Math.floor((part.until - part.from) / 1000)),
        repoPath: context.scope.repoPath,
        branch: context.scope.branch,
        projectId: context.projectId,
        entryId: owner?.id ?? '-',
        reason,
        ...(ranSeconds === undefined ? {} : { ranSeconds }),
      })
    }
  }

  /** Called by the hook after a commit. */
  commit(context: RepoContext, options: { text: string; fromTrailer: boolean; sha: string }): {
    state: State
    booked: number
    hadTimer: boolean
    closed: boolean
    branchSwitched: boolean
  } {
    let booked = 0
    let hadTimer = false
    let closed = false
    /** Where the time went — the entry that was closed, or the one still open. */
    let bookedInto: string | undefined

    const switched = this.reconcileBranchSwitch(context)
    const startedAt = this.runningSince(context)

    const state = this.store.update((current) => {
      const outcome = commit(current, {
        scope: context.scope,
        mode: context.mode,
        text: options.text,
        fromTrailer: options.fromTrailer,
        sha: options.sha,
        at: this.clock.now(),
        newId: randomUUID,
        projectId: context.projectId,
        categoryId: context.categoryId,
        key: context.key,
      })
      booked = outcome.booked
      hadTimer = outcome.hadTimer
      closed = outcome.closed !== null
      bookedInto = outcome.closed?.id ?? openEntry(outcome.state, context.scope)?.id

      if (outcome.closed) {
        this.journal.append({
          kind: 'commit',
          entryId: outcome.closed.id,
          key: context.key,
          projectId: context.projectId,
          categoryId: context.categoryId,
          seconds: outcome.closed.seconds,
          date: this.clock.today(),
          text: outcome.closed.text,
          sha: options.sha,
        })
      } else if (booked > 0) {
        const entry = openEntry(outcome.state, context.scope)
        if (entry) {
          this.journal.append({
            kind: 'segment',
            entryId: entry.id,
            key: context.key,
            projectId: context.projectId,
            categoryId: context.categoryId,
            seconds: entry.seconds,
            date: this.clock.today(),
            text: entry.text,
            sha: options.sha,
          })
        }
      }
      return outcome.state
    })

    if (startedAt !== null && booked > 0) {
      this.recordSegmentAt(context, startedAt, this.clock.now(), 'commit', undefined, bookedInto)
    }
    // On the main branch every commit closes an entry, so the log gets its
    // closing line here rather than only where somebody closes one by hand.
    const finished = state.entries.find((entry) => entry.id === bookedInto && entry.state === 'closed')
    if (finished) this.recordEntryClosed(finished)
    return { state, booked, hadTimer, closed, branchSwitched: switched !== null }
  }

  /**
   * The answer to "closed on another machine" (KONZEPT.md §3).
   *
   * `add` sends what is missing to the entry that was closed — as a `PUT` that
   * carries `workingTime` alone, so the final text stays exactly as it was left
   * and the marker does not come back. `fresh` writes nothing there at all.
   *
   * Either way this entry lets go of the old `timeID`: what accrues from now on
   * belongs to a new one, because the old is finished.
   */
  async resolveClosedElsewhere(entryId: string, answer: 'add' | 'fresh'): Promise<void> {
    const entry = this.state().entries.find((candidate) => candidate.id === entryId)
    if (!entry?.awaitingDecision) return

    if (answer === 'fresh' || entry.timeId === null) {
      this.store.update((state) => resumeAsNew(state, entryId))
      return
    }

    const total = (entry.remoteFinalSeconds ?? 0) + unwrittenSeconds(entry)
    await this.api.updateEntry(entry.timeId, { workingTime: workingTime(total, this.gridFor(entry.scope.repoPath)) })
    this.journal.append({ kind: 'sent', entryId, timeId: entry.timeId })
    this.store.update((state) => resumeAfterAdding(state, entryId))
  }

  /**
   * Adds what has been measured since the last commit to the entry that commit
   * closed (KONZEPT.md §3) — the follow-up that belongs to work already booked.
   *
   * `close()` promises that a closed `timeID` is never written again. That holds
   * for everything the tool does by itself; here a person says otherwise, once,
   * for one entry. What stays absolute is the refusal to touch an invoiced one.
   *
   * The current total comes from ProSonata, not from the local number: it may
   * have been corrected there by hand, and the write is a sum.
   */
  async attachToLastClosed(
    context: RepoContext,
    confirm: (plan: AttachPlan) => Promise<boolean>,
  ): Promise<Attachment> {
    // A running timer keeps running; its segment so far is booked, so nothing
    // measured is left out of the sum.
    this.store.update((state) => settle(state, this.clock, context.scope, randomUUID))

    const open = openEntry(this.state(), context.scope)
    const seconds = open ? unwrittenSeconds(open) : 0
    if (!open || seconds <= 0) return { kind: 'nothing' }
    /*
     * The open entry usually stands in ProSonata by now — since the placeholder,
     * a running timer is enough. Its husk is deleted after the move, which is
     * ours to do. A **foreign** share is not: deleting would destroy hours
     * measured on another machine, and nobody here knows what they were.
     */
    if (open.timeId !== null && open.foreignSeconds > 0) return { kind: 'known' }

    const local = lastClosedEntry(this.state(), context.scope)
    const timeId = local?.timeId ?? (await this.lastClosedInProsonata(context))
    if (timeId === null) return { kind: 'noTarget' }

    const remote = await this.api.getEntry(timeId)
    if (!remote) return { kind: 'gone' }
    if (remote.isInvoiced) return { kind: 'invoiced' }

    const held = Math.round(remote.hours * 3600)
    const grid = this.gridFor(context.scope.repoPath)
    // Shown as hours and minutes, sent as decimal hours: the two notations are
    // for different readers, and only one of them is a person.
    const plan: AttachPlan = {
      seconds,
      text: remote.detail,
      date: remote.date,
      before: billedTime(held, grid),
      after: billedTime(held + seconds, grid),
    }
    if (!(await confirm(plan))) return { kind: 'cancelled' }

    await this.api.updateEntry(timeId, { workingTime: workingTime(held + seconds, grid) })
    // The husk goes only after the time is safely on the other entry: an
    // interruption in between costs a deletion, never an hour.
    if (open.timeId !== null) await this.api.deleteEntry(open.timeId)

    this.journal.append({ kind: 'sent', entryId: local?.id ?? open.id, timeId })
    this.store.update((state) => {
      const moved = local ? moveToClosed(state, open.id, local.id, seconds) : takeFromOpen(state, open.id, seconds)
      return open.timeId === null ? moved : forgetRemote(moved, open.id)
    })
    return { kind: 'done', plan }
  }

  /**
   * The last entry of this branch that ProSonata holds as finished — found by
   * the key the marker keeps after a close (KONZEPT.md §3). Needed when the
   * local state knows none: after a lost `state.json`, or on a machine that has
   * never seen this branch.
   *
   * Finished means: the marker carries no word any more. The newest is the one
   * with the highest `timeID`, since ProSonata hands them out in order.
   */
  private async lastClosedInProsonata(context: RepoContext): Promise<number | null> {
    const found = await this.api.findByDetail(context.projectId, identityTerm(context.key))
    const closed = found.filter((entry) => !isMarkedOpen(entry.detail, this.config.markerWord))
    if (closed.length === 0) return null

    return closed.reduce((newest, entry) => (entry.timeID > newest ? entry.timeID : newest), 0)
  }

  /** Set by the last sync: somebody is measuring on this branch elsewhere. */
  runningElsewhereSince: number | null = null

  /** Looks for an entry of this branch in ProSonata and adopts it if there is one. */
  async sync(context: RepoContext): Promise<void> {
    const before = this.state()
    const outcome = await sync(before, this.api, this.config, {
      scope: context.scope,
      key: context.key,
      projectId: context.projectId,
      categoryId: context.categoryId,
      newId: randomUUID,
    })
    this.runningElsewhereSince = outcome.runningElsewhereSince
    if (outcome.adopted || outcome.closedElsewhere) {
      this.store.update(() => outcome.state)
    }
  }

  /**
   * The grid a repository rounds by: its own if it has one, otherwise the
   * default from `~/.prosonata/config.json`. The same chain the panel and the
   * log show — until now the write path was the one place that did not follow
   * it, so a repository could display a rounding that never happened.
   */
  gridFor = (repoPath: string): TimeGrid => readRepoConfig(repoPath).grid ?? this.config.grid


  /**
   * The span of the working day for an entry, from the segment log: earliest
   * beginning, latest end, plus the segment running right now — otherwise the
   * end would lag behind by however long the timer has been going.
   *
   * Null as soon as the two fall on different days. A span describes a day; a
   * `08:12–17:40` on an entry that grew over three weeks would claim an
   * attendance nobody had. Null clears the fields in ProSonata, so an entry
   * that grows past midnight loses its span again — which is correct.
   *
   * Corrections have no beginning and are therefore left out (KONZEPT.md §3).
   */
  spanFor = (entry: TimeEntry): { start: string; end: string } | null => {
    const stamps: number[] = []
    for (const segment of this.segments.read()) {
      if (segment.entryId !== entry.id || segment.from === undefined) continue
      stamps.push(Date.parse(segment.from), Date.parse(segment.until))
    }

    const running = this.state().timers.find((timer) => timer.entryId === entry.id && timer.startedAt !== null)
    if (running?.startedAt) stamps.push(running.startedAt, this.clock.now())

    const known = stamps.filter((value) => Number.isFinite(value))
    if (known.length === 0) return null

    const start = Math.min(...known)
    /*
     * A day worked through to the end has its last segment stop at `00:00:00` of
     * the next day — the half-open day (KONZEPT.md §3). Taken literally the span
     * would straddle two days and be dropped, and the daily mode would lose the
     * span exactly where it matters most.
     *
     * So the end is clamped to `23:59`, which is the latest the field can hold.
     * The cut itself stays on `00:00:00`, so no second is lost: what is a minute
     * short is the display, not the duration — and ProSonata only displays it.
     */
    const midnight = nextMidnight(start)
    const reached = Math.max(...known)
    const end = reached === midnight ? midnight - 60_000 : reached
    if (localDate(new Date(start)) !== localDate(new Date(end))) return null
    return { start: hourAndMinute(start), end: hourAndMinute(end) }
  }

  /**
   * Claims the right to create one entry in ProSonata, or refuses when another
   * actor holds a fresh claim (KONZEPT.md §7).
   *
   * The lease is short and expires on its own: a process that dies between the
   * claim and the answer must not block this entry for good. That is the same
   * objection §7 raises against a lock file — only here it costs one entry a
   * round, not everyone the whole file.
   */
  claimCreate = (entryId: string): (() => void) | null => {
    let claimed = false
    this.store.update((current) => {
      claimed = false
      const entry = findEntry(current, entryId)
      if (!entry) return current
      if ((entry.creating ?? 0) > this.clock.now() - CREATE_LEASE_MS) return current

      entry.creating = this.clock.now()
      claimed = true
      return current
    })
    if (!claimed) return null

    return () =>
      this.store.update((current) => {
        const entry = findEntry(current, entryId)
        if (entry) delete entry.creating
        return current
      })
  }

  /**
   * Why the queue is not moving, from the last send — or null while all is well.
   *
   * Kept in memory beside `runningElsewhereSince`, for the same reason: it is an
   * observation about the last round, not part of the state that three processes
   * share.
   */
  lastTrouble: string | null = null

  /**
   * Stretches in which this machine was asleep while a timer ran (KONZEPT.md §3).
   *
   * Measured, not guessed: a beat that should come every second and comes back
   * an hour later proves that nothing ran in between. Several may pile up — a lid
   * closed twice before anybody answered — so they are kept in order and applied
   * one after the other, with the waking hours between them left alone.
   *
   * In memory beside `lastTrouble`: an observation of this window, not state that
   * three processes share.
   */
  sleepGaps: { from: number; until: number }[] = []

  /**
   * The gaps still to be decided about.
   *
   * Another window may have answered already — for «subtract» the state shows
   * it, for «keep» nothing else would. `sleepDecidedUntil` carries both.
   */
  openSleepGaps(): { from: number; until: number }[] {
    const decided = this.state().sleepDecidedUntil ?? 0
    return this.sleepGaps.filter((gap) => gap.until > decided)
  }

  /** What the open gaps add up to, for the question that names a number. */
  sleptSeconds(): number {
    return this.openSleepGaps().reduce((sum, gap) => sum + Math.floor((gap.until - gap.from) / 1000), 0)
  }

  /** Records that everything up to the latest gap has been answered. */
  #recordDecision(gaps: { until: number }[]): void {
    if (gaps.length === 0) return

    const latest = Math.max(...gaps.map((gap) => gap.until))
    this.store.update((state) => ({
      ...state,
      sleepDecidedUntil: Math.max(state.sleepDecidedUntil ?? 0, latest),
    }))
  }

  /**
   * Takes the sleeping time out of every running segment and lets the timer run
   * on from the moment of waking — the person is back and at it.
   *
   * Each cut is written to the log with its cause. Time that disappears on
   * purpose must not disappear silently as well (KONZEPT.md §3); the gap itself
   * stays a hole between two rows, because nothing happened in it.
   *
   * @returns The seconds actually taken off — zero when another window was
   *   quicker, so the message can say what happened instead of what was planned.
   */
  skipSleep(): number {
    const gaps = [...this.openSleepGaps()].sort((a, b) => a.from - b.from)
    this.sleepGaps = []
    this.#recordDecision(gaps)
    let removed = 0

    for (const gap of gaps) {
      for (const timer of this.state().timers.filter((candidate) => candidate.startedAt !== null)) {
        const startedAt = timer.startedAt!
        if (gap.until <= startedAt) continue

        const worked = Math.max(startedAt, Math.min(gap.from, gap.until))
        const entry = findEntry(this.state(), timer.entryId)
        this.store.update((state) => skipGap(state, timer.scope, gap.from, gap.until))
        removed = Math.max(removed, Math.floor((gap.until - worked) / 1000))

        if (entry && worked > startedAt) {
          this.segments.append({
            from: atLocal(startedAt),
            until: atLocal(worked),
            seconds: Math.floor((worked - startedAt) / 1000),
            repoPath: timer.scope.repoPath,
            branch: timer.scope.branch,
            projectId: entry.projectId,
            entryId: entry.id,
            reason: 'asleep',
          })
        }
      }
    }
    return removed
  }

  /** Keeps it: the machine slept, the person did not (KONZEPT.md §3). */
  keepSleep(): void {
    this.#recordDecision(this.openSleepGaps())
    this.sleepGaps = []
  }

  /**
   * The project's entries as ProSonata holds them, plus what this machine
   * measured into each (KONZEPT.md §3).
   *
   * One call for the list — it already carries `detail`, `hours` and
   * `isInvoiced` (§9) — and the local join comes from the segment log, which
   * knows the entry a segment went into.
   */
  async browse(context: RepoContext): Promise<{ entries: RemoteEntry[]; measured: Map<number, number> }> {
    const entries = await this.api.listEntries(context.projectId)
    const timeIdOf = new Map<string, number>()
    for (const entry of this.state().entries) {
      if (entry.timeId !== null) timeIdOf.set(entry.id, entry.timeId)
    }
    const mine = this.segments.read().filter((segment) => segment.repoPath === context.scope.repoPath)
    return { entries, measured: measuredPerEntry(mine, timeIdOf) }
  }

  /**
   * Writes a merge: the sum and the text onto the entry that stays, then the
   * others away.
   *
   * In that order, and it is the same rule as everywhere else here: an
   * interruption in between leaves an entry too many, never an hour too few. A
   * leftover row is visible on the invoice; missing hours are visible nowhere.
   * What is still to be deleted goes into the journal first, so the next run can
   * finish what this one started.
   */
  async applyMerge(plan: MergePlan, seconds: number, text: string, grid: TimeGrid): Promise<void> {
    for (const entry of plan.drop) {
      this.journal.append({ kind: 'note', entryId: '-', message: `verdichtet: ${entry.timeID} wird gelöscht` })
    }

    await this.api.updateEntry(plan.keep.timeID, {
      workingTime: workingTime(seconds, grid),
      detail: text,
      date: plan.date,
    })

    for (const entry of plan.drop) {
      await this.api.deleteEntry(entry.timeID)
      this.journal.append({ kind: 'note', entryId: '-', message: `verdichtet: ${entry.timeID} gelöscht` })
    }
  }

  /**
   * Corrects the hours of an entry ProSonata already holds.
   *
   * This bends the promise that `close` makes — a closed `timeID` is never
   * written to again — the same way adding follow-up time does: a person
   * decides, once, for one entry. The segment log gets a correction row, so the
   * report and ProSonata do not drift apart (KONZEPT.md §3).
   */
  async correctHours(entry: RemoteEntry, seconds: number, grid: TimeGrid, context: RepoContext): Promise<void> {
    if (entry.isInvoiced) throw new Error('der Eintrag ist bereits fakturiert')

    await this.api.updateEntry(entry.timeID, { workingTime: workingTime(seconds, grid) })

    const before = Math.round(entry.hours * 3600)
    const local = this.state().entries.find((candidate) => candidate.timeId === entry.timeID)
    this.segments.append({
      until: atLocal(this.clock.now()),
      seconds: seconds - before,
      repoPath: context.scope.repoPath,
      branch: local?.scope.branch ?? context.scope.branch,
      projectId: context.projectId,
      entryId: local?.id ?? '-',
      reason: 'correction',
    })
  }

  /** Sends everything that is due (KONZEPT.md §4). */
  async flush(force = false): Promise<SendResult> {
    /*
     * Nothing is booked here. The send adds the running seconds on top of what
     * is booked and stores nothing — `runningInto` in tracking.ts says why:
     * booking on every beat moved `startedAt` every thirty seconds and blinded
     * everything that reads it as "since when", the segment log included.
     */
    const before = this.state()
    const { state: after, result } = await send(before, this, force)

    /*
     * Fold the outcome onto the state as it stands now, rather than replacing it
     * with the snapshot `send` worked on. Between the two lies an HTTP round-trip
     * in which the hook, the CLI or another window may have booked time or queued
     * a write — replacing would throw that away, and that is how queued writes
     * went missing (KONZEPT.md §7).
     */
    if (result.sent.length > 0 || result.awaitingDecision.length > 0) {
      this.store.update((current) => applySend(current, before, after, result))
    }
    this.lastTrouble = describeTrouble(result)
    return result
  }

  seconds(context: RepoContext): number {
    return currentSeconds(this.state(), this.clock, context.scope)
  }
}

function hourAndMinute(at: number): string {
  const time = new Date(at)
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}
