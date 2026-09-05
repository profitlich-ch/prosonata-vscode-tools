import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hookBlock, hookNeedsRepair, hookPath, installHook, isInstalled, publishCli, publishedCli } from './hooks.js'

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
    installHook(dir, paths)

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
