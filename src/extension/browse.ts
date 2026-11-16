import { randomBytes } from 'node:crypto'

import * as vscode from 'vscode'

import type { RemoteEntry } from '../core/api.js'
import { browseRows } from '../core/browse.js'
import type { BrowseData, MergePreview, ToHost, ToView } from '../core/browse-view.js'
import { activeStrings, t } from '../core/l10n.js'
import { planMerge, planRemoval, type MergePlan } from '../core/merge.js'
import type { RepoContext, Session } from '../core/session.js'
import { billedTime, hoursAndMinutes, hoursToSeconds, parseHours, type TimeGrid } from '../core/working-time.js'
import { decimalHours, projectLabel } from './panel.js'
import { budgetOf, currentContext, currentSession, extensionRoot, refreshBudget, reload } from './view.js'

/**
 * Looking at the time entries of this project and putting them right
 * (KONZEPT.md §3), as a table in an editor tab (docs/adr/0001).
 *
 * ProSonata shows the entries but not the branch they came from; this tool
 * knows the branch. The value is in the join — and in showing what a merge or a
 * correction comes to before it is written.
 *
 * **The webview only draws.** Rows arrive decided; what comes back is an
 * intention, and every intention that writes is checked against what ProSonata
 * holds *now*, fetched again — not against the rows on screen, which may be
 * minutes old. Extension, CLI and hooks write at the same time (CLAUDE.md).
 *
 * **Only this repository's project.** Everything else would cost a call per
 * project against a quota of fifty per quarter hour, for a list nobody can read.
 */

export async function browseEntries(session: Session, context: RepoContext): Promise<void> {
  if (!table) table = new EntryTable(session, context)
  else table.reveal()
  await table.load()
}

/**
 * Something reached ProSonata that the table may show: a closed entry was sent.
 * Called where the budget is refreshed for the same reason (watch.ts); a closed
 * table costs nothing, an open one one call.
 */
export function entriesChanged(): void {
  if (table) void table.load()
}

let table: EntryTable | null = null

class EntryTable {
  readonly #panel: vscode.WebviewPanel
  /** What the rows were made from — for a preview, which writes nothing. */
  #found: { entries: RemoteEntry[]; measured: Map<number, number> } | null = null
  /** The last `show`, for a webview that was rebuilt after its tab was hidden. */
  #shown: ToView | null = null
  /** The last preview, to tell whether a merge is still the one that was looked at. */
  #preview: { ids: string; plan: MergePlan } | null = null
  #busy = false

