import { git, tryGit } from './git.js'
import type { EntryMode } from './types.js'
import type { TimeGrid } from './working-time.js'

/**
 * Per-repository settings in `git config --local` (KONZEPT.md §6).
 *
 * They belong here and not in `.vscode/settings.json`, which would be committed
 * into the customer's repository, nor in VS Code's settings, which Settings Sync
 * would carry into the cloud. They do not travel with a clone — every machine
 * is set up once, which is the point.
 */

export interface RepoProject {
  id: number
  name: string
}

export interface RepoConfig {
  projects: RepoProject[]
  activeProjectId: number | null
  /** Category last used per project — the list itself is global. */
  categories: Map<number, number>
  grid: TimeGrid | null
  /** Entry mode per branch key; the main branch is always per commit. */
  modes: Map<string, EntryMode>
}

/*
 * The id goes in the subsection, not in the key: git requires the last part of
 * a key to start with a letter, so `prosonata.category.166` is rejected and a
 * branch key beginning with a digit would be too.
 *
 *   [prosonata "166"]     category = 15
 *   [prosonata "3f9c1a"]  mode = commit
 */
const KEY = {
  project: 'prosonata.project',
  active: 'prosonata.active',
  grid: 'prosonata.grid',
  category: (projectId: number) => `prosonata.${projectId}.category`,
  mode: (branchKey: string) => `prosonata.${branchKey}.mode`,
}

export function readRepoConfig(cwd: string): RepoConfig {
  const projects = (tryGit(cwd, 'config', '--local', '--get-all', KEY.project) ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const separator = line.indexOf(':')
      if (separator < 0) return []
      const id = Number(line.slice(0, separator))
      return Number.isFinite(id) ? [{ id, name: line.slice(separator + 1) }] : []
    })

  const active = Number(tryGit(cwd, 'config', '--local', '--get', KEY.active) ?? '')

  const categories = new Map<number, number>()
  for (const project of projects) {
    const value = Number(tryGit(cwd, 'config', '--local', '--get', KEY.category(project.id)) ?? '')
    if (Number.isFinite(value) && value > 0) categories.set(project.id, value)
  }

  const modes = new Map<string, EntryMode>()
  for (const line of (tryGit(cwd, 'config', '--local', '--get-regexp', '^prosonata\\..+\\.mode$') ?? '').split('\n')) {
    const [name, value] = line.split(' ')
    if (!name || !value) continue
    const branchKey = name.slice('prosonata.'.length, -'.mode'.length)
    if (value === 'commit' || value === 'branch') modes.set(branchKey, value)
  }

  return {
    projects,
    activeProjectId: Number.isFinite(active) && active > 0 ? active : null,
    categories,
    grid: readGrid(tryGit(cwd, 'config', '--local', '--get', KEY.grid)),
    modes,
  }
}

export function rememberProject(cwd: string, project: RepoProject): void {
  const existing = readRepoConfig(cwd).projects
  if (!existing.some((candidate) => candidate.id === project.id)) {
    git(cwd, 'config', '--local', '--add', KEY.project, `${project.id}:${project.name}`)
  }
  git(cwd, 'config', '--local', KEY.active, String(project.id))
}

export function rememberCategory(cwd: string, projectId: number, categoryId: number): void {
  git(cwd, 'config', '--local', KEY.category(projectId), String(categoryId))
}

export function setMode(cwd: string, branchKey: string, mode: EntryMode): void {
  git(cwd, 'config', '--local', KEY.mode(branchKey), mode)
}

export function setGrid(cwd: string, grid: TimeGrid): void {
  git(cwd, 'config', '--local', KEY.grid, grid.kind === 'exact' ? 'exact' : String(grid.minutes))
}

export function isConfigured(cwd: string): boolean {
  return readRepoConfig(cwd).activeProjectId !== null
}

/**
 * The mode of a branch. On the main branch it is fixed to per commit: there is
 * no bracket there that would justify a growing entry (KONZEPT.md §3).
 */
export function modeFor(config: RepoConfig, branch: string, mainBranch: string, branchKey: string): EntryMode {
  if (branch === mainBranch) return 'commit'
  return config.modes.get(branchKey) ?? 'branch'
}

function readGrid(value: string | null): TimeGrid | null {
  if (!value || value === 'exact') return value === 'exact' ? { kind: 'exact' } : null
  const minutes = Number(value)
  return Number.isFinite(minutes) && minutes > 0 ? { kind: 'minutes', minutes } : null
}
