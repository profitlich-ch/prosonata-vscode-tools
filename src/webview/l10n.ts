import { format } from '../core/browse-view.js'

/*
 * `t()` for the webview. The host's `t()` from `@vscode/l10n` does not run in
 * the browser, so the host sends its bundle along with the data. Same rule as
 * everywhere else: the first argument is a literal, which is how the test finds
 * a missing translation.
 */

let strings: Record<string, string> = {}

export function useStrings(next: Record<string, string>): void {
  strings = next
}

export function t(message: string, ...args: Array<string | number>): string {
  return format(strings[message] ?? message, args)
}
