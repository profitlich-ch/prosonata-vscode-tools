/**
 * Domain types. See KONZEPT.md §2 for the distinction that carries everything:
 * a Segment is measurement and stays local, a TimeEntry is what ProSonata sees.
 */

/** Working directory plus branch — the scope of KONZEPT.md §5. */
export interface Scope {
  /** Absolute path of the working directory (worktrees have their own). */
  repoPath: string
  branch: string
}

/**
 * How entries are formed on a branch (KONZEPT.md §3).
 * On the main branch this is fixed to 'commit'.
 */
export type EntryMode = 'branch' | 'commit'

export type EntryState = 'open' | 'closed'

/** A `projecttimes` record in ProSonata. */
export interface TimeEntry {
  /** Local id. We never wait for a ProSonata id to exist. */
  id: string
  /**
   * Branch identity: hash of the repository's root commit and the branch name.
   * Travels in the marker so another machine can find this entry (KONZEPT.md §3).
   */
  key: string
  scope: Scope
  projectId: number
  categoryId: number
  /** Set only for entries on the main branch, where one commit is one entry. */
  sha?: string
  /** The text the customer reads on the invoice. Without the marker. */
  text: string
  /** Seconds measured on this machine. */
  seconds: number
  /** Seconds contributed by other machines, derived from the last read. */
  foreignSeconds: number
  /** Total last written to ProSonata; detects writes by other machines. */
  lastWritten: number | null
  /** ProSonata's `timeID`, null before the first POST. */
  timeId: number | null
  state: EntryState
  /**
   * Someone closed this entry on another machine while time was still running
   * here. Nothing is written until the question is answered — add the rest to
   * the closed entry, or begin a new one (KONZEPT.md §3).
   */
  awaitingDecision?: boolean
  /** What ProSonata holds for it, read at the moment the close was noticed. */
  remoteFinalSeconds?: number
}

/**
 * A running or paused timer. There is at most one per scope.
 *
 * Note: the running segment is `startedAt` alone. Finished segments are added
 * straight to the entry, so there is no second accumulator that could drift.
 */
export interface Timer {
  id: string
  /** Reserved for the Timer API. Constant 'local' today (KONZEPT.md §7). */
  origin: 'local' | 'remote'
  remoteTimerId: string | null
  scope: Scope
  /** Epoch milliseconds when the running segment began, null while paused. */
  startedAt: number | null
  /** The entry this timer's time flows into. */
  entryId: string
}

/** A write to ProSonata that is due but has not gone out yet (KONZEPT.md §4). */
export interface PendingWrite {
  entryId: string
  /** Epoch milliseconds the write became due; the delay is measured from here. */
  since: number
  /** Set once the entry was closed locally, so the final text goes out with it. */
  closing: boolean
}

export interface State {
  /** Bumped when the shape changes, so old states stay migratable. */
  formatVersion: number
  /** Compare-and-swap counter against lost updates (KONZEPT.md §7). */
  version: number
  timers: Timer[]
  entries: TimeEntry[]
  pending: PendingWrite[]
}

export const FORMAT_VERSION = 1

export function emptyState(): State {
  return { formatVersion: FORMAT_VERSION, version: 1, timers: [], entries: [], pending: [] }
}
