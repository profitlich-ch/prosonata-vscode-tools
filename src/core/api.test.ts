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

    await expect(api.listProjects()).rejects.toThrow(/API-Key/)
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

    await expect(api.findByKey(166, 'a3f9c1', 'LAUFEND')).resolves.toEqual([])
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
