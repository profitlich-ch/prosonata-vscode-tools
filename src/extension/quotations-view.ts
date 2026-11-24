import * as vscode from 'vscode'

import { ApiError, type Quotation } from '../core/api.js'
import { t } from '../core/l10n.js'
import { describeQuotation, mayReadQuotations, renderQuotationMarkdown, titleOf } from '../core/quotations.js'
import type { RepoContext, Session } from '../core/session.js'
import { showMarkdown } from './log-view.js'

/**
 * The view «Quotations» beside the time tracking (KONZEPT.md §8): the
 * quotations of the active project, a click opens one with its positions in the
 * markdown preview. Read only, like the CLI.
 *
 * It asks ProSonata only when it is drawn — VS Code draws a collapsed view not
 * at all —, when the project changes, and on its refresh button. Never on a
 * timer: the quota is shared with the time tracking (KONZEPT.md §9).
 */
export class QuotationsView implements vscode.TreeDataProvider<Quotation> {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  private view: vscode.TreeView<Quotation> | null = null
  /** The list and the project it belongs to; null until drawn, or after a change. */
  private loaded: { projectId: number; list: Quotation[] } | null = null
  /** ProSonata refused once in this window; the view stays hidden until it closes. */
  private refused = false
  private shown: boolean | null = null

  constructor(
    private readonly session: () => Session | null,
    private readonly context: () => RepoContext | null,
  ) {}

  attach(view: vscode.TreeView<Quotation>): void {
    this.view = view
  }

  /**
   * After every reload: offer the view to the user groups that may read
   * quotations, and drop the list once the project is another. The group comes
   * from the last answer of any call (`meta.usergroupName`), so this costs none.
   */
  notice(): void {
    const shown = mayReadQuotations(this.session()?.api.userGroup() ?? null, this.refused)
    if (shown !== this.shown) {
      this.shown = shown
      void vscode.commands.executeCommand('setContext', 'prosonata.mayReadQuotations', shown)
    }
    if (this.loaded && this.loaded.projectId !== this.context()?.projectId) this.refresh()
  }

  refresh(): void {
    this.loaded = null
    this.changed.fire()
  }

  getTreeItem(quotation: Quotation): vscode.TreeItem {
    const item = new vscode.TreeItem(`#${quotation.quotationID}  ${titleOf(quotation)}`)
    item.description = describeQuotation(quotation)
    item.tooltip = `${titleOf(quotation)}\n${describeQuotation(quotation)}`
    item.iconPath = new vscode.ThemeIcon(quotation.approved ? 'pass' : quotation.isDraft ? 'edit' : 'file-text')
    item.command = { command: 'prosonata.showQuotation', title: t('Show quotation'), arguments: [quotation.quotationID] }
    return item
  }

  async getChildren(element?: Quotation): Promise<Quotation[]> {
    if (element) return []
    const session = this.session()
    const context = this.context()
    if (!this.view || !session || !context) return []

    if (this.loaded?.projectId !== context.projectId) {
      try {
        this.loaded = { projectId: context.projectId, list: await session.api.listQuotations(context.projectId) }
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          this.refused = true
          this.notice()
          return []
        }
        this.view.message = t('ProSonata could not be asked: {0}', (error as Error).message)
        return []
      }
    }
    // An empty string clears the message; `undefined` is not allowed under exactOptionalPropertyTypes.
    this.view.message = this.loaded.list.length === 0 ? t('no quotations for {0}', nameOf(context)) : ''
    return this.loaded.list
  }
}

/** Opens one quotation with its positions, fetched anew: a click is a look at ProSonata now. */
export async function showQuotation(session: Session, quotationId: number): Promise<void> {
  try {
    const quotation = await session.api.getQuotation(quotationId)
    if (!quotation) {
      void vscode.window.showWarningMessage(t('ProSonata has no quotation #{0}', quotationId))
      return
    }
    await showMarkdown(`${t('Quotation')} ${quotationId}`, renderQuotationMarkdown(quotation))
  } catch (error) {
    void vscode.window.showErrorMessage(t('ProSonata could not be asked: {0}', (error as Error).message))
  }
}

function nameOf(context: RepoContext): string {
  const project = context.config.projects.find((candidate) => candidate.id === context.projectId)
  if (!project) return t('Project {0}', context.projectId)
  return project.no ? `${project.no} ${project.name}` : project.name
}
