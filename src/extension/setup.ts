import * as vscode from 'vscode'

import { inProsonataOrder, type Category, type Project } from '../core/api.js'
import { configWith, MissingConfig, paths, readConfig, writeConfig } from '../core/config.js'
import { type GitRepo } from '../core/git.js'
import { hookNeedsRepair, installHook } from '../core/hooks.js'
import { readRepoConfig, rememberCategory, rememberProject, setGrid } from '../core/repo-config.js'
import { applyCategory, applyProject } from '../core/tracking.js'
import type { Session } from '../core/session.js'
import type { TimeGrid } from '../core/working-time.js'
import { currentContext, currentSession, extensionRoot, refreshBudget, reload, resetSession } from './view.js'

/** Setting up the account, the project, the category and the grid (KONZEPT.md §6). */

/**
 * Sets up the account from inside the editor, so the terminal is never needed.
 * The key goes to ~/.prosonata/config.json with mode 0600 — not to VS Code's
 * SecretStorage, which the hook could not read (KONZEPT.md §7).
 */
export async function setUpAccount(): Promise<void> {
  const known = readIfPresent()
  const baseUrl = await vscode.window.showInputBox({
    title: 'ProSonata: Basis-URL',
    prompt: 'Bis und mit /api/v1',
    placeHolder: 'https://<subdomain>.prosonata.software/api/v1',
    value: known?.baseUrl ?? '',
    ignoreFocusOut: true,
  })
  if (baseUrl === undefined) return

  const apiKey = await vscode.window.showInputBox({
    title: 'ProSonata: persönlicher API-Key',
    prompt: known
      ? 'Leer lassen behält den bisherigen Key'
      : 'Ein Benutzer-Key, keine App-Integration — eine Integration ist kein Benutzer',
    password: true,
    ignoreFocusOut: true,
  })
  if (apiKey === undefined) return
  if (apiKey.trim() === '' && !known) {
    void vscode.window.showWarningMessage('ProSonata: ohne API-Key lässt sich nichts einrichten.')
    return
  }

  writeConfig(configWith(known, { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || known!.apiKey }))
  resetSession()
  reload()
  void vscode.window.showInformationMessage(
    `ProSonata: nach ${paths.config()} geschrieben. Wähle jetzt ein Projekt für dieses Repository.`,
  )
  await vscode.commands.executeCommand('prosonata.chooseProject')
}

function readIfPresent() {
  try {
    return readConfig()
  } catch {
    return null
  }
}

export async function chooseProject(session: Session, repo: GitRepo): Promise<void> {
  const projects = await session.api.listProjects()
  const known = new Set(readRepoConfig(repo.root).projects.map((project) => project.id))

  const picked = await vscode.window.showQuickPick(
    [
      ...projects.filter((project) => known.has(project.projectID)),
      ...projects.filter((project) => !known.has(project.projectID)),
    ].map((project) => ({
      label: project.projectName,
      description: project.projectNo,
      detail: `${project.customerName} · ${project.timeNeeded} von ${project.timePlanned} h`,
      project,
    })),
    { title: 'ProSonata: Projekt für dieses Repository', matchOnDescription: true, matchOnDetail: true },
  )
  if (!picked) return

  rememberProject(repo.root, { id: picked.project.projectID, name: picked.project.projectName, no: picked.project.projectNo })

  // Without this the hook would only appear at the next window start, and the
  // commits in between would book nothing.
  installHookHere(repo.root)

  // Choosing a project is a correction of a mistake: time already measured
  // belongs to this work, not to the project picked by accident. Everything
  // unfinished moves along, including what ProSonata already knows.
  const remembered = readRepoConfig(repo.root).categories.get(picked.project.projectID) ?? 0
  session.store.update((state) =>
    applyProject(state, repo.root, picked.project.projectID, remembered, session.clock.now()),
  )

  // A project without a category books nothing either: ProSonata requires one.
  // Asking right here keeps the editor route as complete as "prosonata init".
  if (remembered <= 0) await chooseCategory(session, repo, picked.project)
}

