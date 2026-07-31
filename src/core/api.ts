import { searchTerm } from './marker.js'
import { parseWorkingTime } from './working-time.js'

/**
 * The ProSonata API (KONZEPT.md §9). Everything measured against a live account
 * is honoured here:
 *
 *   Responses are wrapped in `{ meta, data }`; errors carry `meta.message`.
 *   `workingTime` is a string when read and a number when written, `timeID` the
 *   other way round — so nothing relies on either type.
 *   The `detail` filter matches substrings, which is what makes finding an open
 *   entry of a branch a single call.
 *   `detail` is truncated silently, so length is checked before sending.
 */

export interface Project {
  projectID: number
  projectName: string
  projectNo: string
  customerID: number
  customerName: string
  projectStatus: number
  activeStatus: number
  isProjectTemplate: number
  timeNeeded: number
  timePlanned: number
}

export interface Category {
  category: number
  categoryName: string
  categoryOrder: number
  active: number
  linkedCustomerID: number | null
  groupName: string | null
}

export interface RemoteEntry {
  timeID: number
  projectID: number
  category: number
  date: string
  detail: string
  /** Hours, already normalised from whichever type the API used. */
  hours: number
  isInvoiced: boolean
  notInvoiceable: boolean
}

export interface EntryDraft {
  projectID: number
  category: number
  date: string
  detail: string
  /** Decimal hours with a dot, as `workingTime()` produces it. */
  workingTime: string
}

/** How much of the rate limit is left, from every response (KONZEPT.md §9). */
export interface RateLimit {
  remaining: number
  resetSeconds: number
}

export interface Api {
  listProjects(): Promise<Project[]>
  listCategories(): Promise<Category[]>
  getEntry(timeId: number): Promise<RemoteEntry | null>
  /** Open entries of a project whose `detail` contains the branch key. */
  findByKey(projectId: number, key: string, markerWord: string): Promise<RemoteEntry[]>
  createEntry(draft: EntryDraft): Promise<RemoteEntry>
  updateEntry(timeId: number, patch: Partial<EntryDraft>): Promise<RemoteEntry>
  deleteEntry(timeId: number): Promise<void>
  /** Of the last response, if there was one. */
  rateLimit(): RateLimit | null
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Worth trying again later: rate limit, or the server having a bad moment. */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0
  }
}

export interface HttpApiOptions {
  baseUrl: string
  apiKey: string
  appId?: string
  fetch?: typeof globalThis.fetch
}

export class HttpApi implements Api {
  private readonly doFetch: typeof globalThis.fetch
  private limit: RateLimit | null = null

  constructor(private readonly options: HttpApiOptions) {
    this.doFetch = options.fetch ?? globalThis.fetch
  }

  rateLimit(): RateLimit | null {
    return this.limit
  }

  async listProjects(): Promise<Project[]> {
    // Only open, active projects — otherwise years of finished ones pile up.
    const rows = await this.request<Record<string, unknown>[]>(
      'GET',
      '/projects?projectStatus=0&activeStatus=1&perPage=500&orderBy=projectName',
    )
    return rows.filter((row) => Number(row['isProjectTemplate'] ?? 0) !== 1).map(toProject)
  }

  async listCategories(): Promise<Category[]> {
    const rows = await this.request<Record<string, unknown>[]>(
      'GET',
      '/projecttimecategories?active=1&perPage=500&orderBy=categoryOrder',
    )
    return rows.map(toCategory)
  }

