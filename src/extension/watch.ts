import { readFileSync } from 'node:fs'
import * as vscode from 'vscode'

import { fetchPrune, isMerged, remoteBranchGone } from '../core/git.js'
import type { RepoContext, Session } from '../core/session.js'
import { describeRunningElsewhere } from '../core/sync.js'
import { openEntry, runningSeconds } from '../core/tracking.js'
import { clock } from './panel.js'
import { askForDuration } from './adjust-ui.js'
import { askAboutClosedElsewhere } from './entries.js'
import { closedAmong, currentContext, currentSession, refreshBudget, reload } from './view.js'

/**
 * The beats and what they watch: sending, HEAD, a timer that has run too long,
 * a machine that slept, a branch whose pull request was closed (KONZEPT.md §8).
 */

export async function syncOnOpen(): Promise<void> {
  const active = currentSession()
  const context = currentContext()
  if (!active || !context) return

  await active.syncQuietly(context)
  reload()
  warnAboutRunningElsewhere(active)
  await askAboutClosedElsewhere(active, context)
  await askAboutLongRun(active, context)
}

/*
 * One pass at a time. A flush that outlives the interval — a slow answer, a rate
 * limit — would otherwise be overtaken by the next tick, and both passes would
 * send the same entries. The claim on creating catches the worse half of that
 * across processes; this catches it inside one, and costs nothing.
 */
let working = false

export async function work(): Promise<void> {
  if (working) return
  const active = currentSession()
  const context = currentContext()
  if (!active || !context) return

  working = true
  try {
    await workOnce(active, context)
  } finally {
    working = false
  }
}

async function workOnce(active: Session, context: RepoContext): Promise<void> {
  watchHead(active, context)
  reload()

  try {
    const result = await active.flush()
    // A budget in ProSonata only moves once time has actually arrived there —
    // and it is worth looking again exactly when an entry was finished.
    if (closedAmong(active, result.sent)) void refreshBudget(active, context.projectId)
  } catch {
    // Sending failures are not worth a popup every 30 seconds; they stay
    // pending and the panel shows the backlog.
  }

  await askAboutLongRun(active, context)
  reload()
}

let lastHead: string | null = null

/**
 * HEAD is watched only while a timer runs — a single file pointer, not an
 * activity watcher (KONZEPT.md §5). On a branch switch the time goes to the old
 * scope and we ask before anything continues.
 */
function watchHead(active: Session, context: RepoContext): void {
  const head = readHead(context.repo.headFile)
  if (head === null || lastHead === head) {
    lastHead ??= head
    return
  }

  const previous = lastHead
  lastHead = head
  if (previous === null) return

  /*
   * The one place that decides this is `reconcileBranchSwitch`, and it is used
   * rather than repeated. Repeating it here had cost twice over: the search went
   * by working directory alone, so a timer just started on the branch we arrived
   * at was mistaken for the old one and stopped — and `startedAt` was cleared
   * without booking, so the running segment was thrown away while the message
   * claimed it had gone to the old branch.
   */
  const from = active.reconcileBranchSwitch(context)
  if (from === null) return askAboutNewBranch(active, context)

  void vscode.window
    .showInformationMessage(
      `ProSonata: der Branch hat gewechselt. Die bisherige Zeit ging an ${from}. Hier weiterzählen?`,
      'Hier weiterzählen',
      'Pausiert lassen',
    )
    .then((answer) => {
      if (answer === 'Hier weiterzählen') void vscode.commands.executeCommand('prosonata.start')
    })
}

/** Branches already asked about in this window; see `askAboutNewBranch`. */
const askedAbout = new Set<string>()

/**
 * A branch nobody has ever measured, arrived at without a timer running: the
 * moment somebody starts on something new, and the one branch switch worth a
 * question (KONZEPT.md §3).
 *
 * A question, not a start — that line is the whole point. §11 rules out
 * starting a timer from a branch switch, and this does not: it asks, and the
 * answer is a person's.
 *
 * Asked **once** per branch. Every other switch is silent, because a switch
 * means many things — a review, a rebase, a quick look — and a question on each
 * of them would be clicked away unread within two days.
 */
function askAboutNewBranch(active: Session, context: RepoContext): void {
  if (!active.config.askOnNewBranch) return
  if (context.scope.branch === context.mainBranch) return
  if (askedAbout.has(context.key) || !active.neverMeasured(context)) return

  askedAbout.add(context.key)
  void vscode.window
    .showInformationMessage(
      `ProSonata: ${context.scope.branch} ist neu. Timer starten?`,
      'Timer starten',
      'Nicht jetzt',
    )
    .then((answer) => {
      if (answer === 'Timer starten') void vscode.commands.executeCommand('prosonata.start')
    })
}

