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

#### Ohne Terminal

Befehlspalette → Aus VSIX installieren…

#### Im Terminal

```sh
code --install-extension prosonata-vscode-tools-<version>.vsix
```

### Aus dem Quellcode

Voraussetzung ist eine Node-Umgebung. Gebaut, gepackt und installiert wird in
einem Schritt — am Ende steht dieselbe `.vsix` wie oben:

```sh
npm install
npm run install-vsix
```

Fürs Update dasselbe noch einmal, nach `git pull`.

## Konfiguration

Öffne aus der Seitenleiste das :P Menü und klicke ‹ProSonata: Konto einrichten›. Es fragt nach der ProSonata Basis-URL und einem Benutzer-API-Key und schreibt beides mit Modus 0600 nach `~/.prosonata/config.json`.

**Nutze einen persönlichen Benutzer-Key, keine App-Integration**, damit die Zeiteinträge mit deinem User verknüpft sind.

## Einstellungen pro Repository

Klicke **ProSonata: Projekt für dieses Repository wählen** — es verknüpft das Repository mit einem Projekt und installiert den `post-commit`-Hook.

Direkt danach fragt die Erweiterung nach der **Zeitkategorie**. ProSonata verlangt sie bei jedem Zeiteintrag; solange keine gewählt ist, wird nichts geschrieben. Ändern lässt sie sich jederzeit über die Zeile *Kategorie* im Panel, und die Änderung greift auch auf die noch offenen Zeiteinträge durch.

Auch das Projekt lässt sich später korrigieren. Weil ein Wechsel fast immer ein Versehen richtigstellt, wandern alle noch nicht fertigen Zeiteinträge dieses Repositories mit — auch die, die in ProSonata bereits stehen, und samt der laufenden Messung. Liegen bleibt nur, was abgeschlossen ist und dessen Abschluss ProSonata schon erreicht hat; ist ein solcher Eintrag dort sogar fakturiert, entsteht statt einer Änderung ein Folgeeintrag im neuen Projekt.

Zusätzlich kannst du das Zeitraster wählen und ob Zeiteinträge an Branches oder an Commits gebunden werden. Das Zeitraster wirkt auf alle noch offenen Zeiteinträge, sobald diese das nächste Mal geschrieben werden. Der Wechsel auf «ein Eintrag pro Commit» dagegen schliesst den offenen Branch-Eintrag und fragt vorher nach seinem endgültigen Text.

Das **Zeitraster gilt allein für den Zeiteintrag**, der nach ProSonata geht — nie für die Segmente. Gemessen und im Log gezeigt wird sekundengenau; gerundet wird erst beim Schreiben, und zwar die Gesamtsumme des Eintrags, nicht jedes Segment für sich. So summieren sich keine Rundungen auf. Gerundet wird **aufwärts**, auf die nächste Stufe: Bei einem Raster von 15 Minuten werden aus gemessenen 2:05 h gebuchte 2.25 h.

Wählt ein Repository kein eigenes Raster, gilt die Vorgabe aus `~/.prosonata/config.json` (`"grid"`). Sie steht auf `exakt` und lässt sich nur dort ändern — wer grundsätzlich viertelstündlich abrechnet, setzt sie einmal und muss es nicht in jedem Repository wiederholen.

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

## Auf mehreren Computern

Die Kennung im Marker entsteht aus dem ersten Commit des Repositories und dem
Branchnamen — in jedem Klon dieselbe. Der zweite Computer findet den Zeiteintrag
deshalb wieder und **ergänzt** ihn, statt einen zweiten anzulegen. Vorausgesetzt
ist, dass nicht beide gleichzeitig messen.

Zwei **Personen** stören einander dagegen nicht: Zeiten gehören in ProSonata
Benutzern, und jede führt ihren eigenen Eintrag pro Branch.

Läuft auf einem anderen Computer gerade ein Timer auf demselben Branch, sagt es
dir das beim Starten. Mehr nicht — anhalten lässt sich ein Timer auf einem
zugeklappten Rechner nicht.

Schliesst ein Computer den Eintrag ab, während auf dem anderen noch Zeit
angefallen ist, wird dort gefragt: **zum abgeschlossenen Eintrag hinzufügen**
oder **einen neuen anlegen**. Geschrieben wird bis zur Antwort nichts, und der
abgeschlossene Eintrag wird nie ungefragt wieder angefasst.

