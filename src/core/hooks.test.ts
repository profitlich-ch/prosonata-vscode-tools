import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  HookIsTracked,
  hookBlock,
  hookNeedsRepair,
  hookPath,
  installHook,
  installHooks,
  isInstalled,
  publishCli,
  publishedCli,
} from './hooks.js'

const paths = { node: '/opt/node/v22/bin/node', cli: '/ext/dist/cli.cjs' }

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prosonata-repo-'))
  execFileSync('git', ['init', '--quiet'], { cwd: dir })
  return dir
}

describe('the hook block', () => {
  it('starts with a filter so unconfigured repositories never start Node', () => {
    const block = hookBlock(paths)
    const lines = block.split('\n').filter((line) => !line.startsWith('#'))

    expect(lines[0]).toContain('git config --local --get prosonata.active')
    expect(lines[0]).toContain('|| exit 0')
    expect(lines[0]!.indexOf('prosonata.active')).toBeLessThan(block.indexOf('/opt/node'))
  })

  it('uses absolute paths, not the PATH', () => {
    const block = hookBlock(paths)
    expect(block).toContain('"/opt/node/v22/bin/node"')
    expect(block).toContain('"/ext/dist/cli.cjs"')
    expect(block).not.toMatch(/^node /m)
  })

  it('never lets the commit fail', () => {
    expect(hookBlock(paths)).toContain('|| true')
  })

  // Installed from the extension, the "Node" path is VS Code's Electron binary,
  // which runs a script only with this variable set.
  it('runs the interpreter as Node', () => {
    expect(hookBlock(paths)).toContain('ELECTRON_RUN_AS_NODE=1 "/opt/node/v22/bin/node"')
  })
})

