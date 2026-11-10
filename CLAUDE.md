# CLAUDE.md – Projektkonventionen

VS-Code-Extension mit CLI und Git-Hook. Kein Toolkit-Konsument: Die Konventionen aus
`template-toolkit/CLAUDE.md` gelten hier **nicht**. Es gilt die globale `CLAUDE.md`, dazu was
hier steht. Fachliche Entscheidungen und ihre Begründungen stehen in [KONZEPT.md](KONZEPT.md).

## Sprache

**Commit-Messages, README und Changelog sind englisch**, seit 0.26.0 – die Oberfläche ist
englisch mit deutscher Übersetzung (KONZEPT.md §10). `KONZEPT.md`, diese Datei und `docs/`
bleiben deutsch.

**Die README gibt es zweimal:** `README.md` englisch, `README.de.md` deutsch. Jede Änderung
an der einen gehört im selben Commit in die andere. `src/readme.test.ts` vergleicht den Aufbau
(Abschnitte, Codeblöcke, Tabellenzeilen), nicht den Wortlaut – einen geänderten Satz findet er
nicht. Begriffe aus der Oberfläche stehen in der deutschen Fassung so, wie sie in
`l10n/bundle.l10n.de.json` und `package.nls.de.json` heissen.

**Jeder sichtbare Text geht durch `t()`** aus `core/l10n.ts`, englisch, mit der deutschen Fassung
in `l10n/bundle.l10n.de.json`; Titel aus `package.json` in `package.nls.json` und
`package.nls.de.json`. Das erste Argument von `t()` ist ein String-Literal mit `{0}`-Platzhaltern,
kein Template-String – nur so findet der Test die fehlenden Übersetzungen.

## Veröffentlichen macht Moritz

Die Extension steht im VS Code Marketplace und auf Open VSX. Veröffentlicht wird durch
`.github/workflows/release.yml`, und der läuft erst, wenn auf GitHub ein **Release** zum Tag
angelegt wird – nicht beim Tag-Push. Das ist die Regel „`npm publish` macht immer Moritz“,
übertragen auf die Stores: Claude legt nach dem Gegencheck der Tags einen **Release-Entwurf**
mit dem Changelog-Abschnitt an (Skill `release`, Schritt 5) und meldet dessen Link;
veröffentlicht wird er von Moritz. Eine veröffentlichte Versionsnummer lässt sich im Marketplace
nicht ersetzen, nur durch eine höhere überholen.

Die ID `profitlich.prosonata-vscode-tools` darf sich nie ändern: Sie ist der Schlüssel in
ProSonatas `apiComments` (`EXTENSION_ID` in `src/core/api-comments.ts`).

## Jede neue Version wird installiert

Ein Release ist erst fertig, wenn die neue Fassung auch läuft. **Ein Release kommt aus dem
Marketplace**, sobald der Workflow es dort veröffentlicht hat:

```sh
code --install-extension profitlich.prosonata-vscode-tools --force
```

Danach VS Code neu laden, damit die Extension neu startet, und nachsehen, dass VS Code sie als
Marketplace-Installation führt und weiter aktualisiert – `source: "gallery"`, ohne
`pinned: true`:

```sh
node -e 'const l=require(process.env.HOME+"/.vscode/extensions/extensions.json");console.log(l.filter(e=>e.identifier.id==="profitlich.prosonata-vscode-tools").map(e=>[e.version,e.metadata]))'
```

**`pinned: true` ist der Befund, nicht `source`.** Auch eine Installation aus dem Marketplace kann
angeheftet sein; gemessen am 2026-11-10 mit 1.0.1. Dann ist das automatische Aktualisieren für
diese Extension aus und wird in der Erweiterungsansicht in ihrem Kontextmenü wieder eingeschaltet.

**`npm run install-vsix` nur für einen Stand vor dem Release**, und nie als Ersatz für das
Warten auf den Marketplace. VS Code heftet eine VSIX-Installation an (`source: "vsix"`,
`pinned: true`) und aktualisiert sie danach nicht mehr – auch nicht, wenn der Marketplace eine
höhere Version hat. Wer per VSIX ausprobiert hat, installiert nach dem nächsten Release aus dem
Marketplace neu und prüft die Anheftung, wie oben.

*Anlass:* Nach dem Release von 2.0.0 wurde der Release-Stand per VSIX installiert, «bis VS Code
sie holt», wie es hier stand. Geholt hätte VS Code danach nie mehr etwas (`v2.0.0`, 2026-11-10).

**Warum das eine Regel ist und keine Empfehlung.** Am 4. September 2026 war `0.9.0` vom 3. August
installiert, während im Repo `0.11.2` stand. Drei Fehlerbehebungen liefen dadurch ins Leere —
darunter die Ursache von 61 doppelt angelegten Zeiteinträgen, die als Rechnungspositionen bei
Kunden landeten. Eine behobene Ursache richtet weiter Schaden an, solange die alte Fassung
installiert ist, und dieses Werkzeug schreibt in ein Abrechnungssystem: Der Schaden ist nicht
weg, wenn man ihn bemerkt.

Der Abstand fällt von selbst nicht auf, weil nichts die installierte Fassung mit dem Repo
vergleicht – und eine angeheftete VSIX-Installation lässt ihn mit jedem Release wachsen.
Nachsehen lässt er sich so:

```sh
ls -d ~/.vscode/extensions/*prosonata*      # installierte Version
grep '"version"' package.json               # Stand im Repo
```

## Die Hooks sind eigene Prozesse

`post-commit` und `post-checkout` laufen ohne VS Code, oft aus einem GUI-Client ohne nvm im
`PATH`. Deshalb schreibt `prosonata init` absolute Pfade in die Hooks, und deshalb liegt der
Zustand in `~/.prosonata/` statt in VS Codes `globalState` (KONZEPT.md §7 und §8).

Daraus folgt für jede Änderung am Schreibweg: **Extension, CLI und Hooks schreiben gleichzeitig.**
Wer zwischen Lesen und Schreiben einen API-Aufruf legt, muss das Ergebnis auf den *aktuellen*
Zustand anwenden statt ihn zu ersetzen — der Compare-and-Swap schützt die Datei, nicht den Aufruf
(KONZEPT.md §7).
