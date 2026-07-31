import { execFileSync } from 'node:child_process'

/**
 * Everything this tool needs from git (KONZEPT.md §5).
 *
 * Worktrees are the reason paths are never assembled by hand: in a worktree
 * `.git` is a file, not a directory, and HEAD lives under
 * `.git/worktrees/<name>/HEAD`. `git rev-parse --git-path HEAD` resolves that
 * correctly in every case.
 */

export interface GitRepo {
  /** Absolute path of the working directory — worktrees have their own. */
  root: string
  /** Identifies the repository across all clones. */
  rootCommit: string
  branch: string
  /** Path of the HEAD file to watch while a timer runs. */
  headFile: string
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function tryGit(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args)
  } catch {
    return null
  }
}

export function isRepo(cwd: string): boolean {
  return tryGit(cwd, 'rev-parse', '--is-inside-work-tree') === 'true'
}

export function describeRepo(cwd: string): GitRepo | null {
  const root = tryGit(cwd, 'rev-parse', '--show-toplevel')
  if (!root) return null

  return {
    root,
    rootCommit: rootCommit(cwd) ?? '',
    branch: currentBranch(cwd) ?? 'HEAD',
    headFile: tryGit(cwd, 'rev-parse', '--git-path', 'HEAD') ?? '',
  }
}

/**
 * The repository's first commit. Together with the branch name it forms the key
 * that lets another machine recognise the same branch (KONZEPT.md §3).
 *
 * Along the first-parent line only. A history merged in with
 * `--allow-unrelated-histories` — a vendored library, two repositories joined —
 * arrives as a second parent and carries a root of its own. Without the
 * restriction that foreign root could put itself at the top of the list years
 * later, and every branch of the repository would silently get a new key: open
 * entries in ProSonata would no longer be found, and every machine would start
 * a second one. Sorting keeps the choice deterministic even then.
 */
export function rootCommit(cwd: string): string | null {
  const roots = tryGit(cwd, 'rev-list', '--max-parents=0', '--first-parent', 'HEAD')
  return roots?.split('\n').filter((line) => line !== '').sort()[0] ?? null
}

export function currentBranch(cwd: string): string | null {
  const branch = tryGit(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD')
  return branch === '' ? null : branch
}

/**
 * The main branch: whatever `origin/HEAD` points at, `main` otherwise
 * (KONZEPT.md §3).
 */
export function mainBranch(cwd: string): string {
  const pointer = tryGit(cwd, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')
  const stripped = pointer?.replace(/^origin\//, '')
  return stripped && stripped !== '' ? stripped : 'main'
}

export function headSha(cwd: string): string | null {
  return tryGit(cwd, 'rev-parse', 'HEAD')
}

export function subjectOf(cwd: string, sha = 'HEAD'): string {
  return tryGit(cwd, 'log', '-1', '--format=%s', sha) ?? ''
}

/**
 * The invoice text from the commit's trailer, read by git itself rather than by
 * a parser of our own. Other trailers in the same paragraph do not disturb it.
 */
export function trailerOf(cwd: string, key: string, sha = 'HEAD'): string | null {
  const message = tryGit(cwd, 'log', '-1', '--format=%B', sha)
  if (message === null) return null

  const parsed = tryGitStdin(cwd, message, 'interpret-trailers', '--parse')
  if (parsed === null) return null

  const wanted = key.toLowerCase()
  for (const line of parsed.split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    if (line.slice(0, separator).trim().toLowerCase() !== wanted) continue
    return line.slice(separator + 1).trim()
  }
  return null
}

/** Whether `branch` has been merged into `into` (KONZEPT.md §3). */
export function isMerged(cwd: string, branch: string, into: string): boolean {
  return tryGit(cwd, 'merge-base', '--is-ancestor', branch, into) !== null
}

export function branchExists(cwd: string, branch: string): boolean {
  return tryGit(cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`) !== null
}

/**
 * Whether the remote branch is gone. The most reliable signal that a pull
 * request was closed: GitHub deletes the branch on merge, and after a prune the
 * remote ref disappears — which a squash merge does not otherwise reveal.
 */
export function remoteBranchGone(cwd: string, branch: string): boolean {
  return tryGit(cwd, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`) === null
}

export function fetchPrune(cwd: string): boolean {
  return tryGit(cwd, 'fetch', '--prune', '--quiet') !== null
}

/** Whether a commit is still reachable from HEAD, i.e. not rolled back. */
export function stillReachable(cwd: string, sha: string): boolean {
  return tryGit(cwd, 'merge-base', '--is-ancestor', sha, 'HEAD') !== null
}

function tryGitStdin(cwd: string, input: string, ...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}