  constructor(
    private readonly session: Session,
    private readonly context: RepoContext,
  ) {
    // The bundle sits in dist/, so its parent is the extension.
    const root = extensionRoot() ?? vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..')
    const assets = vscode.Uri.joinPath(root, 'dist', 'webview')
    this.#panel = vscode.window.createWebviewPanel('prosonata.entries', t('ProSonata: time entries'), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [assets],
    })
    this.#panel.webview.html = page(this.#panel.webview, assets)
    this.#panel.webview.onDidReceiveMessage((message: ToHost) => void this.#receive(message))
    this.#panel.onDidDispose(() => {
      if (table === this) table = null
    })
  }

  reveal(): void {
    this.#panel.reveal()
  }

  /** Fetches the entries and draws them. One call to ProSonata. */
  async load(): Promise<void> {
    await this.#working(async () => {
      this.#found = await this.#active().session.browse(this.#active().context)
      this.#show()
    })
  }

  /** Session and context as they are now; the project may have been changed since the tab opened. */
  #active(): { session: Session; context: RepoContext } {
    return { session: currentSession() ?? this.session, context: currentContext() ?? this.context }
  }

  #grid(): TimeGrid {
    const { session, context } = this.#active()
    return session.gridFor(context.scope.repoPath)
  }

  #post(message: ToView): void {
    void this.#panel.webview.postMessage(message)
  }

  #show(): void {
    if (!this.#found) return
    const { session, context } = this.#active()
    const grid = this.#grid()
    const budget = budgetOf(context.projectId)
    const data: BrowseData = {
      project: projectLabel(
        context.config.projects.find((project) => project.id === context.projectId),
        context.projectId,
      ),
      budget: budget
        ? { ...budget, text: t('{0} of {1} h', decimalHours(budget.needed), decimalHours(budget.planned)) }
        : null,
      grid: grid.kind === 'exact' ? t('exact') : `${grid.minutes} min`,
      rows: browseRows(this.#found.entries, {
        measured: this.#found.measured,
        branches: session.branchesFor(context),
        markerWord: session.config.markerWord,
        grid,
      }),
    }
    this.#shown = { kind: 'show', locale: vscode.env.language, strings: activeStrings(), data }
    this.#post(this.#shown)
    // A budget is fetched once per window; this table may be the first to ask.
    // Once only: a project ProSonata does not list would otherwise cost a call per redraw.
    if (!budget && !this.#budgetAsked) {
      this.#budgetAsked = true
      void refreshBudget(session, context.projectId).then(() => budgetOf(context.projectId) && this.#show())
    }
  }

  #budgetAsked = false

  async #receive(message: ToHost): Promise<void> {
    switch (message.kind) {
      case 'ready':
        if (this.#shown) this.#post(this.#shown)
        return
      case 'refresh':
        return this.load()
      case 'preview':
        return this.#sendPreview(message.ids)
      case 'edit':
        return this.#working(() => this.#edit(message.timeID, message.field, message.value))
      case 'merge':
        return this.#working(() => this.#merge(message.ids, message.text, message.hours))
      case 'remove':
        return this.#working(() => this.#remove(message.ids))
    }
  }

  /**
   * One write at a time, and the table says so. A second click while ProSonata
   * is still answering would plan against entries the first is changing.
   */
  async #working(work: () => Promise<void>): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    this.#post({ kind: 'busy', busy: true })
    try {
      await work()
    } catch (error) {
      this.#post({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#busy = false
      this.#post({ kind: 'busy', busy: false })
    }
  }

  /**
   * The entries behind these ids as ProSonata holds them now. Null, with the
   * table redrawn, when one of them is gone: merged or deleted elsewhere.
   */
  async #fresh(ids: number[]): Promise<RemoteEntry[] | null> {
    const { session, context } = this.#active()
    this.#found = await session.browse(context)
    const entries = this.#found.entries
    const chosen = ids.map((id) => entries.find((entry) => entry.timeID === id))
    if (chosen.every((entry): entry is RemoteEntry => entry !== undefined)) return chosen
    this.#post({ kind: 'failed', message: t('ProSonata: an entry is no longer there — the list shows what ProSonata holds now.') })
    this.#show()
    return null
  }

  #sendPreview(ids: number[]): void {
    const entries = ids.flatMap((id) => this.#found?.entries.filter((entry) => entry.timeID === id) ?? [])
    const grid = this.#grid()
    const plan = planMerge(entries, this.#found?.measured ?? new Map(), grid)
    this.#preview = plan ? { ids: key(ids), plan } : null
    this.#post({ kind: 'preview', ids, preview: plan ? describe(plan, ids, grid) : null })
  }

  /**
   * Changing one entry's text or hours.
   *
   * This bends the promise `close` makes — a closed `timeID` is never written
   * to again, so corrections made in ProSonata survive. It is bent the same way
   * adding follow-up time bends it: a person decides, once, for one entry
   * (KONZEPT.md §3). The hours go into the segment log as a correction, or the
   * report and ProSonata would drift apart.
   */
  async #edit(timeID: number, field: 'text' | 'hours', value: string): Promise<void> {
    const [entry] = (await this.#fresh([timeID])) ?? []
    if (!entry) return
    if (entry.isInvoiced) {
      // Not at the cell: the redraw below takes the field away, an invoiced row has none.
      this.#post({ kind: 'failed', message: t('ProSonata: the entry is invoiced — this can only be done in ProSonata now.') })
      this.#show()
      return
    }

    const { session, context } = this.#active()
    const grid = this.#grid()
    if (field === 'text') {
      if (value !== entry.detail) await session.retext(entry.timeID, value)
      void vscode.window.showInformationMessage(t('ProSonata: #{0} changed, {1} h.', entry.timeID, billedTime(hoursToSeconds(entry.hours), grid)))
    } else {
      const seconds = parseHours(value)
      if (seconds === null) {
        this.#post({ kind: 'failed', timeID, field, message: t('1:30 or 1.5') })
        return
      }
      /*
       * Compared as text, not as seconds: five minutes are 0.08 h on the exact
       * grid, which reads back as 0:04, so comparing seconds would call an
       * untouched field a change and shave a minute off the entry. What nobody
       * typed, nobody meant to change.
       */
      if (value.trim() !== billedTime(hoursToSeconds(entry.hours), grid)) {
        await session.correctHours(entry, seconds, grid, context)
      }
      void vscode.window.showInformationMessage(t('ProSonata: #{0} changed, {1} h.', entry.timeID, billedTime(seconds, grid)))
    }

    this.#post({ kind: 'saved', timeID })
    reload()
    await this.#reloadAfterWrite()
  }

  /**
   * Merging. The text and the hours come from the form under the table, with
   * the number that treats the whole thing as **one** piece of work, because
   * that is what merging declares (KONZEPT.md §3).
   *
   * The plan is made again from fresh entries, and has to be the plan that was
   * on screen. If hours moved in between, the number someone typed was typed
   * against a different sum — so the table shows the new one and writes nothing.
   */
  async #merge(ids: number[], text: string, hours: string): Promise<void> {
    const shown = this.#preview?.ids === key(ids) ? this.#preview.plan : null
    const entries = await this.#fresh(ids)
    if (!entries) return

    const grid = this.#grid()
    const plan = planMerge(entries, this.#found?.measured ?? new Map(), grid)
    if (!plan) {
      this.#post({ kind: 'failed', message: t('ProSonata: merging needs two entries that are not invoiced.') })
      this.#show()
      return
    }
    if (!shown || !samePlan(shown, plan)) {
      this.#post({ kind: 'failed', message: t('ProSonata: the entries changed in the meantime — check the merge again.') })
      this.#show()
      this.#sendPreview(ids)
      return
    }
    const seconds = parseHours(hours)
    if (seconds === null) {
      this.#post({ kind: 'failed', message: t('1:30 or 1.5') })
      return
    }

    await this.#active().session.applyMerge(plan, seconds, text, grid)
    void vscode.window.showInformationMessage(
      t('ProSonata: merged into #{0}, {1} h, {2} entries deleted.', plan.keep.timeID, billedTime(seconds, grid), plan.drop.length),
    )
    this.#post({ kind: 'merged' })
    reload()
    await this.#reloadAfterWrite()
  }

  /**
   * Deleting. What may go and what may not is decided in `planRemoval`; the
   * question stays a modal dialog of VS Code, so it looks like every other
   * question that cannot be taken back.
   */
  async #remove(ids: number[]): Promise<void> {
    const entries = await this.#fresh(ids)
    if (!entries) return
    const plan = planRemoval(entries)
    if (!plan) {
      this.#post({ kind: 'failed', message: t('ProSonata: invoiced entries cannot be deleted here.') })
      this.#show()
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

    const { session } = this.#active()
    for (const entry of plan.remove) await session.api.deleteEntry(entry.timeID)
    void vscode.window.showInformationMessage(t('ProSonata: {0} time entries deleted.', plan.remove.length))
    reload()
    await this.#reloadAfterWrite()
  }

  /** Inside `#working` already, so not through `load`, which would refuse while busy. */
  async #reloadAfterWrite(): Promise<void> {
    const { session, context } = this.#active()
    this.#found = await session.browse(context)
    this.#show()
  }
}

