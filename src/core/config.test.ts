import { describe, expect, it } from 'vitest'

import { configWith, DEFAULTS, type Config } from './config.js'

/**
 * Entering account data again is an everyday thing — a key expires, a subdomain
 * moves. It must not cost the settings that live in the same file.
 */
describe('re-entering the account', () => {
  const previous: Config = {
    ...DEFAULTS,
    baseUrl: 'https://alt.prosonata.software/api/v1',
    apiKey: 'alt',
    grid: { kind: 'minutes', minutes: 15 },
    pauseOnWindowClose: false,
    placeholderText: '(läuft)',
  }

  it('replaces the account and leaves everything else alone', () => {
    const next = configWith(previous, { baseUrl: 'https://neu.prosonata.software/api/v1', apiKey: 'neu' })

    expect(next.apiKey).toBe('neu')
    expect(next.baseUrl).toBe('https://neu.prosonata.software/api/v1')
    expect(next.grid).toEqual({ kind: 'minutes', minutes: 15 })
    expect(next.pauseOnWindowClose).toBe(false)
    expect(next.placeholderText).toBe('(läuft)')
  })

  // A file from an older version knows fewer keys; the defaults fill the gaps.
  it('fills in what an older file did not have', () => {
    const older = { baseUrl: 'https://x/api/v1', apiKey: 'k' } as Config

    expect(configWith(older, { baseUrl: 'https://x/api/v1', apiKey: 'k' }).placeholderText).toBe(
      DEFAULTS.placeholderText,
    )
  })

  it('is the plain defaults when there was nothing before', () => {
    expect(configWith(null, { baseUrl: 'https://x/api/v1', apiKey: 'k' })).toEqual({
      ...DEFAULTS,
      baseUrl: 'https://x/api/v1',
      apiKey: 'k',
    })
  })
})
