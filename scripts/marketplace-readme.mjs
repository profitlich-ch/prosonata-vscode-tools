import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Writes the README as the Marketplace shows it, into out/marketplace/.
 *
 *   node scripts/marketplace-readme.mjs
 *
 * GitHub renders Mermaid, the Marketplace and VS Code's extension page do not,
 * and the Marketplace refuses SVG images. So README.md keeps its Mermaid
 * blocks, and this copy has them replaced by PNGs. The release workflow
 * attaches the PNGs to the GitHub release and packages with `--readme-path`
 * and `--baseImagesUrl` pointing there — so the images belong to their version
 * and nothing rendered has to live in the repository.
 *
 * mermaid-cli comes through npx, like vsce: it pulls in a headless Chromium,
 * far too heavy for a devDependency needed only at release time.
 */

const out = join('out', 'marketplace')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const args = ['--yes', '@mermaid-js/mermaid-cli', '-i', 'README.md', '-o', join(out, 'README.md'), '-e', 'png', '-s', '2', '-b', 'white']

// Ubuntu from 23.10 on forbids the user namespaces Chromium's sandbox needs.
// Only our own README is rendered, so CI may do without it.
if (process.env.CI) {
  const config = join(out, 'puppeteer.json')
  writeFileSync(config, JSON.stringify({ args: ['--no-sandbox'] }))
  args.push('-p', config)
}

execFileSync('npx', args, { stdio: 'inherit' })
