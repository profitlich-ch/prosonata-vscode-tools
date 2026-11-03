import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import TurndownService from 'turndown'

/**
 * Fetches ProSonata's API documentation into docs/prosonata-api/.
 *
 *   npm run api-docs
 *
 * The copy is what the Bruno collection and KONZEPT.md cite as the vendor's
 * promise. It is not ours to redistribute, so it is ignored by git and rebuilt
 * here instead. Running this again after ProSonata changes a page and diffing
 * against the previous local copy shows what they changed.
 *
 * A page that no longer exists is reported and its local file left alone — the
 * last copy is then the only record of what the vendor once documented, and
 * deleting it would lose exactly that.
 */

const BASE = 'https://www.prosonata.de/infos-und-hilfen/api/'
const OUT = join('docs', 'prosonata-api')

// Local file names predate this script and are cited throughout bruno/, hence
// the mapping instead of deriving them from the URL.
const PAGES = {
  'angebote.md': 'api-angebote.html',
  'crm.md': 'api-crm.html',
  'fremdkosten.md': 'api-fremdkosten.html',
  'grundlagen.md': 'api-grundlagen.html',
  'kontakte-adressen.md': 'api-kontakte-adressen.html',
  'kontakte-ansprechpartner.md': 'api-kontakte-ansprechpartner.html',
  'kontakte-firmen.md': 'api-kontakte-firmen.html',
  'leistungsvorlagen.md': 'api-leistungsvorlagen.html',
  'projektaufgaben.md': 'api-projektaufgaben.html',
  'projekte.md': 'api-projekte.html',
  'projektkategorien.md': 'api-projektzeitkategorien.html',
  'projektzeiten.md': 'api-projektzeiten.html',
  'rechnungen.md': 'api-rechnungen.html',
}

const turndown = new TurndownService({ codeBlockStyle: 'fenced' })

// The site writes requests and responses as bare <pre> with <br> for line
// breaks; turndown only fences <pre><code>. The <br> are turned into newlines
// beforehand (see below), so the text content is the code as printed.
turndown.addRule('pre', {
  filter: 'pre',
  replacement: (_, node) => `\n\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`,
})

// Parameter tables, as GFM tables. Turndown has none of its own and would
// flatten them into one line per cell. A <br> inside a cell separates values
// such as "0 = nein" and "1 = ja" and is kept as such.
turndown.addRule('table', {
  filter: 'table',
  replacement: (_, node) => {
    // Turndown's DOM under Node has no iterable NodeLists, hence Array.from.
    const rows = Array.from(node.getElementsByTagName('tr')).map((tr) =>
      Array.from(tr.childNodes).filter((cell) => cell.nodeName === 'TD' || cell.nodeName === 'TH').map((cell) =>
        turndown.turndown(cell.innerHTML).trim().replace(/\s*\n+\s*/g, '<br>').replace(/\|/g, '\\|'),
      ),
    )
    if (!rows.length) return ''
    const line = (cells) => `| ${cells.join(' | ')} |`
    const [head, ...body] = rows
    return `\n\n${[line(head), line(head.map(() => '---')), ...body.map(line)].join('\n')}\n\n`
  },
})

/** <br> inside <pre> as real newlines, so the pre rule can use textContent. */
function preLineBreaks(html) {
  return html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, (pre) => pre.replace(/<br\s*\/?>\n?/g, '\n'))
}

mkdirSync(OUT, { recursive: true })
let missing = 0

for (const [file, page] of Object.entries(PAGES)) {
  const url = BASE + page
  const target = join(OUT, file)
  const response = await fetch(url)
  const html = await response.text()
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1]

  // The site answers a removed page with a redirect to a 404, so the status
  // alone settles it; the <main> check catches a changed page layout.
  if (!response.ok || !main) {
    missing++
    const kept = existsSync(target) ? 'lokale Kopie bleibt' : 'keine lokale Kopie'
    console.warn(`fehlt   ${file}  ${url} (${response.status}, ${kept})`)
    continue
  }

  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1].trim() ?? page
  writeFileSync(target, `# ${title}\n\nQuelle: ${url}\n\n${turndown.turndown(preLineBreaks(main))}\n`)
  console.log(`geholt  ${file}`)
}

if (missing) process.exitCode = 1
