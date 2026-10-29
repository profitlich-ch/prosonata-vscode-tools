# CLAUDE.md – Projektkonventionen

VS-Code-Extension mit CLI und Git-Hook. Kein Toolkit-Konsument: Die Konventionen aus
`template-toolkit/CLAUDE.md` gelten hier **nicht**. Es gilt die globale `CLAUDE.md`, dazu was
hier steht. Fachliche Entscheidungen und ihre Begründungen stehen in [KONZEPT.md](KONZEPT.md).

## Sprache

**Commit-Messages, README und Changelog sind englisch**, seit 0.26.0 – die Oberfläche ist
englisch mit deutscher Übersetzung (KONZEPT.md §10). `KONZEPT.md`, diese Datei und `docs/`
bleiben deutsch.

**Jeder sichtbare Text geht durch `t()`** aus `core/l10n.ts`, englisch, mit der deutschen Fassung
in `l10n/bundle.l10n.de.json`; Titel aus `package.json` in `package.nls.json` und
`package.nls.de.json`. Das erste Argument von `t()` ist ein String-Literal mit `{0}`-Platzhaltern,
kein Template-String – nur so findet der Test die fehlenden Übersetzungen.

## Jede neue Version wird installiert

Ein Release ist erst fertig, wenn die neue Fassung auch läuft. Nach dem Versions-Commit:

```sh
npm run package        # baut und schnürt das .vsix
npm run install-vsix
```

Danach VS Code neu laden, damit die Extension neu startet.

**Warum das eine Regel ist und keine Empfehlung.** Am 4. September 2026 war `0.9.0` vom 3. August
installiert, während im Repo `0.11.2` stand. Drei Fehlerbehebungen liefen dadurch ins Leere —
darunter die Ursache von 61 doppelt angelegten Zeiteinträgen, die als Rechnungspositionen bei
Kunden landeten. Eine behobene Ursache richtet weiter Schaden an, solange die alte Fassung
installiert ist, und dieses Werkzeug schreibt in ein Abrechnungssystem: Der Schaden ist nicht
weg, wenn man ihn bemerkt.

Der Abstand fällt von selbst nicht auf, weil nichts die installierte Fassung mit dem Repo
vergleicht. Nachsehen lässt er sich so:

```sh
ls -d ~/.vscode/extensions/*prosonata*      # installierte Version
grep '"version"' package.json               # Stand im Repo
```

## Der Hook ist ein eigener Prozess

`post-commit` läuft ohne VS Code, oft aus einem GUI-Client ohne nvm im `PATH`. Deshalb schreibt
`prosonata init` absolute Pfade in den Hook, und deshalb liegt der Zustand in `~/.prosonata/`
statt in VS Codes `globalState` (KONZEPT.md §7 und §8).

Daraus folgt für jede Änderung am Schreibweg: **Extension, CLI und Hook schreiben gleichzeitig.**
Wer zwischen Lesen und Schreiben einen API-Aufruf legt, muss das Ergebnis auf den *aktuellen*
Zustand anwenden statt ihn zu ersetzen — der Compare-and-Swap schützt die Datei, nicht den Aufruf
(KONZEPT.md §7).
