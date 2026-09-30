import { describe, expect, it } from 'vitest'

import { buildComments, EXTENSION_ID, keyTerm, readComments } from './api-comments.js'

const EIGHT_TWELVE = new Date(2026, 8, 30, 8, 12, 0).getTime()

describe('our part of apiComments', () => {
  it('is written in a fixed order, so the search term stays stable', () => {
    expect(buildComments(null, { key: 'a3f9c1', open: true, running: EIGHT_TWELVE })).toBe(
      `{"${EXTENSION_ID}":{"v":1,"key":"a3f9c1","open":true,"running":"2026-09-30T08:12"}}`,
    )
  })

  it('leaves out the running time while nothing runs', () => {
    expect(buildComments(null, { key: 'a3f9c1', open: false, running: null })).toBe(
      `{"${EXTENSION_ID}":{"v":1,"key":"a3f9c1","open":false}}`,
    )
  })

  it('is found by the search term', () => {
    expect(buildComments(null, { key: 'a3f9c1', open: true, running: null })).toContain(keyTerm('a3f9c1'))
    expect(keyTerm('a3f9c1')).toBe('"key":"a3f9c1"')
  })

  it('reads back what was written, with the running time to the minute', () => {
    const own = { key: 'a3f9c1', open: true, running: EIGHT_TWELVE }
    expect(readComments(buildComments(null, own))).toEqual(own)
  })

  it('replaces only itself and keeps what another integration wrote', () => {
    const existing = JSON.stringify({ 'jemand.anderes': { ticket: 42 }, [EXTENSION_ID]: { v: 1, key: 'a3f9c1', open: true } })

    const field = JSON.parse(buildComments(existing, { key: 'a3f9c1', open: false, running: null }))

    expect(field['jemand.anderes']).toEqual({ ticket: 42 })
    expect(field[EXTENSION_ID]).toEqual({ v: 1, key: 'a3f9c1', open: false })
  })

  // Measured: `null` before anything was written, `""` once emptied.
  it('is absent in an empty, a foreign or a broken field', () => {
    expect(readComments(null)).toBeNull()
    expect(readComments('')).toBeNull()
    expect(readComments('{"jemand.anderes":{"key":"a3f9c1"}}')).toBeNull()
    expect(readComments('{"profitlich.prosonata')).toBeNull()
    expect(readComments('[1,2]')).toBeNull()
    expect(readComments(`{"${EXTENSION_ID}":{"v":1,"key":"a3f9c1"}}`)).toBeNull()
  })

  it('overwrites a broken field rather than failing on it', () => {
    expect(readComments(buildComments('{kaputt', { key: 'a3f9c1', open: true, running: null }))?.key).toBe('a3f9c1')
  })
})
