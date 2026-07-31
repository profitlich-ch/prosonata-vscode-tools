import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { tryGit } from './git.js'

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
}

/**
 * Installs or refreshes the hook. An existing `post-commit` is respected: our
 * block is appended, never written over it.
 */
export function installHook(repoRoot: string, paths: HookPaths): InstallResult {
  const path = hookPath(repoRoot)
  const block = hookBlock(paths)

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `#!/bin/sh\n${block}\n`, { mode: 0o755 })
    return { path, action: 'created' }
  }

  const current = readFileSync(path, 'utf8')
  const replaced = replaceBlock(current, block)
  if (replaced === null) {
    writeFileSync(path, `${current.replace(/\n*$/, '\n')}\n${block}\n`)
    chmodSync(path, 0o755)
    return { path, action: 'appended' }
  }

  if (replaced === current) return { path, action: 'unchanged' }

  writeFileSync(path, replaced)
  chmodSync(path, 0o755)
  return { path, action: 'updated' }
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

export function hookPath(repoRoot: string): string {
  // Worktrees share the hooks of the common directory, which is what we want.
  const dir = tryGit(repoRoot, 'rev-parse', '--git-common-dir') ?? join(repoRoot, '.git')
  const absolute = dir.startsWith('/') ? dir : join(repoRoot, dir)
  return join(absolute, 'hooks', 'post-commit')
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
