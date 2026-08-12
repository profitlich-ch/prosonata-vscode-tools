import * as vscode from 'vscode'

import {
  awaitingDecision,
  currentSeconds,
  lastClosedEntry,
  openEntriesIn,
  openEntry,
  runningSeconds,
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
      new PanelRow('Projekt', describeProject(project, context.projectId, this.budget(context.projectId)), 'briefcase', {
        command: 'prosonata.chooseProject',
        title: 'Projekt wählen',
      }),
      // A ruler, not a clock: the row is about the measure things are rounded
      // to. A clock already stands for the timer two rows down.
      new PanelRow('Zeitraster', grid.kind === 'exact' ? 'exakt' : `${grid.minutes} min`, 'symbol-ruler', {
        command: 'prosonata.chooseGrid',
        title: 'Zeitraster wählen',
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
        'Zeiteintrag',
        context.mode === 'branch' ? 'pro Branch' : 'pro Commit',
        // `clockface`, not `clock`: the latter is an alias for `history`, which
        // the log in the title bar already uses.
        'clockface',
        context.scope.branch === context.mainBranch
          ? undefined
          : { command: 'prosonata.toggleMode', title: 'Zwischen pro Branch und pro Commit wechseln' },
      ),
      // Directly above the timer: the category belongs to the work that is about
      // to run, and without one ProSonata refuses the entry.
      new PanelRow(
        'Kategorie',
        context.categoryId > 0
          ? context.config.categoryNames.get(context.projectId) ?? `#${context.categoryId}`
          : 'keine — es wird nichts gesendet',
        'tag',
        { command: 'prosonata.chooseCategory', title: 'Kategorie wählen' },
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
        timer?.startedAt ? 'Läuft' : 'Pausiert',
        `${clock(running)} · ${clock(total)}${entry?.text ? ` · ${entry.text}` : ''}`,
        timer?.startedAt ? 'debug-pause' : 'play',
        { command: timer?.startedAt ? 'prosonata.pause' : 'prosonata.start', title: 'Starten oder pausieren' },
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
          'Ohne Text',
          `${hoursAndMinutes(unwrittenSeconds(entry))} h — steht als «${session.config.placeholderText}» in ProSonata`,
          'warning',
          { command: 'prosonata.changeText', title: 'Text setzen' },
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
          'Nicht gebucht',
          `${hoursAndMinutes(unwrittenSeconds(entry))} h → letzter Eintrag`,
          'fold-up',
          { command: 'prosonata.attachToLast', title: 'Dem letzten Eintrag zuschlagen' },
        ),
      )
    }

    // Only this working directory: an open entry of another project is none of
    // this panel's business, and the label `Offen · <branch>` would read like a
    // branch of the repository one is looking at.
    for (const open of openEntriesIn(state, context.scope.repoPath).filter((candidate) => candidate.text !== '')) {
      rows.push(
        new PanelRow(
          open.scope.branch === context.scope.branch ? 'Offener Eintrag' : `Offen · ${open.scope.branch}`,
          `${open.text} · ${billedTime(open.foreignSeconds + open.seconds, grid)} h${elsewhere(open)}`,
          'circle-outline',
          { command: 'prosonata.closeEntry', title: 'Eintrag abschliessen', arguments: [open.id] },
          'openEntry',
        ),
      )
    }

    for (const parked of awaitingDecision(state, context.scope)) {
      rows.push(
        new PanelRow(
          'Anderswo abgeschlossen',
          `${clock(unwrittenSeconds(parked))} offen — entscheiden`,
          'question',
          { command: 'prosonata.resolveClosedElsewhere', title: 'Entscheiden' },
        ),
      )
    }

    if (state.pending.length > 0) {
      rows.push(new PanelRow('Wartet auf Versand', String(state.pending.length), 'cloud-upload', {
        command: 'prosonata.send',
        title: 'Jetzt senden',
      }))
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
  return entry.foreignSeconds > 0 ? ` (${hoursAndMinutes(entry.foreignSeconds)} h anderswo)` : ''
}

function describeProject(project: RepoProject | undefined, projectId: number, budget?: Budget): string {
  const name = !project ? `#${projectId}` : project.no ? `${project.no} ${project.name}` : project.name
  // Only with a plan to measure against: "15,25 h" alone says nothing about
  // whether the pot is full or empty.
  if (!budget || budget.planned <= 0) return name
  return `${name} · ${hours(budget.needed)} von ${hours(budget.planned)} h`
}

/** `15,25` — decimal hours, as the budget is agreed, with a German comma. */
function hours(value: number): string {
  return value.toFixed(2).replace(/[.,]?0+$/, '').replace('.', ',')
}

/** `1:23:45`. Seconds included, so a running timer is visibly running. */
export function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
