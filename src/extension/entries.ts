import { basename } from 'node:path'
import * as vscode from 'vscode'

import { describeAttachment, describePlan } from '../core/attach.js'
import { paths } from '../core/config.js'
import { describeRepo } from '../core/git.js'
import { t } from '../core/l10n.js'
import { readRepoConfig, setMode, type RepoProject } from '../core/repo-config.js'
import { describeRejection } from '../core/sender.js'
import type { RepoContext, Session } from '../core/session.js'
import { awaitingDecision, openEntry, rejectedEntries, setText, unwrittenSeconds } from '../core/tracking.js'
import type { TimeEntry } from '../core/types.js'
import { clock } from './panel.js'
import { chooseCategory } from './setup.js'
import { closedAmong, currentSession, refreshBudget, reload } from './view.js'

/** What can be done to a time entry from the editor (KONZEPT.md §3). */

/**
 * Somebody closed the entry on another machine while time was running here.
 * Where that time goes is not ours to decide (KONZEPT.md §3) — and the place it
 * is noticed, the sender, may well be the `post-commit` hook, where nobody can
 * answer. So the entry waits, and the question is asked here.
 */
export async function askAboutClosedElsewhere(session: Session, context: RepoContext): Promise<void> {
  for (const entry of awaitingDecision(session.state(), context.scope)) {
    const rest = clock(unwrittenSeconds(entry))
    const existing = t('Add to existing entry')
    const answer = await vscode.window.showInformationMessage(
      t('ProSonata: "{0}" was closed on another machine. {1} accrued here since.', entry.text || context.scope.branch, rest),
      { modal: false },
      existing,
      t('New entry'),
    )
    if (answer === undefined) continue

    try {
      await session.resolveClosedElsewhere(entry.id, answer === existing ? 'add' : 'fresh')
    } catch (error) {
      void vscode.window.showWarningMessage(`ProSonata: ${(error as Error).message}`)
    }
    reload()
  }
}

/**
 * An entry ProSonata refused (KONZEPT.md §4): try again, move it to another
 * project, or discard it. Reached from its row in the panel, which passes the
 * entry; from the command palette it asks which one first.
 *
 * Works on the entry's own repository, not on the one this window shows — the
 * entries stuck on 26 October 2026 belonged to another one.
 */
export async function handleRejected(entryId?: string): Promise<void> {
  const session = currentSession()
  if (!session) return

  const refused = rejectedEntries(session.state())
  const entry = refused.find((candidate) => candidate.id === entryId) ?? (await pickRejected(refused))
  if (!entry) return

  const reason = describeRejection(entry, projectOf(entry))
  const action = await vscode.window.showQuickPick(
    [
      { label: t('Move to another project'), detail: t('and send right away'), action: 'move' as const },
      { label: t('Try again'), detail: t('send the same details once more'), action: 'retry' as const },
      { label: t('Discard'), detail: t('only here — for time that is already in ProSonata'), action: 'drop' as const },
    ],
    { title: `ProSonata: ${entry.text || entry.scope.branch} — ${reason}` },
  )
  if (!action) return

  try {
    if (action.action === 'retry') await session.retryRejected(entry.id)
    if (action.action === 'move') await moveToProject(session, entry)
    if (action.action === 'drop') {
      const running = session.state().timers.some((timer) => timer.entryId === entry.id && timer.startedAt !== null)
      const name = entry.text || entry.scope.branch
      const discard = t('Discard')
      const confirmed = await vscode.window.showWarningMessage(
        running
          ? t('Discard "{0}"? ProSonata stays untouched. The running timer goes with it.', name)
          : t('Discard "{0}"? ProSonata stays untouched.', name),
        { modal: true },
        discard,
      )
      if (confirmed === discard) session.discardLocally(entry.id)
    }
  } catch (error) {
    void vscode.window.showWarningMessage(`ProSonata: ${(error as Error).message}`)
  }
  reload()
}

/**
 * An entry that has rested for `restingDays` (KONZEPT.md §3, *Abschluss*):
 * close it, keep it for another period, or discard it because its time stands
 * in ProSonata some other way. Reached from its row in the panel.
 */
export async function handleResting(entryId?: string): Promise<void> {
  const session = currentSession()
  if (!session) return

  const entry = session.state().entries.find((candidate) => candidate.id === entryId)
  if (!entry) return

  const action = await vscode.window.showQuickPick(
    [
      { label: t('Close'), detail: t('final text, then the line goes on the invoice as it is'), action: 'close' as const },
      { label: t('Keep'), detail: t('the branch goes on — ask again only in {0} days', session.config.restingDays), action: 'keep' as const },
      { label: t('Discard'), detail: t('only here — for time that is already in ProSonata some other way'), action: 'drop' as const },
    ],
    { title: t('ProSonata: {0} is dormant', entry.text || entry.scope.branch) },
  )
  if (!action) return

  if (action.action === 'close') {
    await vscode.commands.executeCommand('prosonata.closeEntry', entry.id)
    return
  }
  if (action.action === 'keep') session.keepResting(entry.id)
  if (action.action === 'drop') {
    const discard = t('Discard')
    const confirmed = await vscode.window.showWarningMessage(
      t('Discard "{0}"? ProSonata stays untouched.', entry.text || entry.scope.branch),
      { modal: true },
      discard,
    )
    if (confirmed === discard) session.discardLocally(entry.id)
  }
  reload()
}

