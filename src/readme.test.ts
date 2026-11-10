import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * README.md and README.de.md are the same document in two languages. Their
 * headings differ in wording, so what is compared is the shape: per section the
 * heading level, the number of code blocks and the number of table rows. A
 * section, a block or a row added to only one of them breaks the shape.
 */

const root = join(__dirname, '..')

function read(name: string): string {
  return readFileSync(join(root, name), 'utf8')
}

interface Section {
  heading: string
  level: number
  codeBlocks: number
  tableRows: number
}

function shape(markdown: string): Section[] {
  const sections: Section[] = []
  let current: Section = { heading: '(title)', level: 1, codeBlocks: 0, tableRows: 0 }
  let inCode = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      if (!inCode) current.codeBlocks++
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const heading = /^(#{2,6})\s+(.*)$/.exec(line)
    if (heading) {
      sections.push(current)
      current = { heading: heading[2] ?? '', level: heading[1]?.length ?? 0, codeBlocks: 0, tableRows: 0 }
    } else if (line.startsWith('|')) {
      current.tableRows++
    }
  }
  sections.push(current)
  return sections
}

const withoutHeading = ({ heading: _, ...rest }: Section) => rest

describe('README translations', () => {
  const en = read('README.md')
  const de = read('README.de.md')

  it('have the same sections, code blocks and table rows', () => {
    const enShape = shape(en)
    const deShape = shape(de)
    // The headings are part of the message, so a failure names the section.
    const pairs = enShape.map((section, i) => [section.heading, deShape[i]?.heading ?? '(missing)'])
    expect(deShape.map(withoutHeading), JSON.stringify(pairs, null, 1)).toEqual(enShape.map(withoutHeading))
  })

  it('link to each other at the top', () => {
    expect(en.split('\n').slice(0, 5).join('\n')).toContain('](README.de.md)')
    expect(de.split('\n').slice(0, 5).join('\n')).toContain('](README.md)')
  })
})
