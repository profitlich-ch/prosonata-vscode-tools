import { t } from './l10n.js'
import { parseWorkingTime } from './working-time.js'

/**
 * The ProSonata API (KONZEPT.md §9). Everything measured against a live account
 * is honoured here:
 *
 *   Responses are wrapped in `{ meta, data }`; errors carry `meta.message`.
 *   `workingTime` is a string when read and a number when written, `timeID` the
 *   other way round — so nothing relies on either type.
 *   The `detail` and `apiComments` filters match substrings, which is what makes
 *   finding the entries of a branch a single call.
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
  /** Id of the group. It carries ProSonata's own order of the groups. */
  group: number | null
  groupName: string | null
}

/**
 * The categories in ProSonata's own order, which is `categoryOrder` alone: it
 * runs across the whole list, not within a group, so the groups fall out of it
 * as contiguous blocks. Ordering by the group id instead was measurably wrong,
 * and ordering the group names alphabetically is a list nobody knows. `group`
 * only breaks a tie, so equal numbers cannot interleave two groups.
 */
export function inProsonataOrder(categories: Category[]): Category[] {
  return [...categories].sort(
    (a, b) => a.categoryOrder - b.categoryOrder || (a.group ?? Infinity) - (b.group ?? Infinity),
  )
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
  /**
   * `HH:MM:SS` or null. ProSonata only displays the pair; nothing is derived
   * from it there. We write the span of the day the entry was worked
   * (KONZEPT.md §2) — the running status lives in `apiComments`, not here.
   */
  workingTimeStart: string | null
  workingTimeEnd: string | null
  /**
   * Machine data, as a string exactly as it was written (api-comments.ts).
   * Null while nothing was ever written; an emptied field reads `""`.
   */
  apiComments: string | null
}

export interface EntryDraft {
  projectID: number
  category: number
  date: string
  detail: string
  /** Decimal hours with a dot, as `workingTime()` produces it. */
  workingTime: string
  /**
   * The span of the working day, `HH:MM` each, null to clear. Measured against
   * the account: the short form is accepted and stored as `HH:MM:SS`, null
   * really clears — but an empty string does not, it writes `01:00:00`.
   */
  workingTimeStart?: string | null
  workingTimeEnd?: string | null
  apiComments?: string
}

/**
 * A quotation, read only (KONZEPT.md §9, *`quotations`*). The field names are
 * ProSonata's, like those of `Project`, so a reader of the API docs finds them.
 */
export interface Quotation {
  quotationID: number
  quotationName: string
  quotationHeadline: string
  /** `YYYY-MM-DD` as ProSonata sends it. */
  quotationDate: string
  netValue: number
  grossValue: number
  /** ProSonata's code: 0 EUR, 1 CHF, 2 USD, 3 GBP, 4 CAD. */
  currency: number
  isDraft: boolean
  isSent: boolean
  sentDate: string | null
  /** Approved by the customer. */
  approved: boolean
  projectID: number
  projectNo: string
  projectName: string
  customerName: string
  quotationComments: string
  /** Only the single call carries them — measured: the list leaves them out. Null then. */
  positions: QuotationPosition[] | null
}

/**
 * Measured on quotation 27: a heading has no field of its own — it is a
 * position with quantity and price 0, its title in `detail`.
 */
export interface QuotationPosition {
  detailID: number
  position: string
  isActive: boolean
  /** Shown, but not in the total — measured: the net value leaves it out. */
  isOptional: boolean
  categoryName: string
  /** May contain HTML, as written in ProSonata's editor. */
  detail: string
  quantity: number
  unit: string
  /** Per unit, not the line total — measured. */
  netValue: number
  discountPercent: number
}

/**
 * A time entry of anybody on a project, read only — for comparing what was
 * offered with what was booked. Not a `RemoteEntry`: those are the user's own,
 * and everything that writes works on them alone (KONZEPT.md §3).
 */
export interface ProjectTime {
  timeID: number
  date: string
  /** Who booked it; the list carries it, a write's answer does not (KONZEPT.md §9). */
  username: string
  category: number
  categoryName: string
  hours: number
  detail: string
  isInvoiced: boolean
  notInvoiceable: boolean
}

/** How much of the rate limit is left, from every response (KONZEPT.md §9). */
export interface RateLimit {
  remaining: number
  resetSeconds: number
}