  async getEntry(timeId: number): Promise<RemoteEntry | null> {
    try {
      return toEntry(await this.request<Record<string, unknown>>('GET', `/projecttimes/${timeId}`))
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }

  async findByKey(projectId: number, key: string, markerWord: string): Promise<RemoteEntry[]> {
    const term = encodeURIComponent(searchTerm(key, markerWord))
    const rows = await this.request<Record<string, unknown>[]>(
      'GET',
      `/projecttimes?projectID=${projectId}&isInvoiced=0&detail=${term}&perPage=100`,
    )
    return rows.map(toEntry)
  }

  async createEntry(draft: EntryDraft): Promise<RemoteEntry> {
    return toEntry(await this.request<Record<string, unknown>>('POST', '/projecttimes', draft))
  }

  async updateEntry(timeId: number, patch: Partial<EntryDraft>): Promise<RemoteEntry> {
    return toEntry(await this.request<Record<string, unknown>>('PUT', `/projecttimes/${timeId}`, patch))
  }

  async deleteEntry(timeId: number): Promise<void> {
    try {
      await this.request<unknown>('DELETE', `/projecttimes/${timeId}`)
    } catch (error) {
      // Already gone is the outcome we wanted, so retries stay idempotent.
      if (error instanceof ApiError && error.status === 404) return
      throw error
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Without this the URL would be just the path, and fetch would fail with
    // "Failed to parse URL" — which says nothing about the actual problem.
    if (this.options.baseUrl === '') {
      throw new ApiError(0, 'no account configured yet — run "prosonata init"')
    }
    if (this.options.apiKey === '') {
      throw new ApiError(0, 'no API key configured yet — run "prosonata init"')
    }

    const headers: Record<string, string> = {
      'X-API-Key': this.options.apiKey,
      Accept: 'application/json',
    }
    if (this.options.appId) headers['X-APP-ID'] = this.options.appId
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await this.doFetch(`${this.options.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (cause) {
      throw new ApiError(0, `no connection to ProSonata: ${(cause as Error).message}`)
    }

    const text = await response.text()
    let envelope: { meta?: Record<string, unknown>; data?: unknown } = {}
    try {
      envelope = JSON.parse(text) as typeof envelope
    } catch {
      // An HTML body means we did not reach the API at all — a wrong base URL.
      throw new ApiError(
        response.status,
        response.ok ? 'ProSonata answered with something other than JSON' : `HTTP ${response.status}`,
      )
    }

    const meta = envelope.meta ?? {}
    if (typeof meta['apiLimitRemaining'] === 'number') {
      this.limit = {
        remaining: meta['apiLimitRemaining'],
        resetSeconds: Number(meta['apiLimitReset'] ?? 0),
      }
    }

    if (!response.ok) {
      const message = typeof meta['message'] === 'string' ? meta['message'] : `HTTP ${response.status}`
      throw new ApiError(response.status, message, this.limit?.resetSeconds)
    }

    return envelope.data as T
  }
}

function toProject(row: Record<string, unknown>): Project {
  return {
    projectID: Number(row['projectID']),
    projectName: String(row['projectName'] ?? ''),
    projectNo: String(row['projectNo'] ?? ''),
    customerID: Number(row['customerID'] ?? 0),
    customerName: String(row['customerName'] ?? ''),
    projectStatus: Number(row['projectStatus'] ?? 0),
    activeStatus: Number(row['activeStatus'] ?? 1),
    isProjectTemplate: Number(row['isProjectTemplate'] ?? 0),
    timeNeeded: parseWorkingTime(row['timeNeeded']),
    timePlanned: parseWorkingTime(row['timePlanned']),
  }
}

function toCategory(row: Record<string, unknown>): Category {
  const linked = row['linkedCustomerID']
  return {
    category: Number(row['category']),
    categoryName: String(row['categoryName'] ?? ''),
    categoryOrder: Number(row['categoryOrder'] ?? 0),
    active: Number(row['active'] ?? 1),
    linkedCustomerID: linked === null || linked === undefined || linked === '' ? null : Number(linked),
    groupName: row['groupName'] === null || row['groupName'] === undefined ? null : String(row['groupName']),
  }
}

function toEntry(row: Record<string, unknown>): RemoteEntry {
  return {
    // A string on POST, a number elsewhere — measured, see KONZEPT.md §9.
    timeID: Number(row['timeID']),
    projectID: Number(row['projectID']),
    category: Number(row['category']),
    date: String(row['date'] ?? ''),
    detail: String(row['detail'] ?? ''),
    hours: parseWorkingTime(row['workingTime']),
    isInvoiced: Number(row['isInvoiced'] ?? 0) === 1,
    notInvoiceable: Number(row['notInvoiceable'] ?? 0) === 1,
  }
}
