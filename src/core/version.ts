/**
 * The version of this build, injected by esbuild (see scripts/build.mjs).
 *
 * Under vitest nothing injects it, and `typeof` on an undeclared name is safe
 * in JavaScript — so tests get the fallback instead of a crash.
 */
declare const __VERSION__: string

export const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : 'unbekannt'
