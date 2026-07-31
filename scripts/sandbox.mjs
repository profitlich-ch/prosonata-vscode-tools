import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Builds a sandbox under .sandbox: a state directory of its own and a small git
 * repository already set up for a project.
 *
 * The point is that trying things out never touches the real account or a real
 * customer repository — the extension reads PROSONATA_HOME, and the launch
 * configuration points it here.
 *
 *   node scripts/sandbox.mjs                     offline, nothing is sent
 *   node scripts/sandbox.mjs --live 166 70       against the real account
 */

const root = process.cwd()
const home = join(root, '.sandbox', 'home')
const repo = join(root, '.sandbox', 'repo')

const args = process.argv.slice(2)
const liveAt = args.indexOf('--live')
const live = liveAt >= 0
const [projectId = '166', categoryId = '70'] = live ? args.slice(liveAt + 1) : []

rmSync(join(root, '.sandbox'), { recursive: true, force: true })
mkdirSync(home, { recursive: true })
mkdirSync(repo, { recursive: true })

const config = live
  ? readLiveConfig()
  : {
      // Points nowhere on purpose: everything is booked locally and stays in
      // the pending list, which is exactly what you want while trying the UI.
      baseUrl: 'https://example.invalid/api/v1',
      apiKey: 'sandbox',
      sendDelaySeconds: 99999,
    }

writeFileSync(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
git('init', '--quiet')
git('config', 'user.email', 'sandbox@example.invalid')
git('config', 'user.name', 'Sandbox')
writeFileSync(join(repo, 'README.md'), '# Sandbox\n\nA repository to try the extension in.\n')
git('add', '.')
git('commit', '--quiet', '-m', 'first commit')

git('config', '--local', 'prosonata.project', `${projectId}:Sandbox-Projekt`)
git('config', '--local', 'prosonata.active', projectId)
git('config', '--local', `prosonata.${projectId}.category`, categoryId)

const hook = join(repo, '.git', 'hooks', 'post-commit')
writeFileSync(
  hook,
  [
    '#!/bin/sh',
    'git config --local --get prosonata.active >/dev/null 2>&1 || exit 0',
    `PROSONATA_HOME=${JSON.stringify(home)} ${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, 'dist', 'cli.cjs'))} post-commit || true`,
  ].join('\n') + '\n',
  { mode: 0o755 },
)

console.log(`Zustandsverzeichnis  ${home}`)
console.log(`Repository           ${repo}`)
console.log(`Modus                ${live ? `live, Projekt ${projectId}, Kategorie ${categoryId}` : 'offline, es wird nichts gesendet'}`)
console.log('\nF5 drücken und „Extension in der Sandbox" wählen.')

function readLiveConfig() {
  const path = join(process.env.HOME ?? '', '.prosonata', 'config.json')
  try {
    return JSON.parse(execFileSync('cat', [path], { encoding: 'utf8' }))
  } catch {
    console.error(`keine Konfiguration in ${path} — führe zuerst "prosonata init" aus, oder lass --live weg`)
    process.exit(1)
  }
}
