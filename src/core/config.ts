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
   * Characters `detail` may have. 800, confirmed by ProSonata as the field's
   * fixed length. Checked here all the same: the API truncates silently beyond
   * it — and even echoes the uncut text back — so only our own check keeps a
   * half sentence off an invoice.
   */
  detailLimit: number
  /** Trailer key that carries the invoice text. */
  trailerKey: string
  /**
   * What an entry is called in ProSonata until a commit gives it its text.
   * Never a branch name — that would carry internals onto a customer's project
   * (KONZEPT.md §5).
   */
  placeholderText: string
  /** Default rounding grid; a repository may override it. */
  grid: TimeGrid
  /** Seconds a write waits before it goes out (KONZEPT.md §4). */
  sendDelaySeconds: number
  /** A segment running this long without interruption earns a question. */
  longRunWarningSeconds: number
  /** Stop the timer when the last VS Code window closes. Off means it keeps running. */
  pauseOnWindowClose: boolean
}

export const DEFAULTS: Omit<Config, 'baseUrl' | 'apiKey'> = {
  markerWord: DEFAULT_MARKER_WORD,
  detailLimit: 800,
  trailerKey: 'Prosonata',
  placeholderText: '(in Arbeit)',
  grid: { kind: 'exact' },
  sendDelaySeconds: 600,
  longRunWarningSeconds: 6 * 3600,
  pauseOnWindowClose: true,
}

export function stateDir(): string {
  return process.env['PROSONATA_HOME'] ?? join(homedir(), '.prosonata')
}

export const paths = {
  dir: stateDir,
  config: () => join(stateDir(), 'config.json'),
  state: () => join(stateDir(), 'state.json'),
  journal: () => join(stateDir(), 'log.jsonl'),
  segments: () => join(stateDir(), 'segments.jsonl'),
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

/**
 * The configuration after account data was entered again — a new key, a moved
 * subdomain. Everything else survives: `grid`, `pauseOnWindowClose` and the
 * other hand-edited values live in the same file, and re-entering a key is no
 * reason to lose them. Missing keys come from the defaults, so a file written
 * by an older version stays readable.
 */
export function configWith(previous: Config | null, account: { baseUrl: string; apiKey: string }): Config {
  return { ...DEFAULTS, ...(previous ?? {}), ...account }
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
