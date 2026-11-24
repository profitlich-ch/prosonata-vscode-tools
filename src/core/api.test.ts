import { describe, expect, it } from 'vitest'

import { ApiError, HttpApi, inProsonataOrder, type Category } from './api.js'

/**
 * The guards that turn a missing setup into a sentence someone can act on.
 * Without them the failure surfaces as "Failed to parse URL" from inside fetch,
 * which says nothing about the actual problem.
 */
describe('an unconfigured account', () => {
  it('says what is missing instead of failing inside fetch', async () => {
    const api = new HttpApi({ baseUrl: '', apiKey: 'k' })

    await expect(api.listProjects()).rejects.toThrow(/"prosonata init"/)
  })

  it('reports a missing key the same way', async () => {
    const api = new HttpApi({ baseUrl: 'https://x/api/v1', apiKey: '' })

    await expect(api.listProjects()).rejects.toThrow(/API key/)
  })

  it('never reaches the network', async () => {
    let called = false
    const api = new HttpApi({
      baseUrl: '',
      apiKey: '',
      fetch: async () => {
        called = true
        return new Response('{}')
      },
    })

    await expect(api.listProjects()).rejects.toBeInstanceOf(ApiError)
    expect(called).toBe(false)
  })
})

describe('a base URL that is not the API', () => {
  it('is recognised by the HTML answer, not treated as data', async () => {
    // What the demo host did: ProSonata's own 404 page instead of the JSON
    // envelope. A wrong base URL must not look like an empty result.
    const api = new HttpApi({
      baseUrl: 'https://www.example.invalid/api/v1',
      apiKey: 'k',
      fetch: async () => new Response('<!DOCTYPE html><html>…', { status: 404 }),
    })

    await expect(api.listProjects()).rejects.toThrow(/404/)
  })
})

describe('the order of the categories', () => {
  const category = (id: number, group: number | null, order: number): Category => ({
    category: id,
    categoryName: `K${id}`,
    categoryOrder: order,
    active: 1,
    linkedCustomerID: null,
    group,
    groupName: group === null ? null : `G${group}`,
  })

  // Measured: `categoryOrder` runs across the whole list, so the groups come out
  // in the order ProSonata shows them — the group id says nothing about that.
  it('follows categoryOrder across all groups', () => {
    const sorted = inProsonataOrder([category(1, 20, 3), category(2, 3, 1), category(3, 20, 2)])

    expect(sorted.map((entry) => entry.category)).toEqual([2, 3, 1])
  })

  it('keeps a group together when two entries share a number', () => {
    const sorted = inProsonataOrder([category(1, 20, 1), category(2, 3, 1), category(3, 20, 1)])

    expect(sorted.map((entry) => entry.group)).toEqual([3, 20, 20])
  })

  it('leaves the given array alone', () => {
    const given = [category(1, 9, 2), category(2, 1, 1)]
    inProsonataOrder(given)

    expect(given.map((entry) => entry.category)).toEqual([1, 2])
  })
})

/*
 * Measured against the account: a search that finds nothing answers 204 with an
 * empty body. `JSON.parse('')` would make the everyday case "this branch has no
 * entry yet" look like a broken API.
 */
describe('an empty answer', () => {
  // 204 must not carry a body at all — the Response constructor insists on it.
  const noContent = async () => new Response(null, { status: 204 })

  it('is an empty result, not a fault', async () => {
    const api = new HttpApi({ baseUrl: 'https://x/api/v1', apiKey: 'k', fetch: noContent })

    await expect(api.findByComments(166, '"key":"a3f9c1"')).resolves.toEqual([])
    await expect(api.findByDetail(166, 'a3f9c1]')).resolves.toEqual([])
    await expect(api.listProjects()).resolves.toEqual([])
    await expect(api.listCategories()).resolves.toEqual([])
  })

  it('stays a fault when the status says so', async () => {
    const api = new HttpApi({
      baseUrl: 'https://x/api/v1',
      apiKey: 'k',
      fetch: async () => new Response('', { status: 500 }),
    })

    await expect(api.listProjects()).rejects.toThrow(/500/)
  })
})

