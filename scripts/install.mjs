import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Packages the extension and installs it, the way any other user installs it.
 *
 *   node scripts/install.mjs
 *
 * There used to be a second way: a symlink from ~/.vscode/extensions to this
 * repository, so a build was enough to update it. VS Code loads its user
 * extensions from `extensions.json` now, and nothing writes that entry but
 * `code --install-extension` — a folder placed there by hand is ignored. The
 * symlink is therefore gone; leftovers from it are removed below.
 *
 * For development this is the wrong tool anyway: F5 ("Extension im echten
 * Konto") runs the extension straight from the working copy, with no packaging
 * and no installation at all.
 *
 * Neither route gives automatic updates — those only come from the marketplace,
 * and a hand-installed extension has no source VS Code could check.
 */

const root = process.cwd()
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
removeStaleLinks(join(homedir(), '.vscode', 'extensions'))

execFileSync('npx', ['--yes', '@vscode/vsce', 'package', '--no-dependencies'], { cwd: root, stdio: 'inherit' })
const vsix = `${manifest.name}-${manifest.version}.vsix`
execFileSync(codeCommand(vsix), ['--install-extension', vsix, '--force'], { cwd: root, stdio: 'inherit' })

console.log(`\ninstalliert ${vsix}`)
console.log('Fenster neu laden (Entwickler: Fenster neu laden), dann ist sie in jedem VS Code.')
console.log('Später aktualisieren: diesen Befehl erneut ausführen.')

/**
 * The `code` command, whether or not it is on the PATH. VS Code does not put it
 * there by itself — under macOS that is a separate step in the command palette
 * — so a plain `code` fails with "command not found" on a perfectly normal
 * installation. The binary inside the application bundle works just as well.
 */
function codeCommand(vsix) {
  const home = homedir()
  const candidates = ['code']
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      join(home, 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'),
    )
  } else if (process.platform === 'win32') {
    candidates.push(
      join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/bin/code.cmd'),
      'C:/Program Files/Microsoft VS Code/bin/code.cmd',
    )
  } else {
    candidates.push('/usr/share/code/bin/code', '/snap/bin/code', '/usr/bin/code')
  }

  for (const candidate of candidates) {
    try {
      // Asking for the version is the cheapest proof that it runs at all.
      execFileSync(candidate, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
      return candidate
    } catch {
      continue
    }
  }

  console.error('\nVS Code nicht gefunden.')
  console.error('Richte den Befehl ein: Befehlspalette → "Shell Command: Install \'code\' command in PATH".')
  console.error(`Oder installiere von Hand: Erweiterungen-Ansicht → … → "Aus VSIX installieren…" → ${vsix}`)
  process.exit(1)
}

/**
 * Removes symlinks to this repository — what the earlier `--link` route left in
 * ~/.vscode/extensions. VS Code ignores them, but they carry the same extension
 * id as the real installation, which is a puzzle nobody needs twice.
 */
function removeStaleLinks(extensions) {
  for (const name of readdirSync(extensions)) {
    const path = join(extensions, name)
    try {
      if (!lstatSync(path).isSymbolicLink()) continue
      if (realpathSync(path) !== realpathSync(root)) continue
    } catch {
      continue
    }
    rmSync(path)
    console.log(`veralteten Symlink entfernt  ${name}`)
  }
}
