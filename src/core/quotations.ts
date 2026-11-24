import type { Quotation, QuotationPosition } from './api.js'
import { t } from './l10n.js'

/**
 * How `prosonata quotations` and `prosonata quotation` print what ProSonata
 * holds. Read only: the tool writes no quotation (KONZEPT.md §9, *`quotations`*).
 */

const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP', 'CAD']

/** One line per quotation, newest first, as the API sends them. */
export function renderQuotationList(quotations: Quotation[]): string {
  return quotations
    .map((quotation) =>
      [`#${quotation.quotationID}`, day(quotation.quotationDate), stateOf(quotation), money(quotation.netValue, quotation.currency), titleOf(quotation)]
        .join('  ')
        .trimEnd(),
    )
    .map((line) => `  ${line}\n`)
    .join('')
}

/** `16.10.2026 · approved · 20412.00 CHF` — beside the title in the editor's view. */
export function describeQuotation(quotation: Quotation): string {
  return [day(quotation.quotationDate), stateOf(quotation), money(quotation.netValue, quotation.currency)].join(' · ')
}

/** The title as ProSonata shows it, or a placeholder. */
export function titleOf(quotation: Quotation): string {
  return quotation.quotationName || quotation.quotationHeadline || t('(no title)')
}

/** A quotation with its positions, their text freed of the editor's HTML. */
export function renderQuotation(quotation: Quotation): string {
  const head: [string, string][] = [
    [t('Project'), [quotation.projectNo, quotation.projectName].filter((part) => part !== '').join(' ')],
    [t('Customer'), quotation.customerName],
    [t('Date'), `${day(quotation.quotationDate)}  ${stateOf(quotation)}`],
    [t('Net'), `${money(quotation.netValue, quotation.currency)}   ${t('gross {0}', money(quotation.grossValue, quotation.currency))}`],
  ]
  if (quotation.quotationHeadline !== '' && quotation.quotationHeadline !== quotation.quotationName) {
    head.push([t('Headline'), quotation.quotationHeadline])
  }
  if (quotation.quotationComments.trim() !== '') {
    head.push([t('Comments'), plainLines(quotation.quotationComments).join(' ')])
  }
  // Padded to the longest label, which differs between the languages.
  const width = Math.max(...head.map(([label]) => label.length)) + 2
  const lines = [`#${quotation.quotationID}  ${titleOf(quotation)}`, ...head.map(([label, value]) => `  ${label.padEnd(width)}${value}`)]

  const positions = quotation.positions ?? []
  if (positions.length === 0) lines.push('', `  ${t('no positions')}`)
  for (const position of positions) {
    const detail = plainLines(position.detail)
    if (isHeading(position)) {
      lines.push('', `  ${position.position}  ${detail[0] ?? position.categoryName}`)
      lines.push(...detail.slice(1).map((line) => `      ${line}`))
      continue
    }
    lines.push(`  ${position.position}  ${position.categoryName}  ${amountOf(position, quotation.currency)}${flagsOf(position)}`)
    lines.push(...detail.map((line) => `      ${line}`))
  }

  // A total sent through the API is not checked; ProSonata recomputes it only
  // when the quotation is opened there (KONZEPT.md §9). Half a cent is rounding.
  const total = positionsTotal(positions)
  if (positions.length > 0 && Math.abs(total - quotation.netValue) >= 0.005) {
    lines.push('', `  ${t('the positions add up to {0}, not to the net value stated', money(total, quotation.currency))}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * What ProSonata counts into the net value: active, priced, not optional —
 * measured on quotation 27, whose 20412.00 leaves out an optional 12 h.
 */
export function positionsTotal(positions: QuotationPosition[]): number {
  const total = positions
    .filter((position) => position.isActive && !position.isOptional && !isHeading(position))
    .reduce((sum, position) => sum + lineTotal(position), 0)
  return Math.round(total * 100) / 100
}

/**
 * A quotation as markdown, for VS Code's preview: a table of positions under
 * each heading, as the PDF sets them. The sections above the headings and their
 * subtotals are missing because the API does not deliver them (KONZEPT.md §9).
 */
export function renderQuotationMarkdown(quotation: Quotation): string {
  const currency = quotation.currency
  const lines = [
    `# ${escapeMarkdown(titleOf(quotation))}`,
    '',
    `- **${t('Quotation')}** #${quotation.quotationID}, ${day(quotation.quotationDate)}, ${stateOf(quotation)}`,
    `- **${t('Project')}** ${escapeMarkdown([quotation.projectNo, quotation.projectName].filter((part) => part !== '').join(' '))}`,
    `- **${t('Customer')}** ${escapeMarkdown(quotation.customerName)}`,
  ]
  if (quotation.quotationHeadline !== '' && quotation.quotationHeadline !== quotation.quotationName) {
    lines.push(`- **${t('Headline')}** ${escapeMarkdown(quotation.quotationHeadline)}`)
  }
  if (quotation.quotationComments.trim() !== '') {
    lines.push(`- **${t('Comments')}** ${escapeMarkdown(plainLines(quotation.quotationComments).join(' '))}`)
  }

  const positions = quotation.positions ?? []
  if (positions.length === 0) lines.push('', `*${t('no positions')}*`)
  let tableOpen = false
  for (const position of positions) {
    const detail = plainLines(position.detail).map(escapeMarkdown)
    if (isHeading(position)) {
      lines.push('', `## ${position.position} ${detail[0] ?? escapeMarkdown(position.categoryName)}`)
      if (detail.length > 1) lines.push('', detail.slice(1).join('<br>'))
      tableOpen = false
      continue
    }
    if (!tableOpen) {
      lines.push('', `| ${t('Pos.')} | ${t('Service')} | ${t('Category')} | ${t('Quantity')} | ${t('Unit price')} | ${t('Amount')} |`)
      lines.push('| --- | --- | --- | ---: | ---: | ---: |')
      tableOpen = true
    }
    const flags = [
      position.discountPercent !== 0 ? `−${position.discountPercent} %` : '',
      position.isOptional ? t('(optional, not in the total)') : '',
      position.isActive ? '' : t('(inactive)'),
    ].filter((flag) => flag !== '')
    const amount = [money(lineTotal(position), currency), ...flags.map((flag) => `*${flag}*`)].join('<br>')
    const quantity = `${position.quantity}${position.unit === '' ? '' : ` ${escapeMarkdown(position.unit)}`}`
    lines.push(
      `| ${position.position} | ${detail.join('<br>')} | ${escapeMarkdown(position.categoryName)} | ${quantity} | ${money(position.netValue, currency)} | ${amount} |`,
    )
  }

  lines.push('', `**${t('Net')}** ${money(quotation.netValue, currency)} · ${t('gross {0}', money(quotation.grossValue, currency))}`)
  const total = positionsTotal(positions)
  if (positions.length > 0 && Math.abs(total - quotation.netValue) >= 0.005) {
    lines.push('', `> ${t('the positions add up to {0}, not to the net value stated', money(total, currency))}`)
  }
  lines.push('', `*${t('The sections and subtotals of the PDF are not part of what ProSonata’s API delivers.')}*`)
  return `${lines.join('\n')}\n`
}

/**
 * Whether the view of quotations is offered (KONZEPT.md §9, *`quotations`*).
 * ProSonata's user groups are fixed; quotations open from «Teamleiter» up. A
 * name it does not know shows the view, and a refusal hides it again — so a
 * renamed group never locks anybody out. Comfort, not protection: the server
 * refuses on its own.
 */
export function mayReadQuotations(group: string | null, refused: boolean): boolean {
  if (refused || group === null) return false
  return !['Zeiterfasser 1', 'Zeiterfasser 2'].includes(group)
}

/** A table cell or a line of the preview: no pipe ends a cell, no angle bracket opens a tag. */
function escapeMarkdown(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/([*_`[\]#])/g, '\\$1')
}

/**
 * A heading has no field of its own — measured: quantity and price 0, the
 * title in `detail`.
 */
export function isHeading(position: QuotationPosition): boolean {
  return position.quantity === 0 && position.netValue === 0
}

/** Quantity times the price per unit, less the position's own discount. */
export function lineTotal(position: QuotationPosition): number {
  return position.quantity * position.netValue * (1 - position.discountPercent / 100)
}

function amountOf(position: QuotationPosition, currency: number): string {
  const unit = position.unit === '' ? '' : ` ${position.unit}`
  return `${position.quantity}${unit} × ${position.netValue.toFixed(2)} = ${money(lineTotal(position), currency)}`
}

function flagsOf(position: QuotationPosition): string {
  const flags = [
    position.discountPercent !== 0 ? `−${position.discountPercent} %` : '',
    position.isOptional ? t('(optional, not in the total)') : '',
    position.isActive ? '' : t('(inactive)'),
  ].filter((flag) => flag !== '')
  return flags.map((flag) => `  ${flag}`).join('')
}

/** One word: a customer's approval says more than the sending, the sending more than a draft. */
function stateOf(quotation: Quotation): string {
  if (quotation.approved) return t('approved')
  if (quotation.isDraft) return t('draft')
  if (quotation.isSent) return t('sent')
  return t('not sent')
}

function money(value: number, currency: number): string {
  return `${value.toFixed(2)} ${CURRENCIES[currency] ?? ''}`.trimEnd()
}

/** `2026-11-12` becomes `12.11.2026`; anything else stays as sent. */
function day(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : date
}

/**
 * The lines of the editor's HTML: a paragraph, a break or a list item starts a
 * new one, a list item with a dash. Tags go, the common entities are decoded.
 * Terminal lines, not a rendering.
 */
export function plainLines(html: string): string[] {
  return html
    .replace(/<li[^>]*>/gi, '\n– ')
    .replace(/<(br|\/p|\/li|\/div|\/h\d|\/ul|\/ol)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '' && line !== '–')
}
