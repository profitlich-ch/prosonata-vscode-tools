import * as vscode from 'vscode'

import type { RemoteEntry } from '../core/api.js'
import { planMerge, type MergePlan } from '../core/merge.js'
import { billedTime, hoursAndMinutes } from '../core/report.js'
import type { RepoContext, Session } from '../core/session.js'
import { hoursToSeconds, type TimeGrid } from '../core/working-time.js'
import { reload } from './view.js'

/**
 * Looking at the time entries of this project and putting them right
 * (KONZEPT.md §3).
 *
 * ProSonata shows the entries but not the branch they came from; this tool
 * knows the branch but never showed the entries. The value is in the join —
 * before this, finding a duplicate meant reading two screens against each other.
 *
 * A QuickPick, not a webview: it does multi-select and buttons on its own, takes
 * the user's colour theme, is reachable from the keyboard and searches every row
 * without anybody writing a filter. A table with columns would beat it for
 * looking across many rows at once; that is a separate question, not a reason to
 * build one here.
 *
 * **Only this repository's project.** Everything else would cost a call per
 * project against a quota of fifty per quarter hour, for a list nobody can read.
 */

type Row = vscode.QuickPickItem & { entry: RemoteEntry }

const MERGE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('merge'),
  tooltip: 'Gewählte zusammenlegen',
}

const REMOVE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('trash'),
  tooltip: 'Gewählte löschen',
}

/** Per row, because editing one entry has nothing to do with what is ticked. */
const EDIT: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('edit'),
  tooltip: 'Text und Stunden ändern',
}

export async function browseEntries(session: Session, context: RepoContext): Promise<void> {
  const found = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'ProSonata: Zeiteinträge werden geholt' },
    async () => session.browse(context),
  )
  if (found.entries.length === 0) {
    void vscode.window.showInformationMessage('ProSonata: für dieses Projekt gibt es noch keine Zeiteinträge.')
    return
  }

  const grid = session.gridFor(context.scope.repoPath)
  const picked = await choose(found.entries, grid)
  if (!picked) return

  if ('edit' in picked) return editEntry(session, context, picked.edit, grid)
  if (picked.entries.length === 0) return
  if (picked.button === REMOVE) return removeEntries(session, picked.entries)
  return mergeEntries(session, context, picked.entries, found.measured, grid)
}

type Choice = { button: vscode.QuickInputButton; entries: RemoteEntry[] } | { edit: RemoteEntry }

/** The list itself. Returns what was ticked and which button was pressed. */
function choose(entries: RemoteEntry[], grid: TimeGrid): Promise<Choice | null> {
  const pick = vscode.window.createQuickPick<Row>()
  pick.title = 'ProSonata: Zeiteinträge'
  pick.placeholder = 'Mehrere ankreuzen, dann oben rechts zusammenlegen oder löschen'
  pick.canSelectMany = true
  pick.matchOnDescription = true
  pick.buttons = [MERGE, REMOVE]
  pick.items = entries.map((entry) => row(entry, grid))

  return new Promise((resolve) => {
    pick.onDidTriggerButton((button) => {
      const chosen = pick.selectedItems.map((item) => item.entry)
      pick.hide()
      resolve(chosen.length === 0 ? null : { button, entries: chosen })
    })
    pick.onDidTriggerItemButton((event) => {
      pick.hide()
      resolve({ edit: event.item.entry })
    })
    pick.onDidHide(() => {
      pick.dispose()
      resolve(null)
    })
    pick.show()
  })
}

/**
 * Changing one entry's text and hours.
 *
 * This bends the promise `close` makes — a closed `timeID` is never written to
 * again, so corrections made in ProSonata survive. It is bent the same way
 * adding follow-up time bends it: a person decides, once, for one entry
 * (KONZEPT.md §3). The hours go into the segment log as a correction, or the
 * report and ProSonata would drift apart.
 */
async function editEntry(
  session: Session,
  context: RepoContext,
  entry: RemoteEntry,
  grid: TimeGrid,
): Promise<void> {
  if (entry.isInvoiced) {
    void vscode.window.showWarningMessage('ProSonata: der Eintrag ist fakturiert — das geht nur noch in ProSonata.')
    return
  }

  const text = await vscode.window.showInputBox({
    title: `ProSonata: Eintrag #${entry.timeID} vom ${entry.date}`,
    prompt: 'Text auf der Rechnung',
    value: entry.detail,
  })
  if (text === undefined) return

  const before = hoursToSeconds(entry.hours)
  const given = await vscode.window.showInputBox({
    title: `ProSonata: Stunden für #${entry.timeID}`,
    prompt: 'Stunden:Minuten, etwa 1:30',
    value: billedTime(before, grid),
    validateInput: (value) => (parseSpan(value) === null ? 'Stunden:Minuten, etwa 1:30' : undefined),
  })
  if (given === undefined) return
  const seconds = parseSpan(given)!

  if (text !== entry.detail) await session.api.updateEntry(entry.timeID, { detail: text })
  if (seconds !== before) await session.correctHours(entry, seconds, grid, context)

  void vscode.window.showInformationMessage(`ProSonata: #${entry.timeID} geändert.`)
  reload()
}