export interface Api {
  listProjects(): Promise<Project[]>
  /**
   * One project, whatever its status — or null when ProSonata no longer has it.
   * Measured: a deleted project answers 404 `Data not found.` and is missing
   * from the unfiltered list too, so null means deleted, not merely closed.
   */
  getProject(projectId: number): Promise<Project | null>
  listCategories(): Promise<Category[]>
  getEntry(timeId: number): Promise<RemoteEntry | null>
  /**
   * Not yet invoiced entries whose `apiComments` contain this text. Measured:
   * the filter matches substrings and combines with the others.
   */
  findByComments(projectId: number, term: string): Promise<RemoteEntry[]>
  /**
   * Not yet invoiced entries whose `detail` contains this text. Measured: the
   * filter matches substrings, so a fragment of an old marker finds its entries.
   */
  findByDetail(projectId: number, term: string): Promise<RemoteEntry[]>
  /**
   * Every entry of a project this user owns, newest first — invoiced ones
   * included, because a list that hides them would suggest they can be changed.
   *
   * One call, not one per entry: the list already carries `detail`, `hours` and
   * `isInvoiced` (KONZEPT.md §9), and the quota is 50 requests per quarter hour.
   */
  listEntries(projectId: number): Promise<RemoteEntry[]>
  createEntry(draft: EntryDraft): Promise<RemoteEntry>
  updateEntry(timeId: number, patch: Partial<EntryDraft>): Promise<RemoteEntry>
  deleteEntry(timeId: number): Promise<void>
  /** The quotations of a project, newest first, templates left out. One call. */
  listQuotations(projectId: number): Promise<Quotation[]>
  /** One quotation with its positions, or null when ProSonata has none by this id. */
  getQuotation(quotationId: number): Promise<Quotation | null>
  /**
   * Every entry on a project, of everybody the key may see, newest first.
   * ProSonata decides who that is: up to «Zeiterfasser 1» only one's own.
   */
  listProjectTimes(projectId: number): Promise<ProjectTime[]>
  /** Of the last response, if there was one. */
  rateLimit(): RateLimit | null
  /** The key's user group, from the last response that named it (KONZEPT.md §9). */
  userGroup(): string | null
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
    /** `POST /projecttimes` — so a journal line says which call was refused. */
    readonly call?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Worth trying again later: rate limit, or the server having a bad moment. */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0
  }

  /**
   * ProSonata refuses this write itself, and asking again will not change its
   * mind (KONZEPT.md §4). 401 and 403 are left out: they are about the key or
   * its rights, not about the entry, and stop every write alike.
   */
  get refusesEntry(): boolean {
    return this.status >= 400 && this.status < 500 && ![401, 403, 429].includes(this.status)
  }
}

export interface HttpApiOptions {
  baseUrl: string
  apiKey: string
  appId?: string
  fetch?: typeof globalThis.fetch
  /** How long a call may wait for its answer; 30 seconds when not given. */
  timeoutMs?: number
}

const TIMEOUT_MS = 30_000

export class HttpApi implements Api {
  private readonly doFetch: typeof globalThis.fetch
  private limit: RateLimit | null = null
  private group: string | null = null

  constructor(private readonly options: HttpApiOptions) {
    this.doFetch = options.fetch ?? globalThis.fetch
  }

  rateLimit(): RateLimit | null {
    return this.limit
  }

  userGroup(): string | null {
    return this.group
  }

  async listProjects(): Promise<Project[]> {
    // Only open, active projects — otherwise years of finished ones pile up.
    const rows = await this.request<Record<string, unknown>[]>(
      'GET',
      '/projects?projectStatus=0&activeStatus=1&perPage=500&orderBy=projectName',
    )
    return (rows ?? []).filter((row) => Number(row['isProjectTemplate'] ?? 0) !== 1).map(toProject)
  }

