/**
 * Adding follow-up time to an entry that is already closed (KONZEPT.md §3).
 *
 * On the main branch a commit closes its entry, and the timer runs on into a new
 * one. Work done after the commit — the last look, the deployment, the call —
 * belongs to what was just committed, not to whatever gets committed next. Only
 * a person can judge that, so nothing here happens on its own.
 *
 * The shapes and the wording live in `core` for the same reason as everywhere
 * else: the editor and the terminal say the same sentence.
 */

/** What a confirmation has to show before anything is written. */
export interface AttachPlan {
  /** Seconds moved over. */
  seconds: number
  /** The target's text, as ProSonata holds it right now. */
  text: string
  /** Its date — the day the time lands on, which may not be today. */
  date: string
  /** Hours before and after, already rounded to the grid that will be written. */
  before: string
  after: string
}

export type Attachment =
  | { kind: 'done'; plan: AttachPlan }
  | { kind: 'cancelled' }
  /** Nothing measured that is not already booked. */
  | { kind: 'nothing' }
  /** The open entry is in ProSonata already; moving it would leave a ghost. */
  | { kind: 'known' }
  | { kind: 'noTarget' }
  | { kind: 'gone' }
  | { kind: 'invoiced' }

export function describeAttachment(result: Attachment): string {
  switch (result.kind) {
    case 'done':
      return `${result.plan.before} h → ${result.plan.after} h · ${result.plan.text}`
    case 'cancelled':
      return 'nichts geändert'
    case 'nothing':
      return 'keine ungebuchte Zeit vorhanden'
    case 'known':
      return 'dieser Eintrag steht bereits in ProSonata — schliesse ihn ab, statt ihn zu verschieben'
    case 'noTarget':
      return 'auf diesem Branch ist noch kein Eintrag abgeschlossen, dem etwas zugeschlagen werden könnte'
    case 'gone':
      return 'der Eintrag ist in ProSonata nicht mehr zu finden'
    case 'invoiced':
      return 'der Eintrag ist bereits fakturiert — das geht nur noch in ProSonata'
  }
}

/**
 * The sentence a confirmation asks. Named separately because the grid can eat
 * the whole amount: five minutes on a quarter-hour grid change nothing, and
 * being asked to confirm a write that changes nothing is worse than being told.
 */
export function describePlan(plan: AttachPlan): string {
  const minutes = Math.round(plan.seconds / 60)
  const amount = minutes < 60 ? `${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}` : `${(plan.seconds / 3600).toFixed(2)} Stunden`

  return plan.before === plan.after
    ? `${amount} an «${plan.text}» (${plan.date}) — das Zeitraster lässt es bei ${plan.before} h`
    : `${amount} an «${plan.text}» (${plan.date}) — ${plan.before} h wird ${plan.after} h`
}
