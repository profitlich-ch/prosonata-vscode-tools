import { describe, expect, it } from 'vitest'

import type { Quotation, QuotationPosition } from './api.js'
import {
  mayReadQuotations,
  plainLines,
  positionsTotal,
  renderQuotation,
  renderQuotationList,
  renderQuotationMarkdown,
} from './quotations.js'

function quotation(extra: Partial<Quotation> = {}): Quotation {
  return {
    quotationID: 412,
    quotationName: 'Relaunch',
    quotationHeadline: 'Offerte Relaunch',
    quotationDate: '2026-11-12',
    netValue: 4250,
    grossValue: 4594.25,
    currency: 1,
    isDraft: true,
    isSent: false,
    sentDate: null,
    approved: false,
    projectID: 166,
    projectNo: 'P-1',
    projectName: 'Shop',
    customerName: 'Muster AG',
    quotationComments: '',
    positions: null,
    ...extra,
  }
}

function position(extra: Partial<QuotationPosition>): QuotationPosition {
  return {
    detailID: 0,
    position: '',
    isActive: true,
    isOptional: false,
    categoryName: 'Programmierung',
    detail: '',
    quantity: 0,
    unit: '',
    netValue: 0,
    discountPercent: 0,
    ...extra,
  }
}

/** The shape of quotation 27 as measured: a heading, hours, an optional gift, a discount. */
const measured = [
  position({ position: '1', categoryName: 'Sonstiges', detail: 'Projektübernahme und Bereinigung' }),
  position({ position: '1.1', quantity: 6, unit: 'h', netValue: 180, detail: '<ul><li>Hostingzugänge</li><li>Git</li></ul>' }),
  position({ position: '3.1', quantity: 12, unit: 'h', netValue: 180, isOptional: true, detail: 'Designupdate' }),
  position({ position: '5.7', categoryName: 'Sonstiges', quantity: 1, unit: '%', netValue: -1728, detail: '10% Rabatt' }),
]

describe('the list of quotations', () => {
  it('shows number, day, state, amount and title on one line', () => {
    expect(renderQuotationList([quotation()])).toBe('  #412  12.11.2026  draft  4250.00 CHF  Relaunch\n')
  })

  it('names the approval before the sending', () => {
    const line = renderQuotationList([quotation({ isDraft: false, isSent: true, approved: true })])

    expect(line).toContain('  approved  ')
  })
})

describe('one quotation', () => {
  const text = renderQuotation(quotation({ positions: measured }))

  it('shows a heading as a title, not as a position worth nothing', () => {
    expect(text).toContain('\n  1  Projektübernahme und Bereinigung\n')
    expect(text).not.toContain('0 × 0.00')
  })

  it('multiplies the price per unit, and puts each list item on a line of its own', () => {
    expect(text).toContain('  1.1  Programmierung  6 h × 180.00 = 1080.00 CHF\n      – Hostingzugänge\n      – Git\n')
  })

  it('takes quantity, unit and price per unit as ProSonata has them, whatever the unit', () => {
    const other = renderQuotation(
      quotation({
        positions: [
          position({ position: '1', categoryName: 'Hosting', quantity: 2, unit: 'Jahre', netValue: 240 }),
          position({ position: '2', categoryName: 'Lizenz', quantity: 3, unit: 'Stk.', netValue: 49.5 }),
          position({ position: '3', categoryName: 'Konzept', quantity: 1, unit: '', netValue: 1500 }),
        ],
      }),
    )

    expect(other).toContain('  1  Hosting  2 Jahre × 240.00 = 480.00 CHF\n')
    expect(other).toContain('  2  Lizenz  3 Stk. × 49.50 = 148.50 CHF\n')
    expect(other).toContain('  3  Konzept  1 × 1500.00 = 1500.00 CHF\n')
  })

  it('marks an optional position as left out of the total', () => {
    expect(text).toContain('  3.1  Programmierung  12 h × 180.00 = 2160.00 CHF  (optional, not in the total)\n')
  })

  it('keeps the labels of the head aligned', () => {
    expect(text).toContain('  Customer  Muster AG\n  Date      12.11.2026')
  })

  it('says so when it has no positions', () => {
    expect(renderQuotation(quotation({ positions: [] }))).toContain('  no positions\n')
  })
})

describe('the total', () => {
  it('is what ProSonata states once optional positions are left out — measured on quotation 27', () => {
    // Every priced position of 27; 3.1 is the optional one. ProSonata: 20412.00 net.
    const hours = [6, 7, 12, 14, 12, 24, 10, 12, 10, 18, 5, 5]
    const all = [
      position({ position: '1' }),
      ...hours.map((quantity, index) => position({ quantity, unit: 'h', netValue: 180, isOptional: index === 2 })),
      position({ quantity: 1, unit: '%', netValue: -1728 }),
    ]
    expect(positionsTotal(all)).toBe(20412)
    expect(renderQuotation(quotation({ netValue: 20412, positions: all }))).not.toContain('add up to')
  })

  it('says so when the stated net differs from the positions', () => {
    // A total sent through the API is not checked; ProSonata recomputes it only when opened.
    expect(renderQuotation(quotation({ netValue: 999, positions: measured }))).toContain('the positions add up to -648.00 CHF, not to the net value stated')
  })
})

describe('text from the editor', () => {
  it('turns breaks into lines and decodes entities', () => {
    expect(plainLines('a<br>b&nbsp;&lt;c&gt;<br/>  d')).toEqual(['a', 'b <c>', 'd'])
  })

  it('keeps the lines of plain text', () => {
    expect(plainLines('eins\nzwei')).toEqual(['eins', 'zwei'])
  })
})

describe('the view of quotations', () => {
  it('is offered from «Teamleiter» up, and to a group it does not know', () => {
    expect(mayReadQuotations('Administrator', false)).toBe(true)
    expect(mayReadQuotations('Teamleiter', false)).toBe(true)
    expect(mayReadQuotations('Team lead', false)).toBe(true)
    expect(mayReadQuotations('Zeiterfasser 2', false)).toBe(false)
    expect(mayReadQuotations('Zeiterfasser 1', false)).toBe(false)
  })

  it('is hidden before any answer named a group, and after a refusal', () => {
    expect(mayReadQuotations(null, false)).toBe(false)
    expect(mayReadQuotations('Administrator', true)).toBe(false)
  })
})

describe('one quotation in the preview', () => {
  const markdown = renderQuotationMarkdown(quotation({ positions: measured }))

  it('puts a heading above a table of its positions', () => {
    expect(markdown).toContain('\n## 1 Projektübernahme und Bereinigung\n\n| Pos. | Service | Category | Quantity | Unit price | Amount |\n')
    expect(markdown).toContain('| 1.1 | – Hostingzugänge<br>– Git | Programmierung | 6 h | 180.00 CHF | 1080.00 CHF |')
  })

  it('marks an optional position in its amount', () => {
    expect(markdown).toContain('| 2160.00 CHF<br>*(optional, not in the total)* |')
  })

  it('keeps a pipe in a text from ending the cell', () => {
    const text = renderQuotationMarkdown(quotation({ positions: [position({ position: '1', quantity: 1, netValue: 10, detail: 'A | B' })] }))

    expect(text).toContain('| A \\| B |')
  })

  it('says that the sections of the PDF are missing', () => {
    expect(markdown).toContain('The sections and subtotals of the PDF')
  })
})
