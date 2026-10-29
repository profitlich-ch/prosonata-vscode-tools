import * as vscode from 'vscode'

import type { RemoteEntry } from '../core/api.js'
import { t } from '../core/l10n.js'
import { planMerge, planRemoval, type MergePlan } from '../core/merge.js'
import { billedTime, hoursAndMinutes } from '../core/report.js'
import type { RepoContext, Session } from '../core/session.js'
import { hoursToSeconds, parseHours, type TimeGrid } from '../core/working-time.js'
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

export async function browseEntries(session: Session, context: RepoContext): Promise<void> {
  const found = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: t('ProSonata: fetching time entries') },
    async () => session.browse(context),
  )
  if (found.entries.length === 0) {
    void vscode.window.showInformationMessage(t('ProSonata: this project has no time entries yet.'))
    return
  }

  const grid = session.gridFor(context.scope.repoPath)
  const picked = await choose(found.entries, grid)
  if (!picked) return

  if ('edit' in picked) return editEntry(session, context, picked.edit, grid)
  if (picked.entries.length === 0) return
  if (picked.action === 'remove') return removeEntries(session, picked.entries)
  return mergeEntries(session, context, picked.entries, found.measured, grid)
}

type Choice = { action: 'merge' | 'remove'; entries: RemoteEntry[] } | { edit: RemoteEntry }

/**
 * The list itself. Returns what was ticked and which button was pressed.
 *
 * The buttons are made here, not once per module: their tooltips are
 * translated, and the language is only known once the extension is active.
 */
function choose(entries: RemoteEntry[], grid: TimeGrid): Promise<Choice | null> {
  const merge: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('merge'), tooltip: t('Merge selected') }
  const remove: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: t('Delete selected') }
  // Per row, because editing one entry has nothing to do with what is ticked.
  const edit: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('edit'), tooltip: t('Change text and hours') }

  const pick = vscode.window.createQuickPick<Row>()
  pick.title = t('ProSonata: time entries')
  pick.placeholder = t('Tick several, then merge or delete at the top right')
  pick.canSelectMany = true
  pick.matchOnDescription = true
  pick.buttons = [merge, remove]
  pick.items = entries.map((entry) => row(entry, grid, edit))

  return new Promise((resolve) => {
    pick.onDidTriggerButton((button) => {
      const chosen = pick.selectedItems.map((item) => item.entry)
      pick.hide()
      resolve(chosen.length === 0 ? null : { action: button === remove ? 'remove' : 'merge', entries: chosen })
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
    void vscode.window.showWarningMessage(t('ProSonata: the entry is invoiced — this can only be done in ProSonata now.'))
    return
  }

  const text = await vscode.window.showInputBox({
    title: t('ProSonata: entry #{0} from {1}', entry.timeID, entry.date),
    prompt: t('Text on the invoice'),
    value: entry.detail,
  })
  if (text === undefined) return

  /*
   * The field is filled with the billed time, not the measured seconds, and the
   * two need not agree: five minutes are 0.08 h on the exact grid, which reads
   * back as 0:04. Comparing seconds would therefore call an untouched field a
   * change and shave a minute off the entry. So the comparison is on the text:
   * what nobody typed, nobody meant to change.
   */
  const shown = billedTime(hoursToSeconds(entry.hours), grid)
  const given = await vscode.window.showInputBox({
    title: t('ProSonata: hours for #{0}', entry.timeID),
    prompt: t('Hours:minutes (1:30) or decimal hours (1.5)'),
    value: shown,
    validateInput: (value) => (parseHours(value) === null ? t('1:30 or 1.5') : undefined),
  })
  if (given === undefined) return

  if (text !== entry.detail) await session.api.updateEntry(entry.timeID, { detail: text })
  const seconds = parseHours(given)!
  if (given.trim() !== shown) await session.correctHours(entry, seconds, grid, context)

  void vscode.window.showInformationMessage(t('ProSonata: #{0} changed, {1} h.', entry.timeID, billedTime(seconds, grid)))
  reload()
}

function row(entry: RemoteEntry, grid: TimeGrid, edit: vscode.QuickInputButton): Row {
  const day = entry.date.slice(8, 10) + '.' + entry.date.slice(5, 7) + '.'
  const marks = entry.isInvoiced ? ` · ${t('invoiced')}` : ''
  return {
    label: entry.detail === '' ? t('(no text)') : entry.detail,
    description: `${billedTime(hoursToSeconds(entry.hours), grid)} h · ${day} · #${entry.timeID}${marks}`,
    buttons: entry.isInvoiced ? [] : [edit],
    entry,
  }
}

/** Deleting. What may go and what may not is decided in `planRemoval`. */
async function removeEntries(session: Session, entries: RemoteEntry[]): Promise<void> {
  const plan = planRemoval(entries)
  if (!plan) {
    void vscode.window.showWarningMessage(t('ProSonata: invoiced entries cannot be deleted here.'))
    return
  }

  const total = hoursAndMinutes(plan.seconds)
  const remove = t('Delete')
  const answer = await vscode.window.showWarningMessage(
    plan.invoiced.length > 0
      ? t('Delete {0} time entries, {1} in total? {2} invoiced ones stay.', plan.remove.length, total, plan.invoiced.length)
      : t('Delete {0} time entries, {1} in total?', plan.remove.length, total),
    { modal: true },
    remove,
  )
  if (answer !== remove) return

  for (const entry of plan.remove) await session.api.deleteEntry(entry.timeID)
  void vscode.window.showInformationMessage(t('ProSonata: {0} time entries deleted.', plan.remove.length))
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
    void vscode.window.showWarningMessage(t('ProSonata: merging needs two entries that are not invoiced.'))
    return
  }

  /*
   * The sum belongs in the first step, not only in the second: here is where
   * somebody decides whether to merge at all, and what lands on the invoice is
   * the number, not the text.
   */
  const proposed = plan.recomputedSeconds ?? plan.addedSeconds
  const text = await vscode.window.showInputBox({
    title: t('ProSonata: merge {0} entries into {1} h', plan.drop.length + 1, billedTime(proposed, grid)),
    prompt: t('Text of the merged entry — the hours come in the next step'),
    value: plan.text,
  })
  if (text === undefined) return

  const seconds = await askForHours(plan, proposed, grid)
  if (seconds === null) return

  await session.applyMerge(plan, seconds, text, grid)
  void vscode.window.showInformationMessage(
    t('ProSonata: merged into #{0}, {1} h, {2} entries deleted.', plan.keep.timeID, billedTime(seconds, grid), plan.drop.length),
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
async function askForHours(plan: MergePlan, proposed: number, grid: TimeGrid): Promise<number | null> {
  const note =
    plan.recomputedSeconds === null
      ? t('{0} added up from ProSonata — the segment log does not know all of these entries', hoursAndMinutes(plan.addedSeconds))
      : t('so far {0} in {1} entries, rounded once here', hoursAndMinutes(plan.addedSeconds), plan.drop.length + 1)

  const given = await vscode.window.showInputBox({
    title: t('ProSonata: hours for the merged entry ({0})', plan.date),
    prompt: note,
    value: billedTime(proposed, grid),
    validateInput: (value) => (parseHours(value) === null ? t('1:30 or 1.5') : undefined),
  })
  if (given === undefined) return null
  return parseHours(given)
}

