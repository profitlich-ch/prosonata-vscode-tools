import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { rootCommit } from './git.js'

/**
 * The root commit identifies the repository across all clones, so a branch key
 * built from it must not move (KONZEPT.md §3). The one way it could move in
 * practice: a foreign history joined in later brings a root of its own.
 */

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prosonata-git-'))
  run(dir, 'init', '--quiet', '--initial-branch=main')
  run(dir, 'config', 'user.email', 't@example.invalid')
  run(dir, 'config', 'user.name', 'T')
  return dir
}

function run(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    // Fixed dates: the foreign history has to be the younger one, because that
    // is what puts it first in `rev-list` and used to decide the key.
    env: { ...process.env, GIT_AUTHOR_DATE: '2024-01-01T09:00:00', GIT_COMMITTER_DATE: '2024-01-01T09:00:00' },
  }).trim()
}

function commit(dir: string, file: string, message: string, when = '2024-01-01T09:00:00'): void {
  writeFileSync(join(dir, file), `${message}\n`)
  run(dir, 'add', file)
  execFileSync('git', ['commit', '--quiet', '-m', message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  })
}

describe('the root commit', () => {
  it('survives a foreign history merged in later', () => {
    const dir = repo()
    commit(dir, 'a.txt', 'erster Commit')
    const before = rootCommit(dir)

    // A vendored library, joined with --allow-unrelated-histories. It carries a
    // root of its own, and a younger one at that.
    run(dir, 'checkout', '--quiet', '--orphan', 'fremd')
    run(dir, 'rm', '-rf', '--quiet', '.')
    commit(dir, 'lib.txt', 'fremde Historie', '2026-05-01T09:00:00')
    run(dir, 'checkout', '--quiet', 'main')
    execFileSync('git', ['merge', '--quiet', '--allow-unrelated-histories', '--no-edit', 'fremd'], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-05-01T10:00:00', GIT_COMMITTER_DATE: '2026-05-01T10:00:00' },
    })

    expect(run(dir, 'rev-list', '--max-parents=0', 'HEAD').split('\n')).toHaveLength(2)
    expect(rootCommit(dir)).toBe(before)
  })

  it('is null outside a repository', () => {
    expect(rootCommit(mkdtempSync(join(tmpdir(), 'prosonata-none-')))).toBeNull()
  })
})