/** The ids of a selection as one comparable value, in whatever order they were ticked. */
function key(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(',')
}

/** Whether two plans would write the same: the same entries, the same sums. */
function samePlan(a: MergePlan, b: MergePlan): boolean {
  const ids = (plan: MergePlan) => key([plan.keep.timeID, ...plan.drop.map((entry) => entry.timeID)])
  return ids(a) === ids(b) && a.addedSeconds === b.addedSeconds && a.recomputedSeconds === b.recomputedSeconds
}

/**
 * A plan as the table shows it. The note says why the proposal is the number
 * it is: where the log covers everything, the work rounded once; where it does
 * not, the sum of what ProSonata holds — and the smaller number is left out
 * rather than shown with a caveat nobody reads.
 */
function describe(plan: MergePlan, ids: number[], grid: TimeGrid): MergePreview {
  const proposed = plan.recomputedSeconds ?? plan.addedSeconds
  return {
    ids,
    keep: plan.keep.timeID,
    drop: plan.drop.map((entry) => ({
      timeID: entry.timeID,
      date: entry.date,
      hours: billedTime(hoursToSeconds(entry.hours), grid),
    })),
    added: billedTime(plan.addedSeconds, grid),
    recomputed: plan.recomputedSeconds === null ? null : billedTime(plan.recomputedSeconds, grid),
    proposed: billedTime(proposed, grid),
    text: plan.text,
    date: plan.date,
    note:
      plan.recomputedSeconds === null
        ? t('{0} added up from ProSonata — the segment log does not know all of these entries', hoursAndMinutes(plan.addedSeconds))
        : t('so far {0} in {1} entries, rounded once here', hoursAndMinutes(plan.addedSeconds), plan.drop.length + 1),
  }
}

/**
 * The page around the bundle. Scripts only with the nonce, styles only from
 * the extension's own folder: a text from ProSonata that carried markup would
 * be escaped by Svelte, and if it ever were not, it still could not run.
 */
function page(webview: vscode.Webview, assets: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64')
  const script = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'browse.js'))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'browse.css'))
  const policy = [`default-src 'none'`, `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`, `font-src ${webview.cspSource}`].join('; ')
  return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}
