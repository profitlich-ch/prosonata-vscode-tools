import { basename } from 'node:path'
import * as vscode from 'vscode'

import { paths } from '../core/config.js'
import { isInstalled, publishedCli } from '../core/hooks.js'
import { t } from '../core/l10n.js'
import { describeRejection } from '../core/sender.js'
import {
  awaitingDecision,
  currentSeconds,
  lastClosedEntry,
  openEntriesIn,
  openEntry,
  rejectedEntries,
  restingEntries,
  runningSeconds,
  sameScope,
  unwrittenSeconds,
} from '../core/tracking.js'
import type { RepoProject } from '../core/repo-config.js'
import type { RepoContext, Session } from '../core/session.js'
import type { State, TimeEntry } from '../core/types.js'
import { billedTime, hoursAndMinutes } from '../core/report.js'

/**
 * The panel in the side bar (KONZEPT.md §8). A TreeDataProvider, not a webview:
 * native widgets, no UI code of our own.
 *
 * It shows what changes rarely — project, grid, branch mode — and what one
 * wants to see while working: the running timer and the open entries with their
 * age. Clicking a row opens the matching QuickPick.
 *
 * The rows are this branch as it stands right now. Looking back over every
 * branch ever measured is another kind of thing and sits in the view's title
 * bar, where VS Code puts what acts on the view rather than on a row.
 */

export class PanelRow extends vscode.TreeItem {
  constructor(
    label: string,
    detail: string,
    icon: string,
    command?: vscode.Command,
    context?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.description = detail
    this.iconPath = new vscode.ThemeIcon(icon)
    if (command) this.command = command
    if (context) this.contextValue = context
  }
}

/** Hours a project has planned and used up, as the last look reported them. */
export interface Budget {
  needed: number
  planned: number
}

export class Panel implements vscode.TreeDataProvider<PanelRow> {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  constructor(
    /** Null while there is no account yet — the panel then says so. */
    private readonly session: () => Session | null,
    private readonly context: () => RepoContext | null,
    /** The cached state. The panel never reads from disk itself. */
    private readonly snapshot: () => State | null,
    /** Likewise the budget: it is fetched elsewhere, never from here. */
    private readonly budget: (projectId: number) => Budget | undefined,
  ) {}

  refresh(): void {
    this.changed.fire()
  }

  getTreeItem(row: PanelRow): vscode.TreeItem {
    return row
  }

