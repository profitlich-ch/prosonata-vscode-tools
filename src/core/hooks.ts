import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { paths } from './config.js'
import { isTracked, tryGit } from './git.js'
import { VERSION } from './version.js'

/**
 * Installing the `post-commit` hook (KONZEPT.md §8).
 *
 * The hook must not rely on `$PATH`. Git runs it with the environment of
 * whatever called git, and that is not always a shell: VS Code started from the
 * Dock inherits launchd's environment, which has no nvm and often little more
 * than `/usr/bin:/bin`. A hook saying `node dist/cli.cjs` would then find no
 * Node at all and fail silently — in exactly the case this extension is meant
 * to cover.
 *
 * So `prosonata init` resolves both paths at install time and writes them in
 * absolutely.
 *
 * The Node path is `process.execPath`, and in the extension host that is not
 * Node but VS Code's own Electron binary. Electron only runs a script when
 * `ELECTRON_RUN_AS_NODE` is set; without it the hook dies with "Unable to find
 * helper app" and `|| true` hides it. The block therefore sets the variable —
 * real Node ignores it, so one line serves both front ends.
 */

const BEGIN = '# >>> prosonata >>>'
const END = '# <<< prosonata <<<'

export interface HookPaths {
  /** Absolute path of the Node binary, normally `process.execPath` — which in the extension host is Electron. */
  node: string
  /** Absolute path of the bundled CLI. */
  cli: string
}

export function hookBlock({ node, cli }: HookPaths): string {
  return [
    BEGIN,
    '# Installed by "prosonata init". Absolute paths on purpose: a hook started',
    '# from a GUI git client inherits an environment without nvm or Homebrew.',
    '# The first line keeps unconfigured repositories from starting Node at all.',
    '# ELECTRON_RUN_AS_NODE: the path below is VS Code itself when the extension',
    '# installed this hook. Real Node ignores the variable.',
    'git config --local --get prosonata.active >/dev/null 2>&1 || exit 0',
    `ELECTRON_RUN_AS_NODE=1 ${quote(node)} ${quote(cli)} post-commit || true`,
    END,
  ].join('\n')
}

export interface InstallResult {
  path: string
  action: 'created' | 'appended' | 'updated' | 'unchanged'
  /** Set when the hook had to go into the working tree and was excluded locally. */
  excluded?: boolean
}

/** Thrown rather than changing a file the project itself ships. */
export class HookIsTracked extends Error {
  constructor(public readonly path: string) {
    super(`${path} gehört zum Repository — dort schreibt dieses Werkzeug nicht hinein`)
    this.name = 'HookIsTracked'
  }
}

/**
 * Installs or refreshes the hook. An existing `post-commit` is respected: our
 * block is appended, never written over it.
 */
export function installHook(repoRoot: string, paths: HookPaths): InstallResult {
  const path = hookPath(repoRoot)
  const block = hookBlock(paths)

  /*
   * A hook the project ships is the project's, and appending to it would show
   * up as a change to the customer's repository — with absolute paths of this
   * machine in it. Better to say so than to write and hope nobody commits.
   */
  const inWorkTree = hookIsInWorkTree(repoRoot)
  if (inWorkTree && isTracked(repoRoot, path)) throw new HookIsTracked(path)

  const exclude = (result: InstallResult): InstallResult => {
    if (!inWorkTree) return result
    keepOutOfCommits(repoRoot, path)
    return { ...result, excluded: true }
  }

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `#!/bin/sh\n${block}\n`, { mode: 0o755 })
    return exclude({ path, action: 'created' })
  }

  const current = readFileSync(path, 'utf8')
  const replaced = replaceBlock(current, block)
  if (replaced === null) {
    writeFileSync(path, `${current.replace(/\n*$/, '\n')}\n${block}\n`)
    chmodSync(path, 0o755)
    return exclude({ path, action: 'appended' })
  }

  if (replaced === current) return { path, action: 'unchanged' }

  writeFileSync(path, replaced)
  chmodSync(path, 0o755)
  return exclude({ path, action: 'updated' })
}

/**
 * Puts the bundled CLI where the hooks look for it, and records its version.
 *
 * The hook holds absolute paths, and until now one of them pointed into the
 * extension's own folder — which carries the version number. Every update left
 * a new folder beside the old one, the old one kept working, and so the hook
 * kept calling the code of the day it was written. Three times a hook has
 * failed silently this way, because `|| true` swallows whatever it says
 * (KONZEPT.md §8).
 *
 * A fixed place ends that: the hook never has to be rewritten again for a new
 * version, and an update reaches every repository at once, including those that
 * are never opened in the editor.
 *
 * Written atomically, because a hook may start this file at any moment and must
 * never see half of it — the same reason `state.json` is written that way.
 *
 * @param source Absolute path of the bundled `cli.cjs` to publish.
 * @param version Written next to the copy; defaults to this build's version.
 * @returns Whether the CLI itself was written; `false` means it was current.
 */
