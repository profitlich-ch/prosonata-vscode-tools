:Profitlich
===========

Tools for my own work in VS Code. One for now: **time tracking**, tied to commits
and branches, writing to [ProSonata](https://www.prosonata.de). A VS Code
extension and a command line tool over the same core.

**Not an official ProSonata product**, and not in the marketplace — build it
yourself, see [Getting started](#getting-started). It is written as if it were
published, though: nothing here would have to be untangled first.

The problem it solves: timers get forgotten. A forgotten start is lost time, a
forgotten stop is wrong time, and both end in guesswork. And what was worked on
is described best where the work happens — in the editor, at the commit.

**Start and pause stay manual. Everything after that happens by itself.**

## How it works

A **segment** is measurement and stays on your machine. A **time entry** is what
ProSonata sees. Many segments make one entry.

| Where you work | What ProSonata gets |
|---|---|
| On a branch | **One entry per branch**, growing over its whole life |
| On the main branch | **One entry per commit** |

A branch is the natural bracket around a piece of work a customer pays for as a
unit. "Booking module: 12.5 h" is the line that belongs on an invoice — not
fifteen commit subjects. On the main branch, where maintenance happens, each
commit is a finished small thing of its own.

The invoice text comes from the commit. Either from a trailer:

```
fix: rounding error in the second discount tier

Prosonata: corrected the discount calculation in the shop
```

or, failing that, from the subject line.

While an entry is open it carries a marker: `[LAUFEND:a3f9c1] Booking module`.
It makes an unfinished entry visible in ProSonata — the API has no status field
— and it carries the branch identity, so a second machine finds the same entry
and adds to it instead of starting its own.

## Getting started

```
npm install && npm run build
npm link                  # makes "prosonata" available
cd /path/to/your/repo
prosonata init
```

`init` asks for the base URL and an API key, writes them to
`~/.prosonata/config.json` with mode 0600, lets you pick a project and a
category, and installs the `post-commit` hook.

**Use a personal user key, not an app integration.** An integration is not a
user: its responses carry no `requestUserID`, so it is unclear whom a created
entry belongs to, and `userID=myself` has nothing to refer to.

## Commands

```
prosonata start     start or resume the timer of this branch
prosonata pause     pause it and book the running segment
prosonata status    what is running, what is open, what is waiting
prosonata send      send everything that is due right now
```

In VS Code the same lives in the status bar and in the ProSonata panel in the
side bar: project, grid, branch mode, the running timer and the open entries.

## What it deliberately does not do

- **No activity detection.** File system activity is not the same as billable
  time. The tool warns, it never books on its own.
- **No automatic start** on checkout, merge or opening the editor.
- **No times in your repository.** They would sit in the customer's repository
  and show them the effort per commit.
- **Nothing is sent at commit time.** A write goes out once it is older than ten
  minutes, so a rolled-back commit never reaches ProSonata at all.

## Development

```
npm run typecheck
npm test
npm run build
```

`src/core` holds all the rules and never imports `vscode`, which is why the hook
can use them. `src/cli` and `src/extension` are two front ends over the same
core — a commit from the terminal behaves exactly like one from the editor.

The full reasoning, including the alternatives that were rejected and why, is in
[KONZEPT.md](KONZEPT.md) (German). The API behaviour it relies on was measured
against a live account; the requests are in [bruno/](bruno/).

## Licence

MIT — see [LICENSE](LICENSE).
