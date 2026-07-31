import { chmodSync } from 'node:fs'
import * as esbuild from 'esbuild'

/**
 * One tool, one output format (KONZEPT.md §8).
 *
 * The source is ESM, the output is CommonJS: the extension host loads CJS, and
 * the CLI starts faster that way — the hook spawns a process on every commit.
 * `"type": "module"` is deliberately absent from package.json, which would make
 * .js files ESM and stop the extension entry point from loading.
 */

const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
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

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(cli)])
  await Promise.all(contexts.map((context) => context.watch()))
  console.log('beobachte Änderungen')
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(cli)])
  chmodSync(cli.outfile, 0o755)
  console.log('gebaut: dist/extension.cjs und dist/cli.cjs')
}