export function publishCli(source: string, version: string = VERSION): boolean {
  const target = paths.cli()

  const wanted = readFileSync(source)
  /*
   * Unreadable counts as "not what we want", so a damaged target is replaced
   * rather than turned into an error nobody can act on. This also settles the
   * case where source and target are the same file — the CLI publishing itself,
   * started from the fixed place: the contents match, so nothing is written.
   */
  const same = readIfPossible(target)?.equals(wanted) === true

  if (!same) {
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`
    try {
      writeFileSync(temp, wanted, { mode: 0o755 })
      renameSync(temp, target)
    } catch (error) {
      try {
        unlinkSync(temp)
      } catch {
        // The temp file may never have been created; the first error is the one that counts.
      }
      throw error
    }
  }

  const stamp = paths.cliVersion()
  const stamped = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : null
  if (stamped !== version) writeFileSync(stamp, `${version}\n`)

  return !same
}

/** Which version the hooks currently call, or null if none is published. */
export function publishedCli(): { path: string; version: string } | null {
  const target = paths.cli()
  if (!existsSync(target)) return null

  const stamp = paths.cliVersion()
  return { path: target, version: existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : 'unbekannt' }
}

export function isInstalled(repoRoot: string): boolean {
  const path = hookPath(repoRoot)
  return existsSync(path) && readFileSync(path, 'utf8').includes(BEGIN)
}

/**
 * Whether the installed block still is the one we would write today. An absolute
 * Node path breaks when the version changes, e.g. through nvm — the extension
 * checks this at start-up and repairs the hook quietly.
 *
 * The whole block is compared, not just the two paths: a hook from an older
 * version can carry the right paths and still be wrong, and would otherwise
 * count as healthy forever.
 */
export function hookNeedsRepair(repoRoot: string, expected: HookPaths): boolean {
  const path = hookPath(repoRoot)
  if (!existsSync(path)) return true

  return !readFileSync(path, 'utf8').includes(hookBlock(expected))
}

/**
 * Where git will look for the hook — asked of git, not assembled by hand.
 *
 * `core.hooksPath` moves the whole directory, and repositories do set it: a
 * project that ships its own hooks points it at a tracked folder so everyone
 * gets them. Writing to `.git/hooks` there produces a file git never runs, and
 * because the repair check looked in the same wrong place, the hook counted as
 * healthy for ever. Measured at one account: six commits in a day, none of them
 * booked, nothing said.
 *
 * `--git-path hooks` answers with the configured directory and resolves
 * worktrees on the way, which is why nothing here is built from `.git`.
 */
export function hookPath(repoRoot: string): string {
  const dir = tryGit(repoRoot, 'rev-parse', '--git-path', 'hooks') ?? join(repoRoot, '.git', 'hooks')
  const absolute = dir.startsWith('/') ? dir : join(repoRoot, dir)
  return join(absolute, 'post-commit')
}

/**
 * Whether the hook lands in the working tree rather than inside `.git`.
 *
 * Then it lies in the customer's repository, and it carries absolute paths of
 * this machine. It must never be committed — see `keepOutOfCommits`.
 */
export function hookIsInWorkTree(repoRoot: string): boolean {
  const gitDir = tryGit(repoRoot, 'rev-parse', '--git-common-dir')
  if (gitDir === null) return false

  const absolute = gitDir.startsWith('/') ? gitDir : join(repoRoot, gitDir)
  return !hookPath(repoRoot).startsWith(`${absolute}/`)
}

/**
 * Adds the hook to `.git/info/exclude`, the ignore list that stays local.
 *
 * Not `.gitignore`: that one is tracked, so ignoring our file would itself be a
 * change to the customer's repository. `info/exclude` belongs to this clone
 * alone and is exactly the place for "this file is mine, not the project's".
 */
function keepOutOfCommits(repoRoot: string, hook: string): void {
  const gitDir = tryGit(repoRoot, 'rev-parse', '--git-common-dir')
  if (gitDir === null) return

  const absolute = gitDir.startsWith('/') ? gitDir : join(repoRoot, gitDir)
  const file = join(absolute, 'info', 'exclude')
  const pattern = `/${relative(repoRoot, hook)}`

  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split('\n').some((line) => line.trim() === pattern)) return

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${current.replace(/\n*$/, '\n')}${pattern}\n`)
}

function readIfPossible(file: string): Buffer | null {
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}

function replaceBlock(contents: string, block: string): string | null {
  const from = contents.indexOf(BEGIN)
  const to = contents.indexOf(END)
  if (from < 0 || to < 0) return null
  return `${contents.slice(0, from)}${block}${contents.slice(to + END.length)}`
}

function quote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}
