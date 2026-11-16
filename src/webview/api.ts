import type { Grouping, SortKey } from '../core/browse-view.js'

/** What VS Code hands a webview script, via `acquireVsCodeApi()`. */
export interface VsCodeApi<T> {
  postMessage(message: unknown): void
  getState(): T | undefined
  setState(state: T): T
}

declare function acquireVsCodeApi<T>(): VsCodeApi<T>

/** Fetched once for the page: VS Code refuses a second call. */
export const host = acquireVsCodeApi<Saved>()

/**
 * How the table was being looked at, kept by VS Code while the tab is hidden.
 * The webview is thrown away then and built anew; without this a switch to
 * another tab would forget the search and everything ticked.
 */
export interface Saved {
  query: string
  grouping: Grouping
  showInvoiced: boolean
  sortKey: SortKey
  direction: 1 | -1
  selected: number[]
}
