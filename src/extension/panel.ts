import * as vscode from 'vscode'

import { currentSeconds, openEntry } from '../core/tracking.js'
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
    const session = this.session()
    if (!session) {
      return [
        new PanelRow('No account yet', 'click to set up', 'warning', {
          command: 'prosonata.setup',
          title: 'Set up account',
        }),
      ]
    }

    const context = this.context()
    if (!context) {
      return [
        new PanelRow('No project yet', 'click to choose one', 'warning', {
          command: 'prosonata.chooseProject',
          title: 'Choose project',
        }),
      ]
    }

    const state = this.snapshot()
    if (!state) return [new PanelRow('No state yet', 'start a timer', 'watch')]
    const project = context.config.projects.find((candidate) => candidate.id === context.projectId)
    const timer = state.timers.find((candidate) => candidate.scope.repoPath === context.scope.repoPath && candidate.scope.branch === context.scope.branch)
    const entry = openEntry(state, context.scope)
    const grid = context.config.grid ?? session.config.grid

    const rows: PanelRow[] = [
      new PanelRow('Project', project?.name ?? `#${context.projectId}`, 'briefcase', {
        command: 'prosonata.chooseProject',
        title: 'Choose project',
      }),
      // A ruler, not a clock: the row is about the measure things are rounded
      // to. A clock already stands for the timer two rows down.
      new PanelRow('Grid', grid.kind === 'exact' ? 'exact' : `${grid.minutes} min`, 'symbol-ruler', {
        command: 'prosonata.chooseGrid',
        title: 'Choose grid',
      }),
      new PanelRow(
        'Branch',
        `${context.scope.branch} · ${context.mode === 'branch' ? 'one entry per branch' : 'one entry per commit'}`,
        'git-branch',
        context.scope.branch === context.mainBranch
          ? undefined
          : { command: 'prosonata.toggleMode', title: 'Switch mode' },
      ),
    ]

    const seconds = currentSeconds(state, session.clock, context.scope)
    rows.push(
      new PanelRow(
        timer?.startedAt ? 'Running' : 'Paused',
        `${clock(seconds)}${entry?.text ? ` · ${entry.text}` : ''}`,
        timer?.startedAt ? 'debug-pause' : 'play',
        { command: timer?.startedAt ? 'prosonata.pause' : 'prosonata.start', title: 'Start or pause' },
      ),
    )

    for (const open of state.entries.filter((candidate) => candidate.state === 'open' && candidate.text !== '')) {
      rows.push(
        new PanelRow(
          open.scope.branch === context.scope.branch ? 'Open entry' : `Open · ${open.scope.branch}`,
          `${open.text} · ${workingTime(open.foreignSeconds + open.seconds, grid)} h`,
          'circle-outline',
          { command: 'prosonata.closeEntry', title: 'Close entry', arguments: [open.id] },
          'openEntry',
        ),
      )
    }

    if (state.pending.length > 0) {
      rows.push(new PanelRow('Waiting to be sent', String(state.pending.length), 'cloud-upload', {
        command: 'prosonata.send',
        title: 'Send now',
      }))
    }

    return rows
  }
}

/** `1:23:45`. Seconds included, so a running timer is visibly running. */
export function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