describe('installing', () => {
  it('creates an executable hook where there was none', () => {
    const dir = repo()
    const result = installHook(dir, paths)

    expect(result.action).toBe('created')
    expect(readFileSync(result.path, 'utf8')).toMatch(/^#!\/bin\/sh/)
    expect(statSync(result.path).mode & 0o111).toBeTruthy()
    expect(isInstalled(dir)).toBe(true)
  })

  it('respects an existing hook instead of overwriting it', () => {
    const dir = repo()
    const path = hookPath(dir)
    writeFileSync(path, '#!/bin/sh\necho "etwas anderes"\n', { mode: 0o755 })

    const result = installHook(dir, paths)

    expect(result.action).toBe('appended')
    const contents = readFileSync(path, 'utf8')
    expect(contents).toContain('echo "etwas anderes"')
    expect(contents).toContain('prosonata')
  })

  it('replaces only its own block when paths change', () => {
    const dir = repo()
    const path = hookPath(dir)
    writeFileSync(path, '#!/bin/sh\necho "vorher"\n', { mode: 0o755 })
    installHook(dir, paths)

    const result = installHook(dir, { node: '/opt/node/v24/bin/node', cli: paths.cli })

    expect(result.action).toBe('updated')
    const contents = readFileSync(path, 'utf8')
    expect(contents).toContain('echo "vorher"')
    expect(contents).toContain('/opt/node/v24/bin/node')
    expect(contents).not.toContain('/opt/node/v22/bin/node')
  })

  it('is a no-op when nothing changed', () => {
    const dir = repo()
    installHook(dir, paths)
    expect(installHook(dir, paths).action).toBe('unchanged')
  })
})

describe('repair', () => {
  it('is due when the recorded Node path no longer matches', () => {
    const dir = repo()
    installHooks(dir, paths)

    expect(hookNeedsRepair(dir, paths)).toBe(false)
    // What happens after an nvm upgrade.
    expect(hookNeedsRepair(dir, { ...paths, node: '/opt/node/v24/bin/node' })).toBe(true)
  })

  it('is due when the hook is missing altogether', () => {
    expect(hookNeedsRepair(repo(), paths)).toBe(true)
  })

  it('is due for a block from an older version, even with the right paths', () => {
    const dir = repo()
    const stale = hookBlock(paths).replace('ELECTRON_RUN_AS_NODE=1 ', '')
    writeFileSync(hookPath(dir), `#!/bin/sh\n${stale}\n`, { mode: 0o755 })

    expect(hookNeedsRepair(dir, paths)).toBe(true)
    expect(installHook(dir, paths).action).toBe('updated')
  })
})

/*
 * The second hook cuts the running segment at a branch switch (KONZEPT.md §5).
 * It shares the file with Git LFS more often than not, and it runs at every
 * checkout — of files, too.
 */
describe('the post-checkout hook', () => {
  /** Runs the hook file the way git would, and says whether a line after ours still ran. */
  function runsWhatFollows(dir: string, ...args: string[]): boolean {
    const path = hookPath(dir, 'post-checkout')
    const marker = join(dir, 'after-ours')
    writeFileSync(path, `${readFileSync(path, 'utf8')}touch "${marker}"\n`)
    execFileSync('sh', [path, ...args], { cwd: dir })
    return existsSync(marker)
  }

  it('calls the CLI with the three arguments of git, and never fails the checkout', () => {
    const block = hookBlock(paths, 'post-checkout')

    expect(block).toContain('"/ext/dist/cli.cjs" post-checkout "$1" "$2" "$3" || true')
    expect(block).toContain('ELECTRON_RUN_AS_NODE=1 "/opt/node/v22/bin/node"')
  })

  it('starts Node only for a branch checkout in a configured repository', () => {
    const block = hookBlock(paths, 'post-checkout')

    expect(block).toContain('if [ "$3" = 1 ] && git config --local --get prosonata.active')
  })

  // `|| exit 0`, as in the post-commit, would end the script before Git LFS.
  it('lets a line after it run, for a file checkout and an unconfigured repository alike', () => {
    const dir = repo()
    installHook(dir, paths, 'post-checkout')

    expect(runsWhatFollows(dir, 'a', 'b', '0')).toBe(true)
    expect(runsWhatFollows(dir, 'a', 'b', '1')).toBe(true)
  })

  it('is installed beside the post-commit, each in its own file', () => {
    const dir = repo()

    const results = installHooks(dir, paths)

    expect(results.map((result) => [result.hook, result.action])).toEqual([
      ['post-commit', 'created'],
      ['post-checkout', 'created'],
    ])
    expect(readFileSync(hookPath(dir, 'post-commit'), 'utf8')).toContain('cli.cjs" post-commit')
    expect(readFileSync(hookPath(dir, 'post-checkout'), 'utf8')).toContain('cli.cjs" post-checkout')
    expect(isInstalled(dir, 'post-checkout')).toBe(true)
  })

  it('keeps the post-checkout of Git LFS', () => {
    const dir = repo()
    const lfs = '#!/bin/sh\ngit lfs post-checkout "$@"\n'
    writeFileSync(hookPath(dir, 'post-checkout'), lfs, { mode: 0o755 })

    expect(installHook(dir, paths, 'post-checkout').action).toBe('appended')
    expect(readFileSync(hookPath(dir, 'post-checkout'), 'utf8')).toMatch(/^#!\/bin\/sh\ngit lfs post-checkout "\$@"\n/)
  })

  // Every repository set up before this hook existed.
  it('makes a repository with only the post-commit due for repair, and the repair adds it', () => {
    const dir = repo()
    installHook(dir, paths)

    expect(hookNeedsRepair(dir, paths)).toBe(true)
    expect(installHooks(dir, paths).map((result) => result.action)).toEqual(['unchanged', 'created'])
    expect(hookNeedsRepair(dir, paths)).toBe(false)
  })

  /*
   * The post-commit is the one that books. A project that ships its own
   * post-checkout loses the cut at the switch, not its time tracking.
   */
  it('leaves a tracked post-checkout alone and still installs the post-commit', () => {
    const dir = repo()
    execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: dir })
    mkdirSync(join(dir, '.githooks'))
    writeFileSync(join(dir, '.githooks', 'post-checkout'), '#!/bin/sh\necho projekt\n', { mode: 0o755 })
    execFileSync('git', ['add', '.githooks/post-checkout'], { cwd: dir })

    const results = installHooks(dir, paths)

    expect(results.map((result) => [result.hook, result.action])).toEqual([
      ['post-commit', 'created'],
      ['post-checkout', 'tracked'],
    ])
    expect(readFileSync(join(dir, '.githooks', 'post-checkout'), 'utf8')).not.toContain('prosonata')
    expect(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')).toContain('/.githooks/post-commit')
  })

  it('keeps both hooks out of commits when they land in the working tree', () => {
    const dir = repo()
    execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: dir })

    installHooks(dir, paths)

    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude).toContain('/.githooks/post-commit')
    expect(exclude).toContain('/.githooks/post-checkout')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('')
  })
})

