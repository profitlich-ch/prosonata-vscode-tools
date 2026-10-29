import * as vscode from 'vscode'

import { noteFor, planAdjustment, readAdjustment, type Adjustment } from '../core/adjust.js'
import { t } from '../core/l10n.js'
import type { RepoContext, Session } from '../core/session.js'
import { currentSeconds, runningSeconds } from '../core/tracking.js'
import { clock } from './panel.js'
import { reload } from './view.js'

/** Correcting a measured time, and throwing a running segment away (KONZEPT.md §3). */

/**
 * Winding the clock forward or back (KONZEPT.md §3).
 *
 * One control for both: without typing it offers steps and, when nothing is
 * running, the time since the last commit — the case KONZEPT.md §5 has been
 * promising all along. Typing turns the same list into an input: a number
 * becomes plus and minus, a clock time becomes "ab 9:40 dazuzählen" and "nur
 * bis 9:40 zählen", each with the amount worked out.
 */
export async function adjustTime(session: Session, context: RepoContext): Promise<void> {
  const pick = vscode.window.createQuickPick<Offer>()
  pick.title = t('ProSonata: adjust time')
  pick.placeholder = t('±minutes, ±h:mm, «from 9:40» or «until 9:40»')
  pick.items = standingOffers(session, context)
  pick.onDidChangeValue((value) => {
    const offers = readAdjustment(value, session.clock.now())
    const possible = offers.filter((offer) => planAdjustment(offer, session.situation(context)).action !== 'impossible')

    /*
     * A QuickPick filters its items against what was typed. The lines opt out
     * of that with `alwaysShow`, because a label is the canonical form and
     * rarely contains the typed characters. A refusal has no line to sit on at
     * all, so it belongs in the title, which stays visible either way.
     */
    pick.title =
      offers.length > 0 && possible.length === 0
        ? t('ProSonata: no time of day without a running timer — use a duration, such as -0:06')
        : t('ProSonata: adjust time')
    pick.items = possible.length === 0 && offers.length === 0
      ? standingOffers(session, context)
      : possible.map((offer) => describe(offer, session, context))
  })

  const picked = await new Promise<Offer | undefined>((resolve) => {
    pick.onDidAccept(() => resolve(pick.selectedItems[0]))
    pick.onDidHide(() => resolve(undefined))
    pick.show()
  })
  pick.dispose()
  if (!picked) return

  // The line names the amount, so it is its own confirmation.
  if (picked.discard) return discardRunning(session, context, false)

  const chosen = picked.adjustment
  if (chosen === undefined) return

  const before = currentSeconds(session.state(), session.clock, context.scope)
  const plan = session.adjust(context, chosen)
  reload()

  const note = noteFor(plan, chosen)
  if (plan.action === 'impossible' || (plan.delta === 0 && plan.action !== 'stop')) {
    void vscode.window.showWarningMessage(
      note === null ? t('ProSonata: nothing changed.') : t('ProSonata: nothing changed — {0}.', note),
    )
    return
  }

  const after = currentSeconds(session.state(), session.clock, context.scope)
  void vscode.window.setStatusBarMessage(
    plan.action === 'stop' && plan.at !== undefined
      ? t('ProSonata: {0} → {1}, stopped at {2}', clock(before), clock(after), hourOf(plan.at))
      : `ProSonata: ${clock(before)} → ${clock(after)}`,
    4000,
  )
}

/**
 * Throws the running segment away: nothing is booked, the timer stops
 * (KONZEPT.md §3). The case is "committed, forgot to stop, did no more work" —
 * what was measured there is wall time, not work.
 *
 * The log keeps a line with the discarded duration. This is the one place where
 * measured time disappears on purpose, so it must not disappear silently too.
 */
