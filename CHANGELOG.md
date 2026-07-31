# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-31

First working version. Not published: build it yourself and install the `.vsix`.

### Added

- **Core rules** (`src/core/tracking.ts`): segments and time entries, one entry
  per branch and one per commit on the main branch, the commit as the dividing
  line of a running segment, closing an entry by hand with its final text, and a
  per-branch switch between the two modes.
- **State handling** (`src/core/state-store.ts`) with a version counter, because
  atomic replacement alone still loses updates when the hook and the editor
  write at the same moment. An unreadable state file is moved aside rather than
  overwritten — it is the only trace of time that never reached ProSonata.
- **API client** for `projects`, `projecttimecategories` and `projecttimes`,
  plus an in-memory double for the tests that reproduces the behaviour measured
  against a live account rather than the documented one.
- **Deferred sending**: a write goes out once it is older than ten minutes, so
  rolled-back commits never reach ProSonata. Sums are written as
  `foreign + own`, so a second machine adds to an entry instead of overwriting
  it.
- **Multi-machine support**: an open entry is found again through the branch key
  in its marker. Recovering from a lost state file takes the same path — a
  machine with no state is indistinguishable from one that has never seen the
  branch.
- **`post-commit` hook** with absolute paths to Node and the CLI, because a hook
  started from a GUI git client inherits an environment without nvm, and a
  filter that keeps unconfigured repositories from starting Node at all.
- **CLI** `prosonata init | start | pause | status | send`.
- **Extension**: status bar with seconds, side bar panel, watcher on the state
  file, HEAD watching for branch switches, warnings for a long run without a
  commit and for a commit with no timer, hourly `fetch --prune` to notice closed
  pull requests, and account setup from inside the editor — the terminal is
  never needed.
- **Sandbox** (`npm run sandbox`) with its own state directory and repository,
  so the extension can be tried without touching a real account.
- **Icons** for the activity bar, the view and the extension page, normalised by
  `npm run icons` after every export.

### Notes

- A text over the `detail` limit is **not** sent: ProSonata truncates silently
  instead of refusing, and a cut sentence on an invoice is worse than a write
  that waits.
- The binary is called `prosonata`, not `ps` — that name belongs to the Unix
  process listing.
- Per-repository settings use the id as the **subsection**
  (`prosonata.166.category`), because git rejects a key whose last part does not
  start with a letter.
- The extension is named `:Profitlich` and is **not an official ProSonata
  product**. It is written as if it were published, so that publishing later
  would not require untangling anything first.
