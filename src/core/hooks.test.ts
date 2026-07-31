import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { hookBlock, hookNeedsRepair, hookPath, installHook, isInstalled } from './hooks.js'

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
