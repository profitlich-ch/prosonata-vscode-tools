import { describe, expect, it } from 'vitest'

import type { RemoteEntry } from './api.js'
import { buildComments } from './api-comments.js'
import { browseRows, isoWeek, type BranchSources } from './browse.js'
import { format, groupRows, keepSelection, matches, sortRows, type BrowseRow } from './browse-view.js'
import { DEFAULT_MARKER_WORD } from './marker.js'
import type { TimeGrid } from './working-time.js'

const quarter: TimeGrid = { kind: 'minutes', minutes: 15 }

function remote(timeID: number, overrides: Partial<RemoteEntry> = {}): RemoteEntry {
  return {
    timeID,
    projectID: 166,
    category: 70,
    date: '2026-11-12',
    detail: `Arbeit ${timeID}`,
    hours: 0.25,
    isInvoiced: false,
    notInvoiceable: false,
    workingTimeStart: null,
    workingTimeEnd: null,
    apiComments: null,
    ...overrides,
  }
}

function rowsOf(entries: RemoteEntry[], branches: Partial<BranchSources> = {}, measured = new Map<number, number>()) {
  return browseRows(entries, {
    measured,
    branches: { byTimeId: new Map(), byKey: new Map(), ...branches },
    markerWord: DEFAULT_MARKER_WORD,
    grid: quarter,
  })
}

function row(timeID: number, overrides: Partial<BrowseRow> = {}): BrowseRow {
  return {
    timeID,
    date: '2026-11-12',
    week: '2026-W46',
    text: `Arbeit ${timeID}`,
    seconds: 900,
    hours: '0:15',
    branch: 'feature/a',
    measured: null,
    invoiced: false,
    notInvoiceable: false,
    open: false,
    duplicate: false,
    ...overrides,
  }
}

describe('rows of the table', () => {
  it('takes the branch from the local state before the key', () => {
    const entry = remote(1, { apiComments: buildComments(null, { key: 'abc123', open: false, running: null }) })
    const [first] = rowsOf([entry], { byTimeId: new Map([[1, 'from-state']]), byKey: new Map([['abc123', 'from-key']]) })
    expect(first?.branch).toBe('from-state')
  })

  it('falls back to the key in apiComments, then to the old marker in the text', () => {
    const byKey = new Map([
      ['abc123', 'from-comments'],
      ['def456', 'from-marker'],
    ])
    const rows = rowsOf(
      [remote(1, { apiComments: buildComments(null, { key: 'abc123', open: false, running: null }) }), remote(2, { detail: '[def456] Alt' })],
      { byKey },
    )
    expect(rows.map((one) => one.branch)).toEqual(['from-comments', 'from-marker'])
  })

  it('says it does not know a branch rather than guessing one', () => {
    expect(rowsOf([remote(1)])[0]?.branch).toBeNull()
  })

  it('tells an entry the log never saw from one it measured', () => {
    const rows = rowsOf([remote(1), remote(2)], {}, new Map([[2, 360]]))
    expect(rows.map((one) => one.measured)).toEqual([null, 360])
  })

  it('shows the hours in the notation an edit starts from', () => {
    expect(rowsOf([remote(1, { hours: 2.25 })])[0]).toMatchObject({ seconds: 8100, hours: '2:15' })
  })

  it('marks two rows of one branch, one day and one text as a possible duplicate', () => {
    const byTimeId = new Map([
      [1, 'feature/a'],
      [2, 'feature/a'],
      [3, 'feature/a'],
      [4, 'feature/b'],
    ])
    const rows = rowsOf(
      [
        remote(1, { detail: 'Rabattstufen' }),
        // The marker of an open entry does not make its text a different one.
        remote(2, { detail: '[LAUFEND] Rabattstufen ' }),
        remote(3, { detail: 'Rabattstufen', date: '2026-11-11' }),
        remote(4, { detail: 'Rabattstufen' }),
      ],
      { byTimeId },
    )
    expect(rows.map((one) => one.duplicate)).toEqual([true, true, false, false])
  })

  it('does not call rows duplicates that have no branch or no text to compare', () => {
    const rows = rowsOf([remote(1, { detail: 'Gleich' }), remote(2, { detail: 'Gleich' }), remote(3, { detail: '' }), remote(4, { detail: '' })], {
      byTimeId: new Map([
        [3, 'feature/a'],
        [4, 'feature/a'],
      ]),
    })
    expect(rows.map((one) => one.duplicate)).toEqual([false, false, false, false])
  })
})

describe('ISO week', () => {
  it('starts on Monday', () => {
    expect(isoWeek('2026-11-15')).toBe('2026-W46')
    expect(isoWeek('2026-11-16')).toBe('2026-W47')
  })

  it('puts the first days of a year into the last week of the one before when they fall before Thursday', () => {
    expect(isoWeek('2027-01-01')).toBe('2026-W53')
    expect(isoWeek('2026-01-01')).toBe('2026-W01')
  })
})

describe('looking at the rows', () => {
  it('finds a row by text, number or branch, every word on its own', () => {
    const one = row(4821, { text: 'Rabattstufen im Formular', branch: 'feature/rabatt' })
    expect(['rabatt formular', '#4821', '4821', 'feature/', ''].map((query) => matches(one, query))).toEqual([true, true, true, true, true])
    expect(matches(one, 'storno')).toBe(false)
  })

  it('breaks ties by number, in the same direction', () => {
    const rows = [row(2), row(3), row(1, { date: '2026-11-13' })]
    expect(sortRows(rows, 'date', -1).map((one) => one.timeID)).toEqual([1, 3, 2])
    expect(sortRows(rows, 'date', 1).map((one) => one.timeID)).toEqual([2, 3, 1])
  })

  it('puts the newest group first and the rows without a branch last', () => {
    const groups = groupRows(
      [
        row(1, { branch: null, date: '2026-11-14' }),
        row(2, { branch: 'feature/old', date: '2026-11-01' }),
        row(3, { branch: 'feature/new', date: '2026-11-12', seconds: 900 }),
        row(4, { branch: 'feature/new', date: '2026-11-10', seconds: 1800 }),
      ],
      'branch',
      'date',
      -1,
    )
    expect(groups.map((group) => [group.key, group.seconds])).toEqual([
      ['feature/new', 2700],
      ['feature/old', 900],
      ['', 900],
    ])
  })

  it('groups by week as well, and not at all', () => {
    const rows = [row(1, { week: '2026-W45', date: '2026-11-05' }), row(2), row(3)]
    expect(groupRows(rows, 'week', 'date', -1).map((group) => [group.key, group.rows.length])).toEqual([
      ['2026-W46', 2],
      ['2026-W45', 1],
    ])
    expect(groupRows(rows, 'none', 'id', 1)).toEqual([{ key: '', rows: [rows[0], rows[1], rows[2]], seconds: 2700 }])
  })

  it('drops a ticked row once it is gone or invoiced', () => {
    expect(keepSelection([1, 2, 3], [row(1), row(2, { invoiced: true })])).toEqual([1])
  })

  it('fills in placeholders the way the host does', () => {
    expect(format('{0} von {1} h', ['17,75', 20])).toBe('17,75 von 20 h')
    expect(format('{0} und {2}', ['a'])).toBe('a und {2}')
  })
})