export async function discardRunning(session: Session, context: RepoContext, confirm: boolean): Promise<void> {
  const running = runningSeconds(session.state(), session.clock, context.scope)
  if (running <= 0) {
    void vscode.window.showInformationMessage(t('ProSonata: no timer is running right now.'))
    return
  }

  if (confirm) {
    const discard = t('Discard')
    const answer = await vscode.window.showWarningMessage(
      t('Discard the running segment?'),
      {
        modal: true,
        detail: t('{0} will not be booked, and the timer stops. The discarded duration stays in the log.', clock(running)),
      },
      discard,
    )
    if (answer !== discard) return
  }

  session.keepFromRunning(context, 0)
  reload()
  void vscode.window.setStatusBarMessage(t('ProSonata: {0} discarded, timer stopped', clock(running)), 4000)
}

/** `17:17` — the hour a plan settles on. */
function hourOf(at: number): string {
  return new Date(at).toTimeString().slice(0, 5)
}

type Offer = vscode.QuickPickItem & { adjustment?: Adjustment; discard?: boolean }

/**
 * The list before anything is typed. Only amounts: they work in either state,
 * while a time of day needs a running segment to refer to.
 *
 * Discarding stands at the top while a timer runs — it is the outer end of the
 * same movement, "wind back all of it", and the case it serves (a commit made,
 * the stopping forgotten) is common enough to deserve the first line rather
 * than a duration one has to work out.
 */
function standingOffers(session: Session, context: RepoContext): Offer[] {
  const offers: Adjustment[] = [-15, -5, 5, 15].map((minutes) => ({
    kind: 'amount',
    seconds: minutes * 60,
    label: t('{0}{1} minutes', minutes > 0 ? '+' : '−', Math.abs(minutes)),
  }))

  const lines = offers.map((offer) => describe(offer, session, context))
  const running = runningSeconds(session.state(), session.clock, context.scope)
  if (running <= 0) return lines

  return [
    {
      label: t('Discard the running segment'),
      description: clock(running),
      detail: t('the timer stops, nothing is booked'),
      // For the same reason as in `describe`: this list is also shown while
      // something unreadable is being typed, and then it must stay whole.
      alwaysShow: true,
      discard: true,
    },
    ...lines,
  ]
}

/** Every line says what it will do before it is chosen. */
function describe(
  adjustment: Adjustment,
  session: Session,
  context: RepoContext,
): vscode.QuickPickItem & { adjustment: Adjustment } {
  const now = currentSeconds(session.state(), session.clock, context.scope)
  const plan = planAdjustment(adjustment, session.situation(context))

  /*
   * For a stop, the hour that will be recorded — which is not always the hour
   * that was typed: a timer that started later cannot end earlier than it began.
   */
  const stopped = plan.action === 'stop' && plan.at !== undefined ? ` · ${t('stops at {0}', hourOf(plan.at))}` : ''

  return {
    label: adjustment.label,
    description: `${clock(now)} → ${clock(Math.max(0, now + plan.delta))}${stopped}`,
    // Right in the line: why less will happen than the words promise.
    detail: noteFor(plan, adjustment) ?? '',
    /*
     * Without this the QuickPick filters the line away again. It matches what
     * was typed against the label, and the label is the canonical form: `+65`
     * becomes `+1:05 Stunden`, which contains no `65` at all. Everything from an
     * hour upwards therefore vanished the moment it was typed — the amount was
     * read correctly and then hidden, so only `+59` and `+1:05` appeared to work.
     */
    alwaysShow: true,
    adjustment,
  }
}

/** `1:30` or `90` — hours and minutes, or plain minutes. Null when cancelled. */
export async function askForDuration(running: number): Promise<number | null> {
  const given = await vscode.window.showInputBox({
    title: t('ProSonata: how much of it counts?'),
    prompt: t('Hours:minutes, or a number as minutes'),
    value: clock(running).slice(0, -3),
  })
  if (given === undefined) return null

  const [hours, minutes] = given.split(':')
  const seconds = minutes === undefined ? Number(hours) * 60 : Number(hours) * 3600 + Number(minutes) * 60
  if (!Number.isFinite(seconds) || seconds < 0) {
    void vscode.window.showWarningMessage(t('ProSonata: «{0}» is not a duration — nothing changed.', given))
    return null
  }
  return seconds
}