function row(entry: RemoteEntry, grid: TimeGrid): Row {
  const day = entry.date.slice(8, 10) + '.' + entry.date.slice(5, 7) + '.'
  const marks = entry.isInvoiced ? ' · fakturiert' : ''
  return {
    label: entry.detail === '' ? '(ohne Text)' : entry.detail,
    description: `${billedTime(hoursToSeconds(entry.hours), grid)} h · ${day} · #${entry.timeID}${marks}`,
    buttons: entry.isInvoiced ? [] : [EDIT],
    entry,
  }
}

/**
 * Deleting. Invoiced entries are refused rather than silently skipped — a list
 * that quietly does less than it says is worse than one that explains itself.
 */
async function removeEntries(session: Session, entries: RemoteEntry[]): Promise<void> {
  const invoiced = entries.filter((entry) => entry.isInvoiced)
  const removable = entries.filter((entry) => !entry.isInvoiced)
  if (removable.length === 0) {
    void vscode.window.showWarningMessage('ProSonata: fakturierte Einträge lassen sich hier nicht löschen.')
    return
  }

  const hours = removable.reduce((sum, entry) => sum + entry.hours, 0)
  const answer = await vscode.window.showWarningMessage(
    `${removable.length} Zeiteinträge löschen, zusammen ${hours.toFixed(2)} h?` +
      (invoiced.length > 0 ? ` ${invoiced.length} fakturierte bleiben stehen.` : ''),
    { modal: true },
    'Löschen',
  )
  if (answer !== 'Löschen') return

  for (const entry of removable) await session.api.deleteEntry(entry.timeID)
  void vscode.window.showInformationMessage(`ProSonata: ${removable.length} Zeiteinträge gelöscht.`)
  reload()
}

/**
 * Merging. The text comes prefilled and stays editable, and so do the hours —
 * with the number that treats the whole thing as **one** piece of work, because
 * that is what merging declares (KONZEPT.md §3).
 */
async function mergeEntries(
  session: Session,
  context: RepoContext,
  entries: RemoteEntry[],
  measured: Map<number, number>,
  grid: TimeGrid,
): Promise<void> {
  const plan = planMerge(entries, measured, grid)
  if (!plan) {
    void vscode.window.showWarningMessage(
      'ProSonata: zum Zusammenlegen braucht es zwei Einträge, die nicht fakturiert sind.',
    )
    return
  }

  const text = await vscode.window.showInputBox({
    title: `ProSonata: ${plan.drop.length + 1} Einträge zusammenlegen`,
    prompt: 'Text des zusammengelegten Eintrags',
    value: plan.text,
  })
  if (text === undefined) return

  const seconds = await askForHours(plan, grid)
  if (seconds === null) return

  await session.applyMerge(plan, seconds, text, grid)
  void vscode.window.showInformationMessage(
    `ProSonata: zu #${plan.keep.timeID} zusammengelegt, ${billedTime(seconds, grid)} h, ` +
      `${plan.drop.length} Einträge gelöscht.`,
  )
  reload()
}

/**
 * The hours, prefilled with the honest number and editable.
 *
 * Where the log covers everything, the proposal is the work rounded once. Where
 * it does not, the sum of what ProSonata holds is proposed — and the line that
 * would have offered the smaller number is left out rather than shown with a
 * caveat nobody reads.
 */
async function askForHours(plan: MergePlan, grid: TimeGrid): Promise<number | null> {
  const proposed = plan.recomputedSeconds ?? plan.addedSeconds
  const note =
    plan.recomputedSeconds === null
      ? 'aus ProSonata addiert — das Segmentprotokoll kennt nicht alle diese Einträge'
      : `bisher ${hoursAndMinutes(plan.addedSeconds)} in ${plan.drop.length + 1} Einträgen, hier einmal gerundet`

  const given = await vscode.window.showInputBox({
    title: `ProSonata: Stunden für den zusammengelegten Eintrag (${plan.date})`,
    prompt: note,
    value: billedTime(proposed, grid),
    validateInput: (value) => (parseSpan(value) === null ? 'Stunden:Minuten, etwa 1:30' : undefined),
  })
  if (given === undefined) return null
  return parseSpan(given)
}

/** `1:30` as seconds. Null when it is not that. */
function parseSpan(value: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60
}
