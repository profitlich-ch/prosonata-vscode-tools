import { chmodSync, readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'
import sveltePlugin from 'esbuild-svelte'

/**
 * One tool, one output format (KONZEPT.md §8).
 *
 * The source is ESM, the output is CommonJS: the extension host loads CJS, and
 * the CLI starts faster that way — the hook spawns a process on every commit.
 * `"type": "module"` is deliberately absent from package.json, which would make
 * .js files ESM and stop the extension entry point from loading.
 */

const watch = process.argv.includes('--watch')

/*
 * The version is baked in, not read at runtime. The CLI is copied to a fixed
 * place for the hooks to call (KONZEPT.md §8), away from the package.json it
 * was built beside — so it has to carry its own version to be able to say
 * which one it is.
 */
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  define: { __VERSION__: JSON.stringify(version) },
}

const extension = {
  ...shared,
  entryPoints: ['src/extension/index.ts'],
  outfile: 'dist/extension.cjs',
  // Provided by the extension host, never bundled.
  external: ['vscode'],
}

const cli = {
  ...shared,
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli.cjs',
  banner: { js: '#!/usr/bin/env node' },
}

/*
 * The table of time entries runs in a webview, which is a browser: no Node, no
 * `vscode`, one script and one stylesheet loaded under a content security
 * policy (docs/adr/0001). Svelte compiles away; its CSS comes out as
 * browse.css next to the script instead of being injected, so the policy needs
 * no inline styles.
 */
const webview = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  entryPoints: { browse: 'src/webview/main.ts' },
  outdir: 'dist/webview',
  mainFields: ['svelte', 'browser', 'module', 'main'],
  conditions: ['svelte', 'browser'],
  plugins: [sveltePlugin({ compilerOptions: { css: 'external' } })],
}

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(cli), esbuild.context(webview)])
  await Promise.all(contexts.map((context) => context.watch()))
  console.log('watching for changes')
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(cli), esbuild.build(webview)])
  chmodSync(cli.outfile, 0o755)
  console.log('built: dist/extension.cjs, dist/cli.cjs and dist/webview/')
}