/**
 * The category belongs to the timer, not to the repository (KONZEPT.md §6): it
 * changes within the same project, so the last choice stays and starting is one
 * click. Remembered per project, because maintenance is booked differently from
 * feature work.
 */
export async function chooseCategory(session: Session, repo: GitRepo, project?: Project): Promise<void> {
  const config = readRepoConfig(repo.root)
  const projectId = project?.projectID ?? config.activeProjectId
  if (projectId === null) {
    await chooseProject(session, repo)
    return
  }

  // The list is global; only the customer of the active project narrows it.
  const customerId = project?.customerID ?? (await session.api.listProjects()).find((candidate) => candidate.projectID === projectId)?.customerID
  const categories = (await session.api.listCategories()).filter(
    (category) => category.linkedCustomerID === null || category.linkedCustomerID === customerId,
  )
  if (categories.length === 0) {
    void vscode.window.showWarningMessage('ProSonata: dieses Konto hat keine aktiven Zeitkategorien.')
    return
  }

  const current = config.categories.get(projectId)
  const picked = await vscode.window.showQuickPick(
    groupedItems(categories, current),
    { title: `ProSonata: Zeitkategorie für ${project?.projectName ?? config.projects.find((p) => p.id === projectId)?.name ?? `#${projectId}`}` },
  )
  if (!picked?.category) return

  rememberCategory(repo.root, projectId, picked.category.category, picked.category.categoryName)
  session.store.update((state) => applyCategory(state, repo.root, projectId, picked.category!.category, session.clock.now()))
}

/**
 * The categories under their group, the way a `<select>` groups its options: a
 * separator item is a heading VS Code draws but never lets anyone select.
 *
 * The order is ProSonata's own — `group` orders the groups, `categoryOrder`
 * orders inside one. Sorting the group names alphabetically would look tidy and
 * be a different list than the one the customer knows. Headings appear only
 * where there is something to head; an account without groups keeps a plain
 * list instead of one heading over everything.
 */
function groupedItems(categories: Category[], current: number | undefined): (vscode.QuickPickItem & { category?: Category })[] {
  const sorted = inProsonataOrder(categories)
  const grouped = sorted.some((category) => category.groupName !== null)

  const items: (vscode.QuickPickItem & { category?: Category })[] = []
  let group: string | null | undefined
  for (const category of sorted) {
    if (grouped && category.groupName !== group) {
      group = category.groupName
      items.push({ label: group ?? 'Ohne Gruppe', kind: vscode.QuickPickItemKind.Separator })
    }
    items.push({
      label: category.categoryName,
      description: category.category === current ? 'aktuell' : '',
      category,
    })
  }
  return items
}

export function installHookHere(repoRoot: string): void {
  const cli = vscode.Uri.joinPath(extensionRoot()!, 'dist', 'cli.cjs').fsPath
  try {
    installHook(repoRoot, { node: process.execPath, cli })
  } catch (error) {
    void vscode.window.showWarningMessage(`ProSonata: der post-commit-Hook konnte nicht installiert werden — ${(error as Error).message}`)
  }
}

export async function chooseGrid(_session: Session, repo: GitRepo): Promise<void> {
  const options: { label: string; grid: TimeGrid }[] = [
    { label: 'exakt', grid: { kind: 'exact' } },
    { label: '5 Minuten', grid: { kind: 'minutes', minutes: 5 } },
    { label: '15 Minuten', grid: { kind: 'minutes', minutes: 15 } },
    { label: '30 Minuten', grid: { kind: 'minutes', minutes: 30 } },
  ]
  const picked = await vscode.window.showQuickPick(options, { title: 'ProSonata: Zeitraster' })
  if (picked) setGrid(repo.root, picked.grid)
}

export function repairHookIfNeeded(context: vscode.ExtensionContext): void {
  const repo = currentContext()
  if (!repo) return

  const cli = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.cjs').fsPath
  if (!hookNeedsRepair(repo.repo.root, { node: process.execPath, cli })) return

  try {
    installHook(repo.repo.root, { node: process.execPath, cli })
  } catch {
    void vscode.window.showWarningMessage('ProSonata: der post-commit-Hook konnte nicht repariert werden.')
  }
}
