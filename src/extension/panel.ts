import * as vscode from 'vscode'

import { awaitingDecision, currentSeconds, openEntry, runningSeconds, unwrittenSeconds } from '../core/tracking.js'
import type { RepoProject } from '../core/repo-config.js'
import type { RepoContext, Session } from '../core/session.js'
import type { State } from '../core/types.js'
import { workingTime } from '../core/working-time.js'

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

export class Panel implements vscode.TreeDataProvider<PanelRow> {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  constructor(
    /** Null while there is no account yet — the panel then says so. */
    private readonly session: () => Session | null,
    private readonly context: () => RepoContext | null,
    /** The cached state. The panel never reads from disk itself. */
    private readonly snapshot: () => State | null,
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
      new PanelRow('Projekt', describeProject(project, context.projectId), 'briefcase', {
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

    for (const open of state.entries.filter((candidate) => candidate.state === 'open' && candidate.text !== '')) {
      rows.push(
        new PanelRow(
          open.scope.branch === context.scope.branch ? 'Offener Eintrag' : `Offen · ${open.scope.branch}`,
          `${open.text} · ${workingTime(open.foreignSeconds + open.seconds, grid)} h`,
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

function describeProject(project: RepoProject | undefined, projectId: number): string {
  if (!project) return `#${projectId}`
  return project.no ? `${project.no} ${project.name}` : project.name
}

/** `1:23:45`. Seconds included, so a running timer is visibly running. */
export function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
