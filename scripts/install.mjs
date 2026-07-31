import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Two ways to get the extension into every VS Code window.
 *
 *   node scripts/install.mjs --link    symlink this repository (default)
 *   node scripts/install.mjs --vsix    package and install a .vsix
 *
 * Neither gives automatic updates — those only come from the marketplace, and
 * a hand-installed extension has no source VS Code could check. The symlink is
 * the closest thing: the extension *is* the repository, so `git pull` plus
 * `npm run build` and a window reload is the whole update.
 */

const root = process.cwd()
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const target = join(homedir(), '.vscode', 'extensions', `${manifest.publisher}.${manifest.name}`)

const mode = process.argv.includes('--vsix') ? 'vsix' : 'link'

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })

if (mode === 'link') {
  const extensions = join(homedir(), '.vscode', 'extensions')
  mkdirSync(extensions, { recursive: true })
  removeStaleLinks(extensions)

  if (existsSync(target) || isDanglingLink(target)) {
    const existing = lstatSync(target)
    if (!existing.isSymbolicLink()) {
      console.error(`\n${target} existiert und ist kein Symlink.`)
      console.error('Entferne es zuerst, oder nimm stattdessen --vsix.')
      process.exit(1)
    }
    rmSync(target)
  }

  symlinkSync(root, target, 'dir')
  console.log(`\nverlinkt  ${target}`)
  console.log(`     →  ${root}`)
  console.log('\nFenster neu laden (Entwickler: Fenster neu laden), dann ist sie in jedem VS Code.')
  console.log('Später aktualisieren: git pull, npm run build, Fenster neu laden.')
} else {
  execFileSync('npx', ['--yes', '@vscode/vsce', 'package', '--no-dependencies'], { cwd: root, stdio: 'inherit' })
  const vsix = `${manifest.name}-${manifest.version}.vsix`
  execFileSync('code', ['--install-extension', vsix, '--force'], { cwd: root, stdio: 'inherit' })
  console.log(`\ninstalliert ${vsix}`)
  console.log('Später aktualisieren: nach dem Anheben der Version erneut ausführen.')
}

function isDanglingLink(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Removes links to this repository that sit under a different name — what is
 * left behind when the package is renamed. Two folders with the same extension
 * id would otherwise be loaded twice.
 */
function removeStaleLinks(extensions) {
  for (const name of readdirSync(extensions)) {
    const path = join(extensions, name)
    if (path === target) continue
    try {
      if (!lstatSync(path).isSymbolicLink()) continue
      if (realpathSync(path) !== realpathSync(root)) continue
    } catch {
      continue
    }
    rmSync(path)
    console.log(`veralteten Link entfernt  ${name}`)
  }
}