async function pickRejected(refused: TimeEntry[]): Promise<TimeEntry | undefined> {
  if (refused.length === 0) {
    void vscode.window.showInformationMessage(t('ProSonata has not rejected any entries.'))
    return undefined
  }
  const picked = await vscode.window.showQuickPick(
    refused.map((entry) => ({
      label: entry.text || t('(no text)'),
      description: `${basename(entry.scope.repoPath)}/${entry.scope.branch}`,
      detail: describeRejection(entry, projectOf(entry)),
      entry,
    })),
    { title: t('ProSonata: rejected entries') },
  )
  return picked?.entry
}

/** The repository's own projects first, the one that refused left out. */
async function moveToProject(session: Session, entry: TimeEntry): Promise<void> {
  const repoPath = entry.scope.repoPath
  const known = new Set(readRepoConfig(repoPath).projects.map((project) => project.id))
  const projects = (await session.api.listProjects()).filter((project) => project.projectID !== entry.projectId)
  const picked = await vscode.window.showQuickPick(
    [...projects.filter((p) => known.has(p.projectID)), ...projects.filter((p) => !known.has(p.projectID))].map((project) => ({
      label: project.projectName,
      description: project.projectNo,
      detail: project.customerName,
      project,
    })),
    { title: t('ProSonata: to which project?'), matchOnDescription: true, matchOnDetail: true },
  )
  if (!picked) return

  const { project } = picked
  if ((readRepoConfig(repoPath).categories.get(project.projectID) ?? 0) <= 0) {
    const repo = describeRepo(repoPath)
    if (repo) await chooseCategory(session, repo, project)
  }
  const categoryId = readRepoConfig(repoPath).categories.get(project.projectID) ?? 0
  if (categoryId <= 0) return

  await session.moveRejected(entry.id, { id: project.projectID, name: project.projectName, no: project.projectNo }, categoryId)
}

function projectOf(entry: TimeEntry): RepoProject | undefined {
  return readRepoConfig(entry.scope.repoPath).projects.find((project) => project.id === entry.projectId)
}

/**
 * Opens `~/.prosonata/config.json` in the editor.
 *
 * Deliberately not `contributes.configuration`. The settings live in that file
 * because the hook and the CLI read them without VS Code (KONZEPT.md §7 and §8);
 * VS Code settings would be a second source of truth that those two cannot see.
 * And Settings Sync would carry the API key into the cloud, which §7 rules out.
 *
 * So the gap this closes is discoverability, not storage: without it a stranger
 * has no way in but to know the path by heart.
 */
export async function openSettings(): Promise<void> {
  const file = vscode.Uri.file(paths.config())
  try {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file))
  } catch {
    void vscode.window.showWarningMessage(t('ProSonata: no configuration yet — set up the account first.'))
  }
}

/**
 * The answer to a sleeping machine, in the two words it comes down to
 * (KONZEPT.md §3).
 *
 * The number is not asked for but stated: the gap was measured, so the question
 * is only whether it counts. It might — a call about this project, a look at the
 * printout — which is why nothing is subtracted without an answer.
 */
export async function resolveSleep(): Promise<void> {
  const active = currentSession()
  if (!active || active.openSleepGaps().length === 0) return

  const slept = clock(active.sleptSeconds())
  const subtract = t('Subtract')
  const answer = await vscode.window.showInformationMessage(
    t('ProSonata: the machine slept {0} while the timer was running. Subtract this time?', slept),
    subtract,
    t('Keep'),
  )
  if (answer === undefined) return

  if (answer === subtract) {
    /*
     * What came off, not what was asked about. Every window runs the beat and
     * notices the same sleep; another one may have answered while this dialog
     * stood open, and then there is nothing left to take.
     */
    const removed = active.skipSleep()
    void vscode.window.showInformationMessage(
      removed > 0
        ? t('ProSonata: {0} subtracted, the timer keeps running.', clock(removed))
        : t('ProSonata: nothing to subtract — the sleep time was already decided.'),
    )
  } else {
    active.keepSleep()
  }
  reload()
}

export async function toggle(session: Session, context: RepoContext): Promise<void> {
  const running = session.state().timers.find(
    (timer) => timer.scope.repoPath === context.scope.repoPath && timer.scope.branch === context.scope.branch && timer.startedAt !== null,
  )
  if (running) session.pause(context)
  else await session.start(context)
}

