import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { DEFAULT_MARKER_WORD } from './marker.js'
import type { TimeGrid } from './working-time.js'

/**
 * Global configuration in `~/.prosonata/config.json` (KONZEPT.md §7).
 *
 * The API key lives here and not in VS Code's SecretStorage: the hook runs as
 * its own process and cannot read SecretStorage. Not in the settings either,
 * because Settings Sync would carry it into the cloud.
 */

export interface Config {
  /** Base URL up to and including `/api/v1`, without a trailing slash. */
  baseUrl: string
  apiKey: string
  /** Only for an app integration, which we advise against — see KONZEPT.md §9. */
  appId?: string

  /** Word inside the marker of an open entry. */
  markerWord: string
  /**
   * Characters `detail` may have. ProSonata truncates silently beyond it and
   * raises the limit per account without telling the API, so we check ourselves.
   */
  detailLimit: number
  /** Trailer key that carries the invoice text. */
  trailerKey: string
  /** Default rounding grid; a repository may override it. */
  grid: TimeGrid
  /** Seconds a write waits before it goes out (KONZEPT.md §4). */
  sendDelaySeconds: number
  /** A timer running this long without a commit earns a warning. */
  longRunWarningSeconds: number
}

export const DEFAULTS: Omit<Config, 'baseUrl' | 'apiKey'> = {
  markerWord: DEFAULT_MARKER_WORD,
  detailLimit: 200,
  trailerKey: 'Prosonata',
  grid: { kind: 'exact' },
  sendDelaySeconds: 600,
  longRunWarningSeconds: 6 * 3600,
}

export function stateDir(): string {
  return process.env['PROSONATA_HOME'] ?? join(homedir(), '.prosonata')
}

export const paths = {
  dir: stateDir,
  config: () => join(stateDir(), 'config.json'),
  state: () => join(stateDir(), 'state.json'),
  journal: () => join(stateDir(), 'log.jsonl'),
  cache: () => join(stateDir(), 'cache.json'),
}

export class MissingConfig extends Error {
  constructor(public readonly file: string) {
    super(`keine Konfiguration in ${file} — führe "prosonata init" aus`)
    this.name = 'MissingConfig'
  }
}

export function readConfig(file = paths.config()): Config {
  if (!existsSync(file)) throw new MissingConfig(file)

  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>
  if (!raw.baseUrl || !raw.apiKey) throw new MissingConfig(file)

  return { ...DEFAULTS, ...raw, baseUrl: trimSlash(raw.baseUrl), apiKey: raw.apiKey }
}

export function writeConfig(config: Config, file = paths.config()): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 })
  // An existing file keeps its mode, so set it explicitly.
  chmodSync(file, 0o600)
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
