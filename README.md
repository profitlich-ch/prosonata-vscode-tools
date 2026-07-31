Prosonata Tools für Visual Studio Code
===========

Diese VS-Code-Erweiterung ermöglicht es, [ProSonata](https://www.prosonata.de)-Zeiteinträge direkt aus VS Code anzulegen, gebunden an Commits und Branches, per ProSonata-API. Statt in der SaaS-Oberfläche von ProSonata einen Timer zu starten und die Beschreibung von Hand einzutragen, startest du den Timer in VS Code, und die gemessene Zeit wird zu einem Zeiteintrag pro Branch (alternativ: pro Commit) — mit einer Beschreibung, die aus dem Commit stammt.

Dies ist kein offizielles ProSonata-Produkt. Es steht nicht im Marketplace, du musst es von Hand installieren.

## Installation

Nach Installation/Update das Fenster neu laden (Entwickler: Fenster neu laden), und die Erweiterung erscheint in jedem VS-Code-Fenster. Updates müssen manuell installiert werden.

### Fertiges Paket

Für Installation und Update die `.vsix` des jüngsten
[Release](https://github.com/profitlich-ch/prosonata-vscode-tools/releases)
laden und installieren:

```sh
code --install-extension prosonata-vscode-tools-<version>.vsix
```

### Aus dem Quellcode

Voraussetzung ist eine Node-Umgebung.

#### Installation

```sh
npm install
npm run install-local     # baut und verlinkt das Repo nach ~/.vscode/extensions
```

#### Update

```sh
git pull
npm run build
```

## Konfiguration

Öffne aus der Seitenleiste das :P Menü und klicke ‹ProSonata: Konto einrichten›. Es fragt nach der ProSonata Basis-URL und einem Benutzer-API-Key und schreibt beides mit Modus 0600 nach `~/.prosonata/config.json`.

**Nutze einen persönlichen Benutzer-Key, keine App-Integration**, damit die Zeiteinträge mit deinem User verknüpft sind.

## Einstellungen pro Repository

Klicke **ProSonata: Projekt für dieses Repository wählen** — es verknüpft das Repository mit einem Projekt und installiert den `post-commit`-Hook.

Direkt danach fragt die Erweiterung nach der **Zeitkategorie**. ProSonata verlangt sie bei jedem Zeiteintrag; solange keine gewählt ist, wird nichts geschrieben. Ändern lässt sie sich jederzeit über die Zeile *Kategorie* im Panel, und die Änderung greift auch auf die noch offenen Zeiteinträge durch.

Auch das Projekt lässt sich später korrigieren. Weil ein Wechsel fast immer ein Versehen richtigstellt, wandern alle noch nicht fertigen Zeiteinträge dieses Repositories mit — auch die, die in ProSonata bereits stehen, und samt der laufenden Messung. Liegen bleibt nur, was abgeschlossen ist und dessen Abschluss ProSonata schon erreicht hat; ist ein solcher Eintrag dort sogar fakturiert, entsteht statt einer Änderung ein Folgeeintrag im neuen Projekt.

Zusätzlich kannst du das Zeitraster wählen und ob Zeiteinträge an Branches oder an Commits gebunden werden. Das Zeitraster wirkt auf alle noch offenen Zeiteinträge, sobald diese das nächste Mal geschrieben werden. Der Wechsel auf «ein Eintrag pro Commit» dagegen schliesst den offenen Branch-Eintrag und fragt vorher nach seinem endgültigen Text.

Alle Befehle stehen auch als [CLI Befehle](#cli-befehle) zur Verfügung.

## Funktionsweise

Während der Arbeit in VS Code werden Zeiten als **Segmente** lokal auf dem
Computer gespeichert. Ein **Zeiteintrag** ist das, was in ProSonata gespeichert wird.
Ein Zeiteintrag entsteht aus beliebig vielen Segmenten.

Nach ProSonata geschrieben wird nicht erst am Schluss: Zehn Minuten nach einem
Commit legt das Werkzeug den Zeiteintrag an und aktualisiert ihn
danach bei jedem weiteren Schreibvorgang mit der gewachsenen Summe. Ein
Branch-Eintrag steht also von Anfang an in ProSonata und wächst dort mit. Der
Abschluss ist nur das letzte Update.

| Wo du arbeitest | Was ProSonata bekommt |
|---|---|
| Auf einem Branch | Ein Eintrag pro Branch, der über dessen ganze Lebensdauer wächst (alternativ: pro Commit) |
| Auf dem Main-Branch | Ein Eintrag pro Commit |

Die Konzeptidee: Ein Branch ist das Stück Arbeit, das ein Kunde als Einheit bezahlt. Commits sind eher Zwischenschritte, die der Kunde nicht zu sehen braucht. Wird hingegen auf dem Main-Branch gearbeitet, ist es Wartung und jeder Commit ist es Wert als Zeiteintrag erfasst zu werden.

Der Text des Zeiteintrags kommt aus dem Commit, aus einem mit `Prosonata:` beginnenden Trailer:

```txt
fix: Rundungsfehler in der zweiten Rabattstufe

Prosonata: Rabattberechnung im Shop korrigiert
```

Auf dem Main-Branch, wo jeder Commit seinen eigenen Eintrag abschliesst, gilt
die Betreffzeile, wenn es keinen Trailer gibt. Auf einem Branch dagegen zählt nur der Trailer; der zuletzt in einem Commit geschriebene gewinnt, normale Betreffzeilen
bleiben aussen vor. Solange ein offener Eintrag keinen Text hat, wird er nicht
nach ProSonata geschrieben.

Solange ein Eintrag offen ist, trägt er eine Markierung:
`[LAUFEND:a3f9c1] …`. Sie macht einen unfertigen Eintrag in
ProSonata sichtbar — die API hat kein Statusfeld — und sie trägt die Identität
des Branches, sodass es möglich ist, auf weiteren Computern am selben Branch zu arbeiten.

## CLI Befehle

```sh
prosonata init                    Konto und dieses Repository einrichten, Hook installieren
prosonata start                   Timer dieses Branches starten oder fortsetzen
prosonata pause                   Timer pausieren und das laufende Segment buchen
prosonata status                  was läuft, was ist offen, was wartet
prosonata send                    alles senden, was gerade fällig ist

prosonata project                 Projekt dieses Repositories wählen
prosonata category                Zeitkategorie dieses Projekts wählen
prosonata grid [exakt|5|15|30]    Zeitraster setzen
prosonata mode [branch|commit]    an Branch oder an Commits binden
prosonata close [Text]            offenen Zeiteintrag abschliessen und senden
prosonata text <Text>             Text des offenen Zeiteintrags ändern
```

Was ein Argument nimmt, fragt danach, wenn es weggelassen wird — mit Argument
läuft der Befehl ohne Rückfrage durch und taugt damit auch für Skripte.

## Was die Extension nicht tut

- **Keine Aktivitätserkennung.** Aktivität im Dateisystem ist nicht dasselbe wie
  abrechenbare Zeit. Das Werkzeug warnt, es bucht nie von selbst.
- **Kein automatischer Start** bei Checkout, Merge oder beim Öffnen des Editors.
- **Keine Speicherung im Repository.** Sie lägen im Repository des Kunden und
  zeigten ihm den Aufwand pro Commit. Alle Segmente liegen lokal auf dem Computer.
- **Zum Commit-Zeitpunkt wird nichts gesendet.** Ein Schreibvorgang geht raus,
  sobald er älter als zehn Minuten ist, damit ein zurückgenommener Commit gar
  nicht erst bei ProSonata ankommt.

## Entwicklung

```sh
npm run typecheck
npm test
npm run build
```

`src/core` enthält alle Regeln und importiert nie `vscode` — deshalb kann der
Hook sie verwenden. `src/cli` und `src/extension` sind zwei Frontends über
demselben Kern: Ein Commit aus dem Terminal verhält sich genau wie einer aus dem
Editor.

Die vollständige Begründung, inklusive der verworfenen Alternativen und der
Gründe dafür, steht in [KONZEPT.md](KONZEPT.md). Das API-Verhalten, auf das sich
das Werkzeug stützt, wurde gegen ein Live-Konto gemessen; die Requests liegen in
[bruno/](bruno/).

## Lizenz

MIT — siehe [LICENSE](LICENSE).