## Wenn ein Timer vergessen geht

Läuft ein Segment stundenlang am Stück, fragt die Erweiterung, **wie viel davon
zählt** — alles, eine eigene Dauer, oder nichts. Sie rät nicht: Ein Timer, der
über Nacht lief, hat Wanduhrzeit gemessen, und was davon Arbeit war, weisst nur
du. Im Terminal macht `prosonata pause 1:30` dasselbe.

**Vor- und zurückdrehen** lässt sich die Zeit über das Stift-Symbol an der
Timer-Zeile oder über «ProSonata: Zeit korrigieren». Getippt wird entweder eine
Dauer oder eine Uhrzeit:

| Eingabe | Bedeutung |
|---|---|
| `25` | bietet `+25` und `−25` an |
| `-25`, `+1:30` | genau diese Richtung |
| `ab 9:40` | ich arbeite seit 9:40 — der Beginn des laufenden Segments wandert dorthin |
| `bis 9:40` | ich habe um 9:40 aufgehört — es wird bis dahin gebucht und der Timer angehalten |

**Uhrzeiten setzen einen laufenden Timer voraus.** Sie ändern das laufende
Segment; steht der Timer, gibt es keines, das sie meinen könnten. Nachtragen
lässt sich dann über eine Dauer — `+20` bucht zwanzig Minuten, ohne zu
behaupten, wann sie angefallen sind. Im Log steht eine solche Korrektur deshalb
ohne Anfangszeit.

Jede Zeile zeigt vorher, was sie bewirkt: `7:13:09 → 0:40:00`. Weiter zurück als
bis zum **Ende des letzten Segments** reicht keine Korrektur — ein
abgeschlossenes Segment sagt ja gerade, dass bis dahin alles richtig erfasst
ist. Wird deshalb gekürzt, sagt dieselbe Zeile, was stattdessen geht und woran
es liegt: „erst ab 14:25 → so weit reicht das letzte Segment".
Unter null fällt ein Eintrag ebenfalls nie. Im Terminal:
`prosonata adjust "bis 9:40"`.

Beim Schliessen des letzten VS-Code-Fensters wird pausiert. Abschalten lässt
sich das mit `"pauseOnWindowClose": false` in `~/.prosonata/config.json`.

Die Statusleiste zeigt, was der Branch **insgesamt** gesammelt hat — die Zahl,
die auf die Rechnung geht. Das laufende Segment steht im Tooltip, zusammen mit
Branch und Versandstand. Im Panel stehen beide Zahlen nebeneinander, das
laufende Segment zuerst: `0:42:13 · 3:48:02`.

## Nacharbeit nach dem Commit

Auf `main` schliesst jeder Commit seinen Zeiteintrag. Wer danach noch
nacharbeitet — der letzte Blick, das Deployment, der Anruf — und nicht mehr
committet, hat Zeit gemessen, die zum eben gemachten Commit gehört. Sie ginge
sonst erst mit dem **nächsten** Commit hinaus, unter dessen Text.

Dafür steht in der Seitenleiste **Nicht gebucht**, sobald solche Zeit daliegt;
im Terminal heisst das `prosonata attach`. Zugeschlagen wird immer dem zuletzt
abgeschlossenen Eintrag dieses Branches, und zwar als reine Summe — Text und
Datum dort bleiben, wie sie sind. Bestätigt wird vorher, mit den Zahlen:

    5 Minuten an «Kirby Update, Startseite Linkfarbe» (2026-08-02)
    2.00 h wird 2.25 h

Die zweite Zeile ist der Grund für die Rückfrage: Das Zeitraster rundet **auf**,
eine Viertelstunde als Raster macht aus fünf Minuten also eine Viertelstunde.
Ein bereits **fakturierter** Eintrag wird abgelehnt — das geht nur noch in
ProSonata selbst.

## Der Log

Das Uhr-Symbol in der Titelleiste des ProSonata-Panels öffnet alle gemessenen
Segmente als gesetzte Vorschau, nach Tagen gruppiert, mit einer Branch-Auswahl
davor. Bearbeiten lässt sie sich nicht: Das Protokoll ist ein Archiv, und was
abgerechnet wird, steht im Zeiteintrag. Korrigiert wird deshalb über die
Zeitkorrektur, nicht im Text.

