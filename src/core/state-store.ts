import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { emptyState, FORMAT_VERSION, type State } from './types.js'

/**
 * Reading and writing `state.json` (KONZEPT.md §7).
 *
 * Three processes write here: the extension — possibly from several windows —,
 * the hook on every commit, and the CLI. Two mechanisms keep that safe:
 *
 *   Atomic replace (temp file, then rename) so nobody ever reads half-written
 *   JSON. Readers need nothing else.
 *
 *   A version counter, because atomic replace alone still loses updates: two
 *   processes read the same state, both write, the second overwrites the first.
 *   What is lost there is time, which is the one thing this tool exists to keep.
 */

/** Stale temp files are swept once they are older than this. */
const TEMP_MAX_AGE_MS = 5 * 60 * 1000

export class VersionConflict extends Error {
  constructor() {
    super('state.json hat sich geändert, während wir daran gearbeitet haben')
    this.name = 'VersionConflict'
  }
}

export interface Recovery {
  /** Where the unreadable file was moved. */
  quarantinedAt: string
  reason: 'unreadable' | 'unknown-format'
}

export class StateStore {
  constructor(private readonly file: string) {}

  /**
   * Reads the state. A missing file is not an error — it is a fresh install.
   *
   * An unreadable file or an unknown format counts as loss. The file is moved
   * aside rather than overwritten: it is the only trace of time that never made
   * it to ProSonata, so overwriting it destroys exactly what could be salvaged.
   */
  read(): { state: State; recovery?: Recovery } {
    if (!existsSync(this.file)) return { state: emptyState() }

    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      return { state: emptyState(), recovery: this.quarantine('unreadable') }
    }

    if (!isState(parsed)) return { state: emptyState(), recovery: this.quarantine('unreadable') }
    if (parsed.formatVersion > FORMAT_VERSION) {
      return { state: emptyState(), recovery: this.quarantine('unknown-format') }
    }

    return { state: parsed }
  }

  /**
   * Writes if nobody else did in the meantime, and bumps the version.
   * Throws VersionConflict otherwise — callers retry via `update`.
   */
  write(next: State, expectedVersion: number): State {
    const current = this.read().state
    if (current.version !== expectedVersion) throw new VersionConflict()

    const written: State = { ...next, formatVersion: FORMAT_VERSION, version: expectedVersion + 1 }
    this.replaceAtomically(JSON.stringify(written, null, 2))
    return written
  }

  /** Read, change, write — retrying while someone else got there first. */
  update(change: (state: State) => State, attempts = 5): State {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const { state } = this.read()
      try {
        return this.write(change(structuredClone(state)), state.version)
      } catch (error) {
        if (!(error instanceof VersionConflict) || attempt === attempts - 1) throw error
      }
    }
    /* c8 ignore next */
    throw new VersionConflict()
  }

  private replaceAtomically(contents: string): void {
    const dir = dirname(this.file)
    mkdirSync(dir, { recursive: true })
    this.sweepStaleTemps(dir)

    const temp = join(dir, `${basename(this.file)}.tmp-${process.pid}-${Date.now().toString(36)}`)
    const handle = openSync(temp, 'wx', 0o600)
    try {
      writeSync(handle, contents)
    } finally {
      closeSync(handle)
    }
    renameSync(temp, this.file)
  }

  /**
   * A process that dies between writing and renaming leaves a temp file behind.
   * Whoever writes next clears them out — it is already working in this
   * directory, so no separate process and no schedule are needed.
   */
  private sweepStaleTemps(dir: string): void {
    const prefix = `${basename(this.file)}.tmp-`
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }

    for (const name of names) {
      if (!name.startsWith(prefix)) continue
      const path = join(dir, name)
      try {
        if (Date.now() - statSync(path).mtimeMs > TEMP_MAX_AGE_MS) unlinkSync(path)
      } catch {
        // Someone else got there first, or it is gone. Either is fine.
      }
    }
  }

  private quarantine(reason: Recovery['reason']): Recovery {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = `${this.file}.broken-${stamp}`
    try {
      renameSync(this.file, target)
    } catch {
      // If it cannot be moved, keep it where it is rather than lose it.
      writeFileSync(`${target}.note`, 'could not move the unreadable state file\n')
    }
    return { quarantinedAt: target, reason }
  }
}

function isState(value: unknown): value is State {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<State>
  return (
    typeof candidate.formatVersion === 'number' &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.timers) &&
    Array.isArray(candidate.entries) &&
    Array.isArray(candidate.pending)
  )
}
