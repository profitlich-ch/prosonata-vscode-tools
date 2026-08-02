import { ApiError, type Api, type Category, type EntryDraft, type Project, type RateLimit, type RemoteEntry } from './api.js'
import { searchTerm } from './marker.js'
import { parseWorkingTime } from './working-time.js'

/**
 * An in-memory ProSonata for the tests (KONZEPT.md §9).
 *
 * It reproduces the behaviour that was measured against a live account, not the
 * behaviour the documentation promises — those differ in one important place:
 * `detail` is truncated silently instead of being rejected.
 */
export class FakeApi implements Api {
  readonly entries = new Map<number, RemoteEntry>()
  projects: Project[] = []
  categories: Category[] = []

  /** Set to make the next call fail, e.g. `new ApiError(429, 'slow down')`. */
  failNext: Error | null = null
  /** Characters `detail` keeps. Beyond it the rest is dropped without a word. */
  detailLimit = 800

  calls: string[] = []
  /** Entries of other users; `userID=myself` keeps them out of every search. */
  private readonly foreign = new Set<number>()
  private nextId = 2000
  private limit: RateLimit = { remaining: 50, resetSeconds: 900 }

  rateLimit(): RateLimit {
    return this.limit
  }

  async listProjects(): Promise<Project[]> {
    this.record('listProjects')
    return this.projects.filter((p) => p.projectStatus === 0 && p.activeStatus === 1 && p.isProjectTemplate !== 1)
  }

  async listCategories(): Promise<Category[]> {
    this.record('listCategories')
    return this.categories.filter((c) => c.active === 1)
  }

  async getEntry(timeId: number): Promise<RemoteEntry | null> {
    this.record(`getEntry ${timeId}`)
    return this.entries.get(timeId) ?? null
  }

  async findByKey(projectId: number, key: string, markerWord: string): Promise<RemoteEntry[]> {
    this.record(`findByKey ${projectId} ${key}`)
    const term = searchTerm(key, markerWord)
    // A substring match, as measured against the account — and `userID=myself`,
    // which is why entries of other people never show up here.
    return [...this.entries.values()].filter(
      (entry) =>
        entry.projectID === projectId && !entry.isInvoiced && entry.detail.includes(term) && !this.foreign.has(entry.timeID),
    )
  }

  /**
   * Marks an entry as belonging to somebody else — a colleague on the same
   * branch. Whose entry it is lives in ProSonata, not in `RemoteEntry`, so the
   * double keeps it: it is server behaviour, not a field we read.
   */
  belongsToSomebodyElse(timeId: number): void {
    this.foreign.add(timeId)
  }

  async createEntry(draft: EntryDraft): Promise<RemoteEntry> {
    this.record(`createEntry ${draft.workingTime}`)
    const entry: RemoteEntry = {
      timeID: this.nextId++,
      projectID: draft.projectID,
      category: draft.category,
      date: draft.date,
      detail: this.truncate(draft.detail),
      hours: parseWorkingTime(draft.workingTime),
      isInvoiced: false,
      workingTimeStart: normaliseStart(draft.workingTimeStart),
      workingTimeEnd: normaliseStart(draft.workingTimeEnd),
      notInvoiceable: false,
    }
    this.entries.set(entry.timeID, entry)
    return { ...entry }
  }

  async updateEntry(timeId: number, patch: Partial<EntryDraft>): Promise<RemoteEntry> {
    this.record(`updateEntry ${timeId} ${patch.workingTime ?? '-'}`)
    const entry = this.entries.get(timeId)
    if (!entry) throw new ApiError(404, 'Data not found.')

    // A partial body leaves everything else alone — measured.
    if (patch.detail !== undefined) entry.detail = this.truncate(patch.detail)
    if (patch.workingTime !== undefined) entry.hours = parseWorkingTime(patch.workingTime)
    if (patch.date !== undefined) entry.date = patch.date
    if (patch.projectID !== undefined) entry.projectID = patch.projectID
    if (patch.category !== undefined) entry.category = patch.category
    // Measured: null clears, an empty string writes 01:00:00 instead.
    if (patch.workingTimeStart !== undefined) entry.workingTimeStart = normaliseStart(patch.workingTimeStart)
    if (patch.workingTimeEnd !== undefined) entry.workingTimeEnd = normaliseStart(patch.workingTimeEnd)
    return { ...entry }
  }

  async deleteEntry(timeId: number): Promise<void> {
    this.record(`deleteEntry ${timeId}`)
    this.entries.delete(timeId)
  }

  private record(call: string): void {
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }
    this.calls.push(call)
    this.limit = { ...this.limit, remaining: Math.max(0, this.limit.remaining - 1) }
  }

  private truncate(detail: string): string {
    return detail.length > this.detailLimit ? detail.slice(0, this.detailLimit) : detail
  }
}

/** `09:12` becomes `09:12:00`, null clears, `''` writes an hour — as measured. */
function normaliseStart(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  if (value === '') return '01:00:00'
  return value.length === 5 ? `${value}:00` : value
}