export async function sendNow(session: Session, context: RepoContext): Promise<void> {
  const result = await session.flush(true)
  for (const problem of result.tooLong) {
    void vscode.window.showWarningMessage(
      t('ProSonata: the text has {0} characters, {1} are allowed. ProSonata would cut it off without a word, so nothing was sent. Shorten it.', problem.length, problem.limit),
    )
  }
  await askAboutClosedElsewhere(session, context)
  if (result.missingCategory.length > 0) {
    const choose = t('Choose category')
    void vscode.window
      .showWarningMessage(
        t('ProSonata: no time category is chosen for this project — ProSonata requires one, so nothing was sent.'),
        choose,
      )
      .then((answer) => {
        if (answer === choose) void vscode.commands.executeCommand('prosonata.chooseCategory')
      })
  }
  for (const failure of result.failed) {
    void vscode.window.showWarningMessage(`ProSonata: ${failure.error.message}`)
  }
}

export async function toggleMode(session: Session, context: RepoContext): Promise<void> {
  if (context.scope.branch === context.mainBranch) {
    void vscode.window.showInformationMessage(t('ProSonata: on the main branch every commit is its own entry.'))
    return
  }

  /*
   * Three modes, so a two-way toggle no longer does. They serve two ways of
   * billing (KONZEPT.md §3): `commit` bills by time, `branch` by what was
   * delivered, and `branch-day` fills the gap — billing by time on branch work.
   * Named that way, the choice is one a person can make; "toggle" would not be.
   */
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: t('One entry per branch'),
        detail: t('For billing by deliverable: one invoice line for what was delivered'),
        mode: 'branch' as const,
      },
      {
        label: t('One entry per branch and day'),
        detail: t('For billing by time on branch work: one line per day, with date and times'),
        mode: 'branch-day' as const,
      },
      {
        label: t('One entry per commit'),
        detail: t('For billing by time: every commit becomes its own line'),
        mode: 'commit' as const,
      },
    ].map((item) => ({ ...item, ...(item.mode === context.mode ? { description: t('current') } : {}) })),
    { title: t('ProSonata: time entries on {0}', context.scope.branch) },
  )
  if (!picked || picked.mode === context.mode) return

  const next = picked.mode
  const entry = openEntry(session.state(), context.scope)

  // Switching to per-commit closes the open entry — otherwise it would hang
  // there with no prospect of ever being closed (KONZEPT.md §3).
  if (next === 'commit' && entry && entry.text !== '') {
    const text = await vscode.window.showInputBox({
      title: t('ProSonata: final text for the open entry'),
      value: entry.text,
    })
    if (text === undefined) return
    session.closeEntry(entry.id, text)
  }

  setMode(context.repo.root, context.key, next)
}

/**
 * The text of the open entry, without closing it. A typo in a trailer would
 * otherwise only be correctable by another commit — or by closing an entry that
 * is not finished at all.
 */
export async function changeText(session: Session, context: RepoContext, entryId?: string): Promise<void> {
  const state = session.state()
  const entry = entryId ? state.entries.find((candidate) => candidate.id === entryId) : openEntry(state, context.scope)
  if (!entry || entry.state === 'closed') {
    void vscode.window.showInformationMessage(t('ProSonata: nothing is open on {0}.', context.scope.branch))
    return
  }

  const text = await vscode.window.showInputBox({
    title: t('ProSonata: text of the open entry'),
    prompt: t('The entry stays open; a later trailer still replaces this text.'),
    value: entry.text,
  })
  if (text === undefined || text === '') return

  session.store.update((current) => setText(current, entry.id, text, session.clock.now()))
}

export async function closeEntry(session: Session, context: RepoContext, entryId?: string): Promise<void> {
  const state = session.state()
  const entry = entryId ? state.entries.find((candidate) => candidate.id === entryId) : openEntry(state, context.scope)
  if (!entry) return

  const text = await vscode.window.showInputBox({
    title: t('ProSonata: final text for the invoice'),
    prompt: t('The marker disappears, and this entry is never written again.'),
    value: entry.text,
  })
  if (text === undefined) return
  if (text.trim() === '') {
    void vscode.window.showWarningMessage(t('ProSonata: an entry without text is never sent — nothing done.'))
    return
  }

  session.closeEntry(entry.id, text)
  await session.flush(true)
  void refreshBudget(session, context.projectId)
}

/**
 * Adds the time measured since the last commit to the entry that commit closed
 * (KONZEPT.md §3). Modal on purpose: it writes to an entry the tool has already
 * declared finished, and the grid may swallow the whole amount — both belong in
 * front of the click, not in a message afterwards.
 */
export async function attachToLast(session: Session, context: RepoContext): Promise<void> {
  const result = await session.attachToLastClosed(context, async (plan) => {
    const attach = t('Attach')
    const answer = await vscode.window.showWarningMessage(
      t('Attach the time to the last entry?'),
      { modal: true, detail: describePlan(plan) },
      attach,
    )
    return answer === attach
  })

  if (result.kind === 'done') void vscode.window.showInformationMessage(`ProSonata: ${describeAttachment(result)}`)
  else if (result.kind !== 'cancelled') void vscode.window.showWarningMessage(`ProSonata: ${describeAttachment(result)}`)
  reload()
}

/** Every 30 seconds: watch HEAD, send what is due, warn if needed. */