Die Branch-Liste stammt aus dem Protokoll unter `~/.prosonata/segments.jsonl`,
nicht aus Git — **gelöschte Branches behalten damit ihre Stunden**. Das
Protokoll wird nie gekürzt; es beantwortet als einziges, wie viel an welchem
*Tag* gearbeitet wurde. Ein Zeiteintrag trägt nur eine Summe und das Datum
seines letzten Schreibvorgangs.

Aufgezeichnet wird, was auf diesem Computer gemessen wurde. Was auf einem
anderen anfiel, steht in ProSonata, aber nicht hier.

Im Terminal: `prosonata log`, `log alle`, `log <branch>`, `log ?` für die Liste.

## CLI Befehle

```sh
prosonata init                    Konto und dieses Repository einrichten, Hook installieren
prosonata start                   Timer dieses Branches starten oder fortsetzen
prosonata pause [h:mm|Minuten]    Timer pausieren; mit Dauer wird nur diese gebucht
prosonata status                  was läuft, was ist offen, was wartet
prosonata send                    alles senden, was gerade fällig ist

prosonata project                 Projekt dieses Repositories wählen
prosonata category                Zeitkategorie dieses Projekts wählen
prosonata grid [exakt|5|15|30]    auf so viele Minuten runden
prosonata mode [branch|commit]    ein Eintrag pro Branch oder pro Commit
prosonata close [Text]            offenen Zeiteintrag abschliessen und senden
prosonata text <Text>             Text des offenen Zeiteintrags ändern
prosonata resume [add|neu]        anderswo abgeschlossenen Eintrag entscheiden
prosonata log [Branch|alle|?]     gemessene Segmente, ohne Branch die dieses
prosonata adjust <Wert>           Zeit korrigieren: ±25, ±1:30, "ab 9:40", "bis 9:40"
```

Was ein Argument nimmt, fragt danach, wenn es weggelassen wird — mit Argument
läuft der Befehl ohne Rückfrage durch und taugt damit auch für Skripte.

## Was die Extension nicht tut

- **Keine Aktivitätserkennung.** Aktivität im Dateisystem ist nicht dasselbe wie
  abrechenbare Zeit. Das Werkzeug warnt, es bucht nie von selbst.
- **Kein automatischer Start** bei Checkout, Merge oder beim Öffnen des Editors.
- **Kein Anhalten aus der Ferne.** Läuft auf einem anderen Computer ein Timer,
  warnt es — anhalten kann es ihn nicht, und die Zeit für dich buchen erst
  recht nicht.
- **Keine Speicherung im Repository.** Sie lägen im Repository des Kunden und
  zeigten ihm den Aufwand pro Commit. Alle Segmente liegen lokal auf dem Computer.
- **Zum Commit-Zeitpunkt wird nichts gesendet.** Ein Schreibvorgang geht raus,
  sobald er älter als zehn Minuten ist, damit ein zurückgenommener Commit gar
  nicht erst bei ProSonata ankommt.

## Entwicklung

### Eine Änderung ausprobieren

Dafür wird nichts installiert. **F5** startet ein zweites VS-Code-Fenster, in dem
die Erweiterung direkt aus diesem Arbeitsverzeichnis läuft. Zur Auswahl stehen
zwei Startkonfigurationen:

- **Extension im echten Konto** — mit deinem `~/.prosonata` und deinen Projekten.
  Was du dort tust, landet in ProSonata.
- **Extension in der Sandbox** — mit eigenem Zustandsverzeichnis und einem
  Wegwerf-Repository unter `.sandbox`, das bereits Projekt, Kategorie und Hook
  hat. Die Basis-URL zeigt ins Leere, gesendet wird also nichts; alle
  Schreibvorgänge sammeln sich sichtbar in der Warteschlange.

Die Sandbox muss vorher angelegt werden — der Befehl baut sie jedes Mal neu:

```sh
npm run sandbox                   # offline
npm run sandbox -- --live 166 70  # echtes Konto, Projekt 166, Kategorie 70
```

Die zwei Striche vor `--live` müssen sein: Ohne sie schluckt npm das Argument,
und die Sandbox läuft offline weiter, als hätte man nichts gesagt.

### Prüfen und bauen

```sh
npm run check    # Typen, Tests, Build in einem
npm run watch    # baut bei jeder Änderung neu
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
