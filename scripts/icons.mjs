import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Normalises the icon SVGs after an export from a drawing program.
 *
 * Illustrator adds things VS Code cannot use: generic `id="a"` attributes that
 * collide with other extensions once VS Code inlines the file, `data-name`
 * leftovers, and wrapper groups around a single path. It also drops the two
 * things VS Code needs — an explicit size and `fill="currentColor"`, without
 * which the icon renders black and disappears in a dark theme.
 *
 * Run it again after every export: `npm run icons`. It is idempotent.
 */

const targets = [
  { file: 'media/icon-activity.svg', size: 24 },
  { file: 'media/icon-view.svg', size: 16 },
]

let changed = 0

for (const { file, size } of targets) {
  const before = readFileSync(file, 'utf8')
  let svg = before

  // Generic ids and Illustrator's layer names.
  svg = svg.replace(/\s+(?:id|data-name)="[^"]*"/g, '')
  // Groups that wrapped nothing but their own id.
  svg = svg.replace(/<g>\s*([\s\S]*?)\s*<\/g>/g, '$1')
  // Editor metadata that has no business in a shipped icon.
  svg = svg.replace(/<!--[\s\S]*?-->\n?/g, '')

  // An explicit size and the colour VS Code fills in itself.
  svg = svg.replace(/<svg\b([^>]*)>/, (_match, attributes) => {
    const kept = String(attributes)
      .replace(/\s+(?:width|height|fill)="[^"]*"/g, '')
      .trim()
    return `<svg width="${size}" height="${size}" fill="currentColor" ${kept}>`
  })

  svg = `${svg.replace(/\n{2,}/g, '\n').trimEnd()}\n`

  if (svg !== before) {
    writeFileSync(file, svg)
    changed++
  }

  report(file, svg, size)
}

console.log(changed === 0 ? '\nnothing to change' : `\n${changed} file(s) normalised`)

function report(file, svg, size) {
  const problems = []
  if (!svg.includes('fill="currentColor"')) problems.push('no currentColor')
  if (/\bid=/.test(svg)) problems.push('still has ids')
  if (!svg.includes(`viewBox="0 0 ${size} ${size}"`)) problems.push(`viewBox is not 0 0 ${size} ${size}`)
  if (/stroke=/.test(svg)) problems.push('has strokes — convert them to outlines, they do not scale')

  const shapes = (svg.match(/<(?:path|rect|circle|polygon)\b/g) ?? []).length
  const status = problems.length === 0 ? 'ok' : problems.join(', ')
  console.log(`  ${file.padEnd(28)} ${size}px  ${String(shapes).padStart(2)} shapes  ${status}`)
}