describe('publishing the CLI to its fixed place', () => {
  let home: string
  let source: string
  const before = process.env['PROSONATA_HOME']

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'prosonata-home-'))
    process.env['PROSONATA_HOME'] = home
    source = join(mkdtempSync(join(tmpdir(), 'prosonata-ext-')), 'cli.cjs')
    writeFileSync(source, '#!/usr/bin/env node\nconsole.log(1)\n')
  })

  afterEach(() => {
    if (before === undefined) delete process.env['PROSONATA_HOME']
    else process.env['PROSONATA_HOME'] = before
  })

  it('copies the bundle and records which version the hooks now call', () => {
    expect(publishCli(source, '0.15.0')).toBe(true)

    expect(readFileSync(join(home, 'cli.cjs'), 'utf8')).toContain('console.log(1)')
    expect(publishedCli()).toEqual({ path: join(home, 'cli.cjs'), version: '0.15.0' })
  })

  /*
   * It runs on every window start. Rewriting a file that a hook may be reading
   * at that moment, for nothing, is exactly the risk not worth taking.
   */
  it('does not write again when the copy is already current', () => {
    publishCli(source, '0.15.0')
    const written = statSync(join(home, 'cli.cjs')).mtimeMs

    expect(publishCli(source, '0.15.0')).toBe(false)
    expect(statSync(join(home, 'cli.cjs')).mtimeMs).toBe(written)
  })

  it('replaces the copy when the bundle changed', () => {
    publishCli(source, '0.15.0')
    writeFileSync(source, '#!/usr/bin/env node\nconsole.log(2)\n')

    expect(publishCli(source, '0.16.0')).toBe(true)
    expect(readFileSync(join(home, 'cli.cjs'), 'utf8')).toContain('console.log(2)')
    expect(publishedCli()?.version).toBe('0.16.0')
  })

  it('writes nothing when the bundle is not there', () => {
    expect(() => publishCli(join(home, 'gibtsnicht.cjs'), '0.15.0')).toThrow()

    expect(existsSync(join(home, 'cli.cjs'))).toBe(false)
  })

  /*
   * A hook may start this file at any moment, so a failed copy must not leave a
   * temp file lying about — the same reason state.json is written this way.
   */
  it('clears the temp file when the copy cannot be put in place', () => {
    mkdirSync(join(home, 'cli.cjs'))

    expect(() => publishCli(source, '0.15.0')).toThrow()
    expect(readdirSync(home).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('reports nothing when no copy was ever published', () => {
    expect(publishedCli()).toBeNull()
  })
})

/*
 * `core.hooksPath` moves the whole hooks directory, and projects that ship
 * their own hooks do set it. Writing to `.git/hooks` there leaves a file git
 * never runs — and since the repair check looked in the same wrong place, the
 * hook counted as healthy for ever. At one account six commits in a day booked
 * nothing, and nothing said so.
 */
describe('a repository that moves its hooks', () => {
  function repoWithHooksPath(where: string): string {
    const dir = repo()
    execFileSync('git', ['config', '--local', 'core.hooksPath', where], { cwd: dir })
    return dir
  }

  it('looks where git looks, not where the hooks usually are', () => {
    const dir = repoWithHooksPath('.githooks')

    expect(hookPath(dir)).toBe(join(dir, '.githooks', 'post-commit'))
  })

  it('installs there, and git would run it', () => {
    const dir = repoWithHooksPath('.githooks')

    const result = installHook(dir, paths)

    expect(result.path).toBe(join(dir, '.githooks', 'post-commit'))
    expect(readFileSync(result.path, 'utf8')).toContain('post-commit || true')
    expect(isInstalled(dir)).toBe(true)
  })

  /*
   * The hook now lies in the customer's repository and carries absolute paths of
   * this machine. `info/exclude` keeps it out of commits and is itself local —
   * unlike `.gitignore`, which would be a change to the project.
   */
  it('keeps the hook out of commits when it lands in the working tree', () => {
    const dir = repoWithHooksPath('.githooks')

    expect(installHook(dir, paths).excluded).toBe(true)

    expect(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')).toContain('/.githooks/post-commit')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('')
  })

  it('does not write the same exclude line twice', () => {
    const dir = repoWithHooksPath('.githooks')
    installHook(dir, paths)
    installHook(dir, { ...paths, node: '/opt/node/v24/bin/node' })

    const lines = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() === '/.githooks/post-commit')
    expect(lines).toHaveLength(1)
  })

  it('excludes nothing when the hooks stay inside .git', () => {
    expect(installHook(repo(), paths).excluded).toBeUndefined()
  })

  // A hook the project ships belongs to the project.
  it('refuses to touch a hook the repository tracks', () => {
    const dir = repoWithHooksPath('.githooks')
    mkdirSync(join(dir, '.githooks'))
    writeFileSync(join(dir, '.githooks', 'post-commit'), '#!/bin/sh\necho projekt\n', { mode: 0o755 })
    execFileSync('git', ['add', '.githooks/post-commit'], { cwd: dir })

    expect(() => installHook(dir, paths)).toThrow(HookIsTracked)
    expect(readFileSync(join(dir, '.githooks', 'post-commit'), 'utf8')).not.toContain('prosonata')
  })
})
