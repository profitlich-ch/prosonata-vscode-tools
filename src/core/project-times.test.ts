import { describe, expect, it } from 'vitest'

import type { ProjectTime } from './api.js'
import { renderProjectTimes } from './project-times.js'

function time(extra: Partial<ProjectTime>): ProjectTime {
  return {
    timeID: 1,
    date: '2026-11-01',
    username: 'm.profitlich',
    category: 7,
    categoryName: 'Programmierung',
    hours: 1,
    detail: 'Login',
    isInvoiced: false,
    notInvoiceable: false,
    ...extra,
  }
}

describe('everybody’s time on a project', () => {
  const text = renderProjectTimes([
    time({ timeID: 3, date: '2026-11-03', username: 'a.muster', hours: 0.33, isInvoiced: true }),
    time({ timeID: 2, date: '2026-11-02', categoryName: 'Beratung', hours: 2.5, detail: '' }),
    time({ timeID: 1, hours: 1 }),
  ])

  it('shows who booked what, and when', () => {
    expect(text).toContain('  #3  03.11.2026  a.muster  Programmierung  0:20 h  Login  invoiced\n')
    expect(text).toContain('  #2  02.11.2026  m.profitlich  Beratung  2:30 h  (no text)\n')
  })

  it('sums the hours per category, the largest first, and in all', () => {
    expect(text).toContain('  Beratung        2:30 h\n  Programmierung  1:20 h\n  Total           3:50 h\n')
  })
})
