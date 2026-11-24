import type { ProjectTime } from './api.js'
import { t } from './l10n.js'
import { hoursAndMinutes } from './working-time.js'

/**
 * How `prosonata entries` prints everybody's time on a project: a line per
 * entry, newest first, then the hours per category — the measure a quotation's
 * positions can be held against, since an entry names no position.
 */
export function renderProjectTimes(times: ProjectTime[]): string {
  const lines = times.map((time) => {
    const flags = [time.isInvoiced ? t('invoiced') : '', time.notInvoiceable ? t('not invoiceable') : ''].filter((flag) => flag !== '')
    return [`#${time.timeID}`, day(time.date), time.username, time.categoryName, `${hours(time.hours)} h`, time.detail || t('(no text)'), ...flags]
      .join('  ')
      .trimEnd()
  })

  const perCategory = new Map<string, number>()
  for (const time of times) perCategory.set(time.categoryName, (perCategory.get(time.categoryName) ?? 0) + time.hours)
  const total = times.reduce((sum, time) => sum + time.hours, 0)
  const width = Math.max(...[...perCategory.keys()].map((name) => name.length), t('Total').length)
  const sums = [...perCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, sum]) => `  ${name.padEnd(width)}  ${hours(sum)} h`)

  return `${lines.map((line) => `  ${line}\n`).join('')}\n${sums.join('\n')}\n  ${t('Total').padEnd(width)}  ${hours(total)} h\n`
}

// To the nearest minute, as `billedTime` does: 0.33 h stored is twenty minutes, not nineteen.
function hours(value: number): string {
  return hoursAndMinutes(Math.round(value * 60) * 60)
}

function day(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : date
}