  async getProject(projectId: number): Promise<Project | null> {
    try {
      return toProject(await this.request<Record<string, unknown>>('GET', `/projects/${projectId}`))
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }

  async listCategories(): Promise<Category[]> {
    const rows = await this.request<Record<string, unknown>[]>(
      'GET',
      '/projecttimecategories?active=1&perPage=500&orderBy=categoryOrder',
    )
    return (rows ?? []).map(toCategory)
  }

  async getEntry(timeId: number): Promise<RemoteEntry | null> {
    try {
      return toEntry(await this.request<Record<string, unknown>>('GET', `/projecttimes/${timeId}`))
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }

  async findByComments(projectId: number, term: string): Promise<RemoteEntry[]> {
    return this.search(projectId, 'apiComments', term)
  }

  async findByDetail(projectId: number, term: string): Promise<RemoteEntry[]> {
    return this.search(projectId, 'detail', term)
  }

  /**
   * The caller's own entries only. `userID=myself` matters as much as the key:
   * the branch key is a hash of the repository's root commit and the branch
   * name, so every clone computes the same one, including the clone of a
   * colleague. Without the filter, two people on one branch would find each
   * other's entry and write into it — the hours of one landing in the time
   * sheet of the other (KONZEPT.md §3).
   */
  private async search(projectId: number, field: 'apiComments' | 'detail', term: string): Promise<RemoteEntry[]> {
    const rows = await this.request<Record<string, unknown>[]>(
      'GET',
      `/projecttimes?projectID=${projectId}&isInvoiced=0&userID=myself&${field}=${encodeURIComponent(term)}&perPage=100`,
    )
    return (rows ?? []).map(toEntry)
  }

  async listEntries(projectId: number): Promise<RemoteEntry[]> {
    const rows = await this.request<Record<string, unknown>[]>(
      'GET',
      `/projecttimes?projectID=${projectId}&userID=myself&perPage=1000`,
    )
    return (rows ?? []).map(toEntry).sort((a, b) => b.timeID - a.timeID)
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

  /*
   * By `projectID`, not `projectNo`: the id is what the repository always
   * stores, the number only once it was saved. `perPage` is left out — measured,
   * the resource ignores it and sends 100 a page; a project with more is not
   * expected.
   */
  async listQuotations(projectId: number): Promise<Quotation[]> {
    const rows = await this.request<Record<string, unknown>[]>(
      'GET',
      `/quotations?projectID=${projectId}&isQuotationTemplate=0&orderBy=quotationDate+DESC`,
    )
    return (rows ?? []).map(toQuotation)
  }

  async getQuotation(quotationId: number): Promise<Quotation | null> {
    try {
      return toQuotation(await this.request<Record<string, unknown>>('GET', `/quotations/${quotationId}`))
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }

  /*
   * Without `userID`: everybody's, as far as the key may see. Paged, because a
   * long project can hold more than the 1000 a page allows; a page that comes
   * back full is followed by the next. At most ten, so a server that ignored
   * `page` could not spend the quota of the time tracking (KONZEPT.md §9).
   */
  async listProjectTimes(projectId: number): Promise<ProjectTime[]> {
    const PER_PAGE = 1000
    const all: ProjectTime[] = []
    for (let page = 1; page <= 10; page++) {
      const rows = await this.request<Record<string, unknown>[]>(
        'GET',
        `/projecttimes?projectID=${projectId}&perPage=${PER_PAGE}&page=${page}`,
      )
      all.push(...(rows ?? []).map(toProjectTime))
      if ((rows ?? []).length < PER_PAGE) break
    }
    return all.sort((a, b) => b.date.localeCompare(a.date) || b.timeID - a.timeID)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Without this the URL would be just the path, and fetch would fail with
    // "Failed to parse URL" — which says nothing about the actual problem.
    if (this.options.baseUrl === '') {
      throw new ApiError(0, t('no account set up yet — run "prosonata init"'))
    }
    if (this.options.apiKey === '') {
      throw new ApiError(0, t('no API key stored yet — run "prosonata init"'))
    }

    const headers: Record<string, string> = {
      'X-API-Key': this.options.apiKey,
      Accept: 'application/json',
    }
    if (this.options.appId) headers['X-APP-ID'] = this.options.appId
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    // Without the query: it carries search terms, and the journal needs the call, not them.
    const call = `${method} ${path.split('?')[0]}`

    /*
     * A call that never answers holds up whoever waits for it — the table in
     * the editor refuses every further click until then. Every call gets a
     * limit except the create: aborted, it may still have been made over
     * there, and the next round would create it a second time (KONZEPT.md §7).
     * A PUT writes the absolute sum and a DELETE accepts "already gone", so
     * repeating either costs nothing.
     */
    const timeoutMs = this.options.timeoutMs ?? TIMEOUT_MS
    const signal = method === 'POST' ? undefined : AbortSignal.timeout(timeoutMs)
    const failed = (cause: unknown): ApiError =>
      (cause as Error).name === 'TimeoutError'
        ? new ApiError(0, t('ProSonata did not answer within {0} seconds', Math.round(timeoutMs / 1000)), undefined, call)
        : new ApiError(0, t('no connection to ProSonata: {0}', (cause as Error).message))

    let response: Response
    let text: string
    try {
      response = await this.doFetch(`${this.options.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      })
      // Inside the same guard: the limit covers the body, which can stall as well.
      text = await response.text()
    } catch (cause) {
      throw failed(cause)
    }

    /*
     * A search that finds nothing answers `204 No Content` with an empty body —
     * measured against the account, not documented. `JSON.parse('')` would turn
     * that into "answered with something other than JSON", so the everyday case
     * "this branch has no entry yet" would look like a broken API.
     */
    if (text.trim() === '') {
      if (!response.ok) throw new ApiError(response.status, `HTTP ${response.status}`, undefined, call)
      return undefined as T
    }

    let envelope: { meta?: Record<string, unknown>; data?: unknown } = {}
    try {
      envelope = JSON.parse(text) as typeof envelope
    } catch {
      // An HTML body means we did not reach the API at all — a wrong base URL.
      throw new ApiError(
        response.status,
        response.ok ? t('ProSonata answered with something other than JSON') : `HTTP ${response.status}`,
        undefined,
        call,
      )
    }

    const meta = envelope.meta ?? {}
    if (typeof meta['apiLimitRemaining'] === 'number') {
      this.limit = {
        remaining: meta['apiLimitRemaining'],
        resetSeconds: Number(meta['apiLimitReset'] ?? 0),
      }
    }
    // A personal key's answers name its group; an app integration's do not (KONZEPT.md §9).
    if (typeof meta['usergroupName'] === 'string' && meta['usergroupName'] !== '') this.group = meta['usergroupName']

    if (!response.ok) {
      const message = typeof meta['message'] === 'string' ? meta['message'] : `HTTP ${response.status}`
      throw new ApiError(response.status, message, this.limit?.resetSeconds, call)
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
    group: row['group'] === null || row['group'] === undefined || row['group'] === '' ? null : Number(row['group']),
    groupName: row['groupName'] === null || row['groupName'] === undefined ? null : String(row['groupName']),
  }
}

// Amounts come as strings ("20412.00"), `currency` and the flags as numbers —
// measured; `Number()` takes either.
function toQuotation(row: Record<string, unknown>): Quotation {
  const positions = row['positions']
  return {
    quotationID: Number(row['quotationID']),
    quotationName: text(row['quotationName']),
    quotationHeadline: text(row['quotationHeadline']),
    quotationDate: text(row['quotationDate']),
    netValue: Number(row['netValue'] ?? 0),
    grossValue: Number(row['grossValue'] ?? 0),
    currency: Number(row['currency'] ?? 0),
    isDraft: Number(row['isDraft'] ?? 0) === 1,
    isSent: Number(row['isSent'] ?? 0) === 1,
    sentDate: typeof row['sentDate'] === 'string' && row['sentDate'] !== '' ? row['sentDate'] : null,
    approved: Number(row['approved'] ?? 0) === 1,
    projectID: Number(row['projectID'] ?? 0),
    projectNo: text(row['projectNo']),
    projectName: text(row['projectName']),
    customerName: text(row['customerName']),
    quotationComments: text(row['quotationComments']),
    positions: Array.isArray(positions) ? positions.map((item) => toPosition(item as Record<string, unknown>)) : null,
  }
}

function toPosition(row: Record<string, unknown>): QuotationPosition {
  return {
    detailID: Number(row['detailID'] ?? 0),
    position: text(row['position']),
    isActive: Number(row['isActive'] ?? 1) === 1,
    isOptional: Number(row['isOptional'] ?? 0) === 1,
    categoryName: text(row['categoryName']),
    detail: text(row['detail']),
    quantity: Number(row['quantity'] ?? 0),
    unit: text(row['unit']),
    netValue: Number(row['netValue'] ?? 0),
    discountPercent: Number(row['discountPercent'] ?? 0),
  }
}

function toProjectTime(row: Record<string, unknown>): ProjectTime {
  return {
    timeID: Number(row['timeID']),
    date: text(row['date']),
    username: text(row['username']),
    category: Number(row['category'] ?? 0),
    categoryName: text(row['categoryName']),
    hours: parseWorkingTime(row['workingTime']),
    detail: text(row['detail']),
    isInvoiced: Number(row['isInvoiced'] ?? 0) === 1,
    notInvoiceable: Number(row['notInvoiceable'] ?? 0) === 1,
  }
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
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
    workingTimeStart: typeof row['workingTimeStart'] === 'string' ? row['workingTimeStart'] : null,
    workingTimeEnd: typeof row['workingTimeEnd'] === 'string' ? row['workingTimeEnd'] : null,
    notInvoiceable: Number(row['notInvoiceable'] ?? 0) === 1,
    apiComments: typeof row['apiComments'] === 'string' ? row['apiComments'] : null,
  }
}