  getChildren(): PanelRow[] {
    // Nothing to show means nothing at all: an empty tree is what makes VS Code
    // display the welcome content from `contributes.viewsWelcome`, which can
    // carry real buttons instead of rows that only look like data.
    const session = this.session()
    const context = this.context()
    const state = this.snapshot()
    if (!session || !context || !state) return []
    const project = context.config.projects.find((candidate) => candidate.id === context.projectId)
    const timer = state.timers.find((candidate) => candidate.scope.repoPath === context.scope.repoPath && candidate.scope.branch === context.scope.branch)
    const entry = openEntry(state, context.scope)
    const grid = context.config.grid ?? session.config.grid

    const rows: PanelRow[] = [
      // With the number: that is what a customer call and an invoice refer to,
      // and two projects of the same name are told apart by nothing else.
      new PanelRow(t('Project'), describeProject(project, context.projectId, this.budget(context.projectId)), 'briefcase', {
        command: 'prosonata.chooseProject',
        title: t('Choose project'),
      }),
      // A ruler, not a clock: the row is about the measure things are rounded
      // to. A clock already stands for the timer two rows down.
      new PanelRow(t('Rounding grid'), grid.kind === 'exact' ? t('exact') : `${grid.minutes} min`, 'symbol-ruler', {
        command: 'prosonata.chooseGrid',
        title: t('Choose rounding grid'),
      }),
      new PanelRow('Branch', context.scope.branch, 'git-branch'),
      /*
       * Its own row, not appended to the branch name: names like
       * `167-startseite-mobile-tablet-expertise-layout` push everything behind
       * them out of a side bar, and this is the setting that decides what ends
       * up on the invoice. On the main branch it is fixed to per commit and
       * therefore not clickable (KONZEPT.md §3).
       */
      new PanelRow(
        t('Time entry'),
        context.mode === 'branch' ? t('per branch') : t('per commit'),
        // `clockface`, not `clock`: the latter is an alias for `history`, which
        // the log in the title bar already uses.
        'clockface',
        context.scope.branch === context.mainBranch
          ? undefined
          : { command: 'prosonata.toggleMode', title: t('Switch between per branch and per commit') },
      ),
      // Directly above the timer: the category belongs to the work that is about
      // to run, and without one ProSonata refuses the entry.
      new PanelRow(
        t('Category'),
        context.categoryId > 0
          ? context.config.categoryNames.get(context.projectId) ?? `#${context.categoryId}`
          : t('none — nothing will be sent'),
        'tag',
        { command: 'prosonata.chooseCategory', title: t('Choose category') },
      ),
    ]

    /*
     * Both numbers, in this order: the running segment first, then everything
     * the branch has collected. They answer two different questions — "how long
     * have I been at this stretch" and "what will be invoiced" — and only the
     * first one shows a timer that was forgotten.
     */
    const running = runningSeconds(state, session.clock, context.scope)
    const total = currentSeconds(state, session.clock, context.scope)
    rows.push(
      new PanelRow(
        timer?.startedAt ? t('Running') : t('Paused'),
        `${clock(running)} · ${clock(total)}${entry?.text ? ` · ${entry.text}` : ''}`,
        timer?.startedAt ? 'debug-pause' : 'play',
        { command: timer?.startedAt ? 'prosonata.pause' : 'prosonata.start', title: t('Start or pause') },
        // Named so the inline action for correcting time can attach to it.
        'timer',
      ),
    )

    /*
     * An entry without a text does reach ProSonata — under the placeholder — but
     * that is a stand-in, not the line a customer should read. On a branch only
     * a trailer or a hand-typed text ever replaces it, so the row keeps asking.
     * Per commit it would only nag: the next commit brings the text along.
     */
    if (context.mode === 'branch' && entry && entry.text === '' && unwrittenSeconds(entry) > 0) {
      rows.push(
        new PanelRow(
          t('Without text'),
          t('{0} h — shown as «{1}» in ProSonata', hoursAndMinutes(unwrittenSeconds(entry)), session.config.placeholderText),
          'warning',
          { command: 'prosonata.changeText', title: t('Set text') },
        ),
      )
    }

    /*
     * Time with nowhere to go yet: measured after a commit closed its entry, and
     * no new commit has claimed it. It would travel with the next one — under
     * that commit's text. Whoever worked on after the commit can say otherwise
     * here. The condition is read from the state alone; the panel asks nothing
     * of ProSonata.
     */
    if (entry && entry.text === '' && unwrittenSeconds(entry) > 0 && lastClosedEntry(state, context.scope)) {
      rows.push(
        new PanelRow(
          t('Not booked'),
          t('{0} h → last entry', hoursAndMinutes(unwrittenSeconds(entry))),
          'fold-up',
          { command: 'prosonata.attachToLast', title: t('Attach to the last entry') },
        ),
      )
    }

    /*
     * A branch that is merged or deleted while its entry is still open. Checked
     * for every branch of the repository, not only this one: after a squash merge
     * one stands on main, and the entry of the deleted branch would otherwise stay
     * open unnoticed (KONZEPT.md §3, *Abschluss*). A suggestion — the click asks
     * for the final text, nothing closes on its own.
     */
    const finished = session.finished.filter(({ entry: done }) => {
      const now = state.entries.find((candidate) => candidate.id === done.id)
      return now?.state === 'open' && now.scope.repoPath === context.scope.repoPath
    })
    for (const { entry: done, why } of finished) {
      rows.push(
        new PanelRow(
          why === 'deleted' ? t('Branch deleted · {0}', done.scope.branch) : t('Branch merged · {0}', done.scope.branch),
          t('{0} · {1} h — close', done.text || t('(no text)'), billedTime(done.foreignSeconds + done.seconds, grid)),
          'pass',
          { command: 'prosonata.closeEntry', title: t('Close entry'), arguments: [done.id] },
        ),
      )
    }
    const finishedIds = new Set(finished.map(({ entry: done }) => done.id))

    // Each entry in one row only: a finished branch says more than a resting one,
    // and both say more than «open».
    const now = session.clock.now()
    const resting = restingEntries(state, now, session.config.restingDays).filter((entry) => !finishedIds.has(entry.id))
    const restingIds = new Set(resting.map((entry) => entry.id))

    // Only this working directory: an open entry of another project is none of
    // this panel's business, and the label `Offen · <branch>` would read like a
    // branch of the repository one is looking at.
    for (const open of openEntriesIn(state, context.scope.repoPath).filter(
      (candidate) => candidate.text !== '' && !finishedIds.has(candidate.id) && !restingIds.has(candidate.id),
    )) {
      rows.push(
        new PanelRow(
          open.scope.branch === context.scope.branch ? t('Open entry') : t('Open · {0}', open.scope.branch),
          `${open.text} · ${billedTime(open.foreignSeconds + open.seconds, grid)} h${elsewhere(open)}`,
          'circle-outline',
          { command: 'prosonata.closeEntry', title: t('Close entry'), arguments: [open.id] },
          'openEntry',
        ),
      )
    }

    for (const parked of awaitingDecision(state, context.scope)) {
      rows.push(
        new PanelRow(
          t('Closed elsewhere'),
          t('{0} open — decide', clock(unwrittenSeconds(parked))),
          'question',
          { command: 'prosonata.resolveClosedElsewhere', title: t('Decide') },
        ),
      )
    }

    /*
     * The machine slept while the clock ran. The row waits rather than a
     * notification: whoever comes back to a woken machine finds it here, and a
     * popup fired while nobody was there is gone by then (KONZEPT.md §3).
     */
    const gaps = session.openSleepGaps()
    if (gaps.length > 0) {
      const slept = session.sleptSeconds()
      const since = new Date(gaps[0]!.from)
      rows.push(
        new PanelRow(
          t('Machine slept'),
          t('{0} from {1} — subtract?', clock(slept), since.toTimeString().slice(0, 5)),
          'debug-disconnect',
          { command: 'prosonata.resolveSleep', title: t('Decide on sleep time') },
        ),
      )
    }

    /*
     * Refused by ProSonata, from every repository — not only this one. On
     * 26 October 2026 the stuck entries belonged to another repository, and the
     * only trace here was a count that would not go down (KONZEPT.md §4).
     */
    for (const refused of rejectedEntries(state)) {
      const here = sameScope(refused.scope, context.scope)
      // From the cached config only: the panel redraws every second, and reading
      // another repository's would cost a handful of `git` processes each time.
      // Elsewhere the project shows by its id; the action names it in full.
      const project =
        refused.scope.repoPath === context.scope.repoPath
          ? context.config.projects.find((candidate) => candidate.id === refused.projectId)
          : undefined
      rows.push(
        new PanelRow(
          here ? t('Rejected') : t('Rejected · {0}/{1}', basename(refused.scope.repoPath), refused.scope.branch),
          `${refused.text ? `${refused.text} — ` : ''}${describeRejection(refused, project)}`,
          'error',
          { command: 'prosonata.handleRejected', title: t('Handle rejected entry'), arguments: [refused.id] },
        ),
      )
    }

    /*
     * Open for weeks with no new time, from every repository: what is forgotten
     * lies in a repository one does not have open (KONZEPT.md §3, *Abschluss*).
     * Read from the snapshot alone — the panel never writes.
     */
    for (const quiet of resting) {
      const since = Math.max(quiet.lastActivity ?? now, quiet.restingKeptAt ?? 0)
      const days = Math.floor((now - since) / (24 * 3600 * 1000))
      const here = sameScope(quiet.scope, context.scope)
      rows.push(
        new PanelRow(
          here
            ? t('Dormant for {0} days', days)
            : t('Dormant for {0} days · {1}/{2}', days, basename(quiet.scope.repoPath), quiet.scope.branch),
          t('{0} · {1} h — close?', quiet.text || t('(no text)'), billedTime(quiet.foreignSeconds + quiet.seconds, grid)),
          'watch',
          { command: 'prosonata.handleResting', title: t('Handle dormant entry'), arguments: [quiet.id] },
        ),
      )
    }

    /*
     * The reason, not just the count. A key that no longer works, a text over the
     * limit and a spent quota all used to look the same here: a number that would
     * not go down, with nothing saying why (KONZEPT.md §10).
     */
    if (state.pending.length > 0) {
      const trouble = session.lastTrouble
      rows.push(
        new PanelRow(
          t('Waiting to be sent'),
          trouble === null ? String(state.pending.length) : `${state.pending.length} — ${trouble}`,
          trouble === null ? 'cloud-upload' : 'warning',
          { command: 'prosonata.send', title: t('Send now') },
        ),
      )
    }

    /*
     * The hook calls a copy of the CLI at a fixed place. Is it gone, every
     * commit books nothing and says nothing, because the hook ends in
     * `|| true` (KONZEPT.md §8). This row is the only place that would show it.
     */
    if (isInstalled(context.repo.root) && publishedCli() === null) {
      rows.push(
        new PanelRow(
          t('Hook books nothing'),
          t('{0} is missing', paths.cli()),
          'warning',
          { command: 'prosonata.chooseProject', title: t('Set up hook again') },
        ),
      )
    }

    return rows
  }
}

/**
 * What another machine contributed, named only when there is any.
 *
 * Without it the panel contradicts itself: the timer row counts what was
 * measured **here**, this row the whole entry — two different sums under each
 * other, both right, and nothing saying why (KONZEPT.md §3).
 */
function elsewhere(entry: TimeEntry): string {
  return entry.foreignSeconds > 0 ? ` ${t('({0} h elsewhere)', hoursAndMinutes(entry.foreignSeconds))}` : ''
}

function describeProject(project: RepoProject | undefined, projectId: number, budget?: Budget): string {
  const name = !project ? `#${projectId}` : project.no ? `${project.no} ${project.name}` : project.name
  // Only with a plan to measure against: "15,25 h" alone says nothing about
  // whether the pot is full or empty.
  if (!budget || budget.planned <= 0) return name
  return t('{0} · {1} of {2} h', name, hours(budget.needed), hours(budget.planned))
}

/** `15.25` or `15,25` — decimal hours, as the budget is agreed, in the display language. */
function hours(value: number): string {
  return new Intl.NumberFormat(vscode.env.language, { maximumFractionDigits: 2, useGrouping: false }).format(value)
}

/** `1:23:45`. Seconds included, so a running timer is visibly running. */
export function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