describe('quotations', () => {
  function answering(data: unknown, status = 200, seen: string[] = []): HttpApi {
    return new HttpApi({
      baseUrl: 'https://x/api/v1',
      apiKey: 'k',
      fetch: async (url) => {
        seen.push(String(url))
        return new Response(JSON.stringify({ meta: { status }, data }), { status })
      },
    })
  }

  it('asks for one project without templates, newest first, and without perPage', async () => {
    const seen: string[] = []

    await answering([], 200, seen).listQuotations(166)

    // Measured: the resource ignores perPage, so sending it would only suggest a limit.
    expect(seen).toEqual(['https://x/api/v1/quotations?projectID=166&isQuotationTemplate=0&orderBy=quotationDate+DESC'])
  })

  it('reads flags and amounts whatever type they come in, and keeps positions apart from the list', async () => {
    const [row] = await answering([
      { quotationID: '412', quotationName: 'Relaunch', netValue: '4250.00', currency: '1', isDraft: '1', approved: 0 },
    ]).listQuotations(166)

    expect(row).toMatchObject({ quotationID: 412, netValue: 4250, currency: 1, isDraft: true, approved: false, positions: null })
  })

  it('reads the positions of a single one', async () => {
    const found = await answering({
      quotationID: 412,
      positions: [{ detailID: 7, position: '1', isActive: '0', detail: '<p>x</p>', quantity: '8', netValue: '1200' }],
    }).getQuotation(412)

    expect(found?.positions).toEqual([
      { detailID: 7, position: '1', isActive: false, isOptional: false, categoryName: '', detail: '<p>x</p>', quantity: 8, unit: '', netValue: 1200, discountPercent: 0 },
    ])
  })

  it('answers null for a quotation ProSonata does not have', async () => {
    await expect(answering([], 404).getQuotation(9)).resolves.toBeNull()
  })
})

describe('everybody’s time on a project', () => {
  function paging(pages: unknown[][], seen: string[]): HttpApi {
    return new HttpApi({
      baseUrl: 'https://x/api/v1',
      apiKey: 'k',
      fetch: async (url) => {
        seen.push(String(url))
        const page = Number(new URL(String(url)).searchParams.get('page'))
        return new Response(JSON.stringify({ meta: { usergroupName: 'Teamleiter' }, data: pages[page - 1] ?? [] }))
      },
    })
  }

  it('asks without userID — unlike every call that leads to a write', async () => {
    const seen: string[] = []

    await paging([[]], seen).listProjectTimes(175)

    expect(seen).toEqual(['https://x/api/v1/projecttimes?projectID=175&perPage=1000&page=1'])
  })

  it('follows a full page with the next, and keeps who booked what', async () => {
    const seen: string[] = []
    const full = Array.from({ length: 1000 }, (_, i) => ({ timeID: i + 1, date: '2026-10-01', username: 'a', workingTime: '1.00' }))
    const api = paging([full, [{ timeID: 5000, date: '2026-11-01', username: 'b', categoryName: 'Beratung', workingTime: '0.50' }]], seen)

    const times = await api.listProjectTimes(175)

    expect(seen).toHaveLength(2)
    expect(times).toHaveLength(1001)
    expect(times[0]).toMatchObject({ timeID: 5000, username: 'b', categoryName: 'Beratung', hours: 0.5 })
  })

  it('stops after ten pages, so a server ignoring page cannot drain the quota', async () => {
    const seen: string[] = []
    const full = Array.from({ length: 1000 }, (_, i) => ({ timeID: i + 1, date: '2026-10-01' }))
    const api = new HttpApi({
      baseUrl: 'https://x/api/v1',
      apiKey: 'k',
      fetch: async (url) => {
        seen.push(String(url))
        return new Response(JSON.stringify({ meta: {}, data: full }))
      },
    })

    await api.listProjectTimes(175)

    expect(seen).toHaveLength(10)
  })

  it('learns the user group from the answer', async () => {
    const api = paging([[]], [])

    await api.listProjectTimes(175)

    expect(api.userGroup()).toBe('Teamleiter')
  })
})
