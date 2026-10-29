import * as l10n from '@vscode/l10n'

import de from '../../l10n/bundle.l10n.de.json'

/**
 * Visible text (KONZEPT.md §10): English in the code, German from the bundle.
 *
 * The bundle is compiled in rather than read from disk. The CLI runs as a copy
 * in `~/.prosonata/`, far from the package it was built in (KONZEPT.md §8), and
 * the extension shares this module with it — one mechanism for both.
 */
export const t = l10n.t

const BUNDLES: Record<string, l10n.l10nJsonFormat> = { de }

/** Switches every following `t()` to this language; an unknown one means English. */
export function setLanguage(language: string | undefined): void {
  l10n.config({ contents: BUNDLES[baseLanguage(language)] ?? {} })
}

/** `de-CH`, `de_CH.UTF-8` and `de` are all German. */
export function baseLanguage(language: string | undefined): string {
  return (language ?? '').toLowerCase().split(/[-_.@]/)[0] ?? ''
}

/**
 * The language for the CLI and the hook: the environment first, then what the
 * extension last wrote. A GUI client often starts the hook without any locale
 * variables, which is why the second source exists at all. `C` and `POSIX` say
 * no language was chosen, not that English was.
 */
export function languageFor(env: NodeJS.ProcessEnv, remembered: string | undefined): string | undefined {
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[name]
    if (value && value !== 'C' && value !== 'POSIX') return value
  }
  return remembered
}

/**
 * A journal note as template and values instead of a finished sentence. The
 * journal stays English, but the template is the key in the bundle, so whoever
 * shows a note can still translate it.
 */
export function template(message: string, ...args: Array<string | number>): { message: string; args?: string[] } {
  return args.length === 0 ? { message } : { message, args: args.map(String) }
}
