import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { StateStore, VersionConflict } from './state-store.js'
import { emptyState } from './types.js'

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'prosonata-'))
  return { dir, file: join(dir, 'state.json'), store: new StateStore(join(dir, 'state.json')) }
}

describe('reading', () => {
  it('treats a missing file as a fresh install, not an error', () => {
    const { store: s } = store()
    const { state, recovery } = s.read()

    expect(state.version).toBe(1)
    expect(state.entries).toEqual([])
    expect(recovery).toBeUndefined()
  })

  it('moves an unreadable file aside instead of overwriting it', () => {
    const { dir, file, store: s } = store()
    writeFileSync(file, '{ this is not json')

    const { state, recovery } = s.read()

    expect(state.entries).toEqual([])
    expect(recovery?.reason).toBe('unreadable')

    // The only trace of untransmitted time must survive.
    const broken = readdirSync(dir).filter((name) => name.includes('.broken-'))
    expect(broken).toHaveLength(1)
    expect(readFileSync(join(dir, broken[0]!), 'utf8')).toBe('{ this is not json')
  })

  it('quarantines a state written by a newer version', () => {
    const { file, store: s } = store()
    writeFileSync(file, JSON.stringify({ ...emptyState(), formatVersion: 99 }))

    expect(s.read().recovery?.reason).toBe('unknown-format')
  })
})

describe('the version counter', () => {
  it('bumps on every write', () => {
    const { store: s } = store()
    const first = s.write(emptyState(), 1)
    expect(first.version).toBe(2)

    const second = s.write(first, first.version)
    expect(second.version).toBe(3)
  })

  it('refuses a write based on a stale read', () => {
    const { store: s } = store()
    const { state } = s.read()

    // Someone else writes in between.
    s.write(state, state.version)

    expect(() => s.write(state, state.version)).toThrow(VersionConflict)
  })

  it('prevents the lost update from KONZEPT.md §7', () => {
    const { store: s } = store()
    s.write(emptyState(), 1)

    // Both read the same state, as the hook and the extension would.
    const hook = s.read().state
    const extension = s.read().state

    // The hook books half an hour.
    s.write({ ...hook, pending: [{ entryId: 'e1', since: 0, closing: false }] }, hook.version)

    // The extension tries to write its own change on the old basis.
    expect(() =>
      s.write({ ...extension, timers: [] }, extension.version),
    ).toThrow(VersionConflict)

    // The half hour is still there.
    expect(s.read().state.pending).toHaveLength(1)
  })

  it('retries automatically in update()', () => {
    const { store: s } = store()
    s.write(emptyState(), 1)

    const result = s.update((state) => ({ ...state, pending: [{ entryId: 'e1', since: 1, closing: true }] }))
    expect(result.pending).toHaveLength(1)
    expect(s.read().state.pending[0]?.entryId).toBe('e1')
  })
})

describe('temp files', () => {
  it('leaves nothing behind on a successful write', () => {
    const { dir, store: s } = store()
    s.write(emptyState(), 1)

    expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toHaveLength(0)
  })

  it('sweeps stale leftovers of a crashed writer', () => {
    const { dir, file, store: s } = store()
    const stale = `${file}.tmp-999-abandoned`
    writeFileSync(stale, 'half written')

    const old = new Date(Date.now() - 60 * 60 * 1000)
    utimesSync(stale, old, old)

    s.write(emptyState(), 1)

    expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toHaveLength(0)
  })

  it('keeps a temp file that another process may still be writing', () => {
    const { dir, file, store: s } = store()
    writeFileSync(`${file}.tmp-1234-fresh`, 'in progress')

    s.write(emptyState(), 1)

    expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toHaveLength(1)
  })
})

describe('the written file', () => {
  it('is readable JSON with the format version', () => {
    const { file, store: s } = store()
    s.write(emptyState(), 1)

    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.formatVersion).toBe(1)
    expect(parsed.version).toBe(2)
  })

  it('is not world readable', () => {
    const { file, store: s } = store()
    s.write(emptyState(), 1)

    expect(statSync(file).mode & 0o077).toBe(0)
  })
})
