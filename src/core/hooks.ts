import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { paths } from './config.js'
import { isTracked, tryGit } from './git.js'
import { t } from './l10n.js'
import { VERSION } from './version.js'

/**
 * Installing the hooks, `post-commit` and `post-checkout` (KONZEPT.md §8).
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

/**
 * The hooks this tool installs. `post-commit` books, `post-checkout` only cuts
 * the running segment at a branch switch and asks (KONZEPT.md §5).
 */
export type HookName = 'post-commit' | 'post-checkout'

export const HOOKS: readonly HookName[] = ['post-commit', 'post-checkout']

const HEADER = [
  '# Installed by "prosonata init". Absolute paths on purpose: a hook started',
  '# from a GUI git client inherits an environment without nvm or Homebrew.',
  '# The first line keeps unconfigured repositories from starting Node at all.',
  '# ELECTRON_RUN_AS_NODE: the path below is VS Code itself when the extension',
  '# installed this hook. Real Node ignores the variable.',
]

/** Our part of a hook file, between the two markers. */
export function hookBlock({ node, cli }: HookPaths, hook: HookName = 'post-commit'): string {
  const run = `ELECTRON_RUN_AS_NODE=1 ${quote(node)} ${quote(cli)}`
  if (hook === 'post-commit') {
    return [
      BEGIN,
      ...HEADER,
      'git config --local --get prosonata.active >/dev/null 2>&1 || exit 0',
      `${run} post-commit || true`,
      END,
    ].join('\n')
  }

  /*
   * An `if` rather than `|| exit 0`: `post-checkout` is where Git LFS puts its
   * own line, and a line added after ours would never run if we left the script
   * early. The flag is checked here as well as in the CLI only to keep a file
   * checkout from starting Node; the CLI is where it is decided.
   */
  return [
    BEGIN,
    ...HEADER,
    '# The third argument is 1 for a branch checkout, 0 for a file checkout.',
    'if [ "$3" = 1 ] && git config --local --get prosonata.active >/dev/null 2>&1; then',
    `  ${run} post-checkout "$1" "$2" "$3" || true`,
    'fi',
    END,
  ].join('\n')
}

export interface InstallResult {
  hook: HookName
  path: string
  /** `tracked`: only from `installHooks` — the project ships this hook, and it was left alone. */
  action: 'created' | 'appended' | 'updated' | 'unchanged' | 'tracked'
  /** Set when the hook had to go into the working tree and was excluded locally. */
  excluded?: boolean
}

/** Thrown rather than changing a file the project itself ships. */
export class HookIsTracked extends Error {
  constructor(public readonly path: string) {
    super(t('{0} belongs to the repository — this tool does not write there', path))
    this.name = 'HookIsTracked'
  }
}

/**
 * Installs or refreshes one hook. An existing hook — Husky, Git LFS — is
 * respected: our block is appended, never written over it.
 *
 * @throws {HookIsTracked} when the project ships this hook itself.
 */
export function installHook(repoRoot: string, paths: HookPaths, hook: HookName = 'post-commit'): InstallResult {
  const path = hookPath(repoRoot, hook)
  const block = hookBlock(paths, hook)

  /*
   * A hook the project ships is the project's, and appending to it would show
   * up as a change to the customer's repository — with absolute paths of this
   * machine in it. Better to say so than to write and hope nobody commits.
   */
  const inWorkTree = hookIsInWorkTree(repoRoot, hook)
  if (inWorkTree && isTracked(repoRoot, path)) throw new HookIsTracked(path)

  const exclude = (result: InstallResult): InstallResult => {
    if (!inWorkTree) return result
    keepOutOfCommits(repoRoot, path)
    return { ...result, excluded: true }
  }

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `#!/bin/sh\n${block}\n`, { mode: 0o755 })
    return exclude({ hook, path, action: 'created' })
  }

  const current = readFileSync(path, 'utf8')
  const replaced = replaceBlock(current, block)
  if (replaced === null) {
    writeFileSync(path, `${current.replace(/\n*$/, '\n')}\n${block}\n`)
    chmodSync(path, 0o755)
    return exclude({ hook, path, action: 'appended' })
  }

  if (replaced === current) return { hook, path, action: 'unchanged' }

  writeFileSync(path, replaced)
  chmodSync(path, 0o755)
  return exclude({ hook, path, action: 'updated' })
}

/**
 * Installs or refreshes every hook in `HOOKS`.
 *
 * A hook the project ships is reported as `tracked` instead of thrown: a
 * project with its own `post-checkout` must still get the `post-commit`, which
 * is the one that books. Every other error is thrown as before.
 */
export function installHooks(repoRoot: string, paths: HookPaths): InstallResult[] {
  return HOOKS.map((hook) => {
    try {
      return installHook(repoRoot, paths, hook)
    } catch (error) {
      if (error instanceof HookIsTracked) return { hook, path: error.path, action: 'tracked' }
      throw error
    }
  })
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

/** Whether our block is in the hook file — by default the `post-commit`, the one that books. */
export function isInstalled(repoRoot: string, hook: HookName = 'post-commit'): boolean {
  const path = hookPath(repoRoot, hook)
  return existsSync(path) && readFileSync(path, 'utf8').includes(BEGIN)
}

/**
 * Whether every installed block still is the one we would write today. An
 * absolute Node path breaks when the version changes, e.g. through nvm — the
 * extension checks this at start-up and repairs the hooks quietly. A repository
 * set up before `post-checkout` existed gets it the same way.
 *
 * The whole block is compared, not just the two paths: a hook from an older
 * version can carry the right paths and still be wrong, and would otherwise
 * count as healthy forever.
 */
export function hookNeedsRepair(repoRoot: string, expected: HookPaths): boolean {
  return HOOKS.some((hook) => {
    const path = hookPath(repoRoot, hook)
    if (!existsSync(path)) return true
    return !readFileSync(path, 'utf8').includes(hookBlock(expected, hook))
  })
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
export function hookPath(repoRoot: string, hook: HookName = 'post-commit'): string {
  const dir = tryGit(repoRoot, 'rev-parse', '--git-path', 'hooks') ?? join(repoRoot, '.git', 'hooks')
  const absolute = dir.startsWith('/') ? dir : join(repoRoot, dir)
  return join(absolute, hook)
}

/**
 * Whether the hook lands in the working tree rather than inside `.git`.
 *
 * Then it lies in the customer's repository, and it carries absolute paths of
 * this machine. It must never be committed — see `keepOutOfCommits`.
 */
export function hookIsInWorkTree(repoRoot: string, hook: HookName = 'post-commit'): boolean {
  const gitDir = tryGit(repoRoot, 'rev-parse', '--git-common-dir')
  if (gitDir === null) return false

  const absolute = gitDir.startsWith('/') ? gitDir : join(repoRoot, gitDir)
  return !hookPath(repoRoot, hook).startsWith(`${absolute}/`)
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
