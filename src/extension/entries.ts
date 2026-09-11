import * as vscode from 'vscode'

import { describeAttachment, describePlan } from '../core/attach.js'
import { paths } from '../core/config.js'
import { setMode } from '../core/repo-config.js'
import type { RepoContext, Session } from '../core/session.js'
import { awaitingDecision, openEntry, setText, unwrittenSeconds } from '../core/tracking.js'
import { clock } from './panel.js'
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
    const answer = await vscode.window.showInformationMessage(
      `ProSonata: „${entry.text || context.scope.branch}" wurde auf einem anderen Rechner abgeschlossen. Hier sind noch ${rest} angefallen.`,
      { modal: false },
      'Zum bestehenden Eintrag',
      'Neuer Eintrag',
    )
    if (answer === undefined) continue

    try {
      await session.resolveClosedElsewhere(entry.id, answer === 'Zum bestehenden Eintrag' ? 'add' : 'fresh')
    } catch (error) {
      void vscode.window.showWarningMessage(`ProSonata: ${(error as Error).message}`)
    }
    reload()
  }
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
    void vscode.window.showWarningMessage(
      'ProSonata: noch keine Konfiguration vorhanden — richte das Konto zuerst ein.',
    )
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
  const answer = await vscode.window.showInformationMessage(
    `ProSonata: der Rechner schlief ${slept}, während der Timer lief. Diese Zeit abziehen?`,
    'Abziehen',
    'Behalten',
  )
  if (answer === undefined) return

  if (answer === 'Abziehen') {
    /*
     * What came off, not what was asked about. Every window runs the beat and
     * notices the same sleep; another one may have answered while this dialog
     * stood open, and then there is nothing left to take.
     */
    const removed = active.skipSleep()
    void vscode.window.showInformationMessage(
      removed > 0
        ? `ProSonata: ${clock(removed)} abgezogen, der Timer läuft weiter.`
        : 'ProSonata: nichts abzuziehen — die Schlafzeit war bereits entschieden.',
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
      `ProSonata: der Text hat ${problem.length} Zeichen, erlaubt sind ${problem.limit}. ` +
        'ProSonata würde ihn wortlos abschneiden, deshalb wurde nichts gesendet. Kürze ihn.',
    )
  }
  await askAboutClosedElsewhere(session, context)
  if (result.missingCategory.length > 0) {
    void vscode.window
      .showWarningMessage(
        'ProSonata: für dieses Projekt ist keine Zeitkategorie gewählt — ProSonata verlangt eine, deshalb wurde nichts gesendet.',
        'Kategorie wählen',
      )
      .then((answer) => {
        if (answer === 'Kategorie wählen') void vscode.commands.executeCommand('prosonata.chooseCategory')
      })
  }
  for (const failure of result.failed) {
    void vscode.window.showWarningMessage(`ProSonata: ${failure.error.message}`)
  }
}

export async function toggleMode(session: Session, context: RepoContext): Promise<void> {
  if (context.scope.branch === context.mainBranch) {
    void vscode.window.showInformationMessage('ProSonata: auf dem Main-Branch ist jeder Commit sein eigener Eintrag.')
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
        label: 'Ein Eintrag pro Branch',
        detail: 'Für Abrechnung nach Leistung: eine Rechnungszeile für das, was geliefert wurde',
        mode: 'branch' as const,
      },
      {
        label: 'Ein Eintrag pro Branch und Tag',
        detail: 'Für Abrechnung nach Zeit auf Branch-Arbeit: je Tag eine Zeile, mit Datum und Uhrzeiten',
        mode: 'branch-day' as const,
      },
      {
        label: 'Ein Eintrag pro Commit',
        detail: 'Für Abrechnung nach Zeit: jeder Commit wird seine eigene Zeile',
        mode: 'commit' as const,
      },
    ].map((item) => ({ ...item, ...(item.mode === context.mode ? { description: 'aktuell' } : {}) })),
    { title: `ProSonata: Zeiteinträge auf ${context.scope.branch}` },
  )
  if (!picked || picked.mode === context.mode) return

  const next = picked.mode
  const entry = openEntry(session.state(), context.scope)

  // Switching to per-commit closes the open entry — otherwise it would hang
  // there with no prospect of ever being closed (KONZEPT.md §3).
  if (next === 'commit' && entry && entry.text !== '') {
    const text = await vscode.window.showInputBox({
      title: 'ProSonata: endgültiger Text für den offenen Eintrag',
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
    void vscode.window.showInformationMessage(`ProSonata: auf ${context.scope.branch} ist nichts offen.`)
    return
  }

  const text = await vscode.window.showInputBox({
    title: 'ProSonata: Text des offenen Eintrags',
    prompt: 'Der Eintrag bleibt offen; ein späterer Trailer ersetzt diesen Text weiterhin.',
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
    title: 'ProSonata: endgültiger Text für die Rechnung',
    prompt: 'Der Marker verschwindet, und dieser Eintrag wird nie wieder geschrieben.',
    value: entry.text,
  })
  if (text === undefined) return
  if (text.trim() === '') {
    void vscode.window.showWarningMessage('ProSonata: ohne Text wird ein Eintrag nie gesendet — nichts getan.')
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
    const answer = await vscode.window.showWarningMessage(
      'Zeit dem letzten Eintrag zuschlagen?',
      { modal: true, detail: describePlan(plan) },
      'Zuschlagen',
    )
    return answer === 'Zuschlagen'
  })

  if (result.kind === 'done') void vscode.window.showInformationMessage(`ProSonata: ${describeAttachment(result)}`)
  else if (result.kind !== 'cancelled') void vscode.window.showWarningMessage(`ProSonata: ${describeAttachment(result)}`)
  reload()
}

/** Every 30 seconds: watch HEAD, send what is due, warn if needed. */