function readHead(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * Somebody is measuring on this branch on another machine — the last write left
 * a `workingTimeStart` in ProSonata and we are not the ones running. Only a
 * warning: stopping a timer on a machine that is asleep is not possible, and
 * what those hours were can only be answered by whoever sat there.
 */
function warnAboutRunningElsewhere(active: Session): void {
  const since = active.runningElsewhereSince
  if (since === null) return

  void vscode.window.showWarningMessage(`ProSonata: ${describeRunningElsewhere(since, active.clock.now())}.`)
}

/** After "keep it all", the question stays away this long. */
const SNOOZE_MS = 60 * 60 * 1000

/** Per branch key: until when the long-run question has been answered with "later". */
const snoozedUntil = new Map<string, number>()

/**
 * A segment that has been running for hours (KONZEPT.md §3).
 *
 * The old warning compared the whole entry against the limit — a branch that
 * holds twenty hours would have warned a second after every start, every thirty
 * seconds, until nobody read it any more. What says something is the **running
 * segment**: it began at the last start or the last commit.
 *
 * And the question is not "still at it?" but how much of it counts. A timer
 * that ran overnight measured wall time; only the person who was there knows
 * what of it was work, so the tool asks instead of guessing.
 */
async function askAboutLongRun(active: Session, context: RepoContext): Promise<void> {
  const running = runningSeconds(active.state(), active.clock, context.scope)
  if (running < active.config.longRunWarningSeconds) return
  if ((snoozedUntil.get(context.key) ?? 0) > active.clock.now()) return

  /*
   * Snoozed before the question, not after it. While the dialog waits for an
   * answer nothing else here has changed, so the next beat asked again and put a
   * second dialog on top of the first. Whoever then answered the second one
   * first stopped the timer — and the answer to the first hit a guard and was
   * swallowed without a word.
   *
   * Setting it early costs nothing: every answer either cuts the segment, after
   * which the run is short again, or means "later" anyway.
   */
  snoozedUntil.set(context.key, active.clock.now() + SNOOZE_MS)

  const answer = await vscode.window.showWarningMessage(
    `ProSonata: der Timer läuft seit ${clock(running)} ohne Unterbruch. Wie viel davon zählt?`,
    'Alles behalten',
    'Anders angeben',
    'Verwerfen',
  )

  if (answer === undefined || answer === 'Alles behalten') return

  const kept = answer === 'Verwerfen' ? 0 : await askForDuration(running)
  if (kept === null) return

  active.keepFromRunning(context, kept)
  reload()
}

/**
 * Hourly, and only while a branch entry is open: notice that a pull request was
 * closed. GitHub deletes the branch on merge, so after a prune the remote ref is
 * gone — which a squash merge does not otherwise reveal (KONZEPT.md §3).
 */
export async function prune(): Promise<void> {
  const context = currentContext()
  if (!context || context.scope.branch === context.mainBranch) return

  const active = currentSession()
  if (!active) return
  const entry = openEntry(active.state(), context.scope)
  if (!entry || entry.text === '') return

  fetchPrune(context.repo.root)

  const merged = isMerged(context.repo.root, context.scope.branch, context.mainBranch)
  const gone = remoteBranchGone(context.repo.root, context.scope.branch)
  if (!merged && !gone) return

  const answer = await vscode.window.showInformationMessage(
    `ProSonata: "${entry.text}" sieht fertig aus — ${merged ? 'der Branch ist gemerged' : 'der Remote-Branch ist weg'}. Eintrag abschliessen?`,
    'Abschliessen',
    'Später',
  )
  if (answer === 'Abschliessen') await vscode.commands.executeCommand('prosonata.closeEntry')
}

/**
 * When this beat last ran. A suspended machine freezes the process, so a timer
 * that should fire every second and comes back an hour later did not fire at all.
 */
let lastBeat = Date.now()

/**
 * Notices that the machine was asleep (KONZEPT.md §3).
 *
 * There is no power event in the VS Code API — checked against the type
 * definitions, not assumed. The gap in this beat is the signal, and it is a
 * measurement rather than a guess: between the two beats nothing on this machine
 * ran, so nobody worked at it. That is what makes it different from every idle
 * heuristic, which infers from the tool to the person and is often wrong.
 *
 * Nothing is subtracted here. The gap is recorded and the panel asks.
 */
export function noticeSleep(): void {
  const now = Date.now()
  const gap = now - lastBeat
  lastBeat = now

  const active = currentSession()
  if (!active) return
  if (gap < active.config.sleepGapSeconds * 1000) return
  // Only worth a question while something was being measured.
  if (!active.state().timers.some((timer) => timer.startedAt !== null)) return

  active.sleepGaps.push({ from: now - gap, until: now })
  reload()
}
