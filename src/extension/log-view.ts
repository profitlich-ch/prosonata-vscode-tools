import * as vscode from 'vscode'

import { readRepoConfig } from '../core/repo-config.js'
import { describeBranch, renderReport } from '../core/report.js'
import { branchesIn } from '../core/segments.js'
import type { Session } from '../core/session.js'
import type { GitRepo } from '../core/git.js'

/**
 * Showing the segment log. Split out of `index.ts` because it is genuinely on
 * its own: it owns its document provider, needs none of the module state the
 * rest of the extension shares, and takes what it works on as arguments.
 */

/**
 * The segment log (KONZEPT.md §7). The branches come from the log, not from git,
 * so a branch that was deleted long ago still has its hours here.
 *
 * Shown as VS Code's own markdown preview, not as a webview of ours: the table
 * is set, the headings are headings, and it can still be searched, copied and
 * printed. The text behind it stays reachable over the preview's own button.
 */
export async function showLog(session: Session, repo: GitRepo): Promise<void> {
  const segments = session.segments.read().filter((segment) => segment.repoPath === repo.root)
  if (segments.length === 0) {
    void vscode.window.showInformationMessage('ProSonata: für dieses Repository ist noch kein Segment aufgezeichnet.')
    return
  }

  const branches = branchesIn(segments, repo.root)
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Alle Branches', description: describeBranch({ branch: '', repoPath: repo.root, seconds: segments.reduce((sum, s) => sum + s.seconds, 0), last: branches[0]!.last }), branch: null as string | null },
      ...branches.map((summary) => ({
        label: summary.branch,
        description: describeBranch(summary),
        branch: summary.branch as string | null,
      })),
    ],
    { title: 'ProSonata: Log — Branch wählen' },
  )
  if (!picked) return

  const grid = readRepoConfig(repo.root).grid ?? session.config.grid
  const uri = logDocuments.set(picked.branch ?? 'Alle Branches', renderReport(segments, { branch: picked.branch, grid }))
  try {
    await vscode.commands.executeCommand('markdown.showPreview', uri)
  } catch {
    // The preview belongs to a built-in extension. Where it is missing — a
    // stripped build, a remote without it — the text is still worth showing.
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true })
  }
}

/**
 * The log as a document VS Code owns but nobody can write to. An untitled
 * document would look editable, keep the typing, and ask whether to save a file
 * that does not exist — for an archive that is only ever appended to
 * (KONZEPT.md §3), that is the wrong offer.
 *
 * The same branch reuses its URI, so opening the log twice refreshes the tab
 * instead of stacking a second one.
 */
export const LOG_SCHEME = 'prosonata'

class LogDocuments implements vscode.TextDocumentContentProvider {
  private readonly texts = new Map<string, string>()
  private readonly changed = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.changed.event

  set(title: string, text: string): vscode.Uri {
    // The suffix is what gives the tab its markdown highlighting; a branch name
    // carries slashes, which would otherwise become path segments.
    const uri = vscode.Uri.parse(`${LOG_SCHEME}:${encodeURIComponent(title)}.md`)
    this.texts.set(uri.toString(), text)
    this.changed.fire(uri)
    return uri
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.toString()) ?? ''
  }
}

export const logDocuments = new LogDocuments()
