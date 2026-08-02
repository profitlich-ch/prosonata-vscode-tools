# Changelog

Alle nennenswerten Änderungen an diesem Projekt stehen hier. Das Format folgt
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), die Versionen folgen
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] — 2026-08-02

Der Statusanzeiger zieht aus einem geliehenen API-Feld in die eigene Marke — und
die Felder sagen endlich, was sie in ProSonata bedeuten.

### Geändert

- **Die Marke trägt jetzt, seit wann gemessen wird**:
  `[LAUFEND:a3f9c1][260802-08:12] Text`. Die zweite Klammer steht nur, solange
  ein Timer läuft, und reist mit einem ohnehin fälligen Schreibvorgang — kein
  zusätzlicher Aufruf. Bewusst eine **eigene** Klammer: Ein älterer Stand liest
  `^\[LAUFEND:([0-9a-f]+)\]` und fände eine Marke mit der Zeit *innerhalb* der
  Klammer nicht mehr — er hielte den Eintrag für anderswo abgeschlossen und
  parkte laufende Stunden.
- **Die Warnung über einen fremden Timer kennt den Tag.** Bisher stand dort eine
  Uhrzeit ohne Datum, also klang ein auf einem schlafenden Rechner vergessener
  Timer eine Woche später wie einer von heute früh. Jetzt: „läuft seit 08:12",
  „läuft seit gestern 23:50" oder „trägt seit 30.07. 08:12 eine laufende Messung
  — dort wurde vermutlich das Anhalten vergessen".

### Hinzugefügt

- **Start und Ende in ProSonata**: `workingTimeStart` und `workingTimeEnd`
  tragen die Spanne des Arbeitstages, aus dem Segmentprotokoll — Beginn des
  ersten, Ende des jüngsten Segments, das laufende eingerechnet. Fallen die
  beiden Enden auf verschiedene Tage, werden die Felder **geleert**: Eine Spanne
  sagt nur über einen einzelnen Tag etwas aus. `workingTimeEnd` war bisher gar
  nicht abgebildet.

## [0.6.0] — 2026-08-02

### Hinzugefügt

- **Nacharbeit lässt sich dem letzten Eintrag zuschlagen.** Auf `main` schliesst
  jeder Commit seinen Eintrag; wer danach weiterarbeitet und nicht mehr
  committet, hat Zeit gemessen, die zum eben gemachten Commit gehört. Die
  Seitenleiste zeigt dafür **Nicht gebucht**, im Terminal `prosonata attach`.
  Geschrieben wird nur die neue Gesamtsumme — Text und Datum des Eintrags
  bleiben unberührt.
- **Die Bestätigung nennt die Zahlen, die wirklich hinausgehen**: `2.00 h wird
  2.25 h`. Das Zeitraster rundet auf, fünf Minuten kosten bei
  Viertelstunden-Raster also eine Viertelstunde — das gehört vor den Klick, nicht
  in eine Meldung danach.
- **Fakturierte Einträge werden abgelehnt**, und die Ausgangszahl kommt aus
  ProSonata statt aus dem lokalen Zustand: Dort kann von Hand korrigiert worden
  sein, und geschrieben wird eine Summe.

### Behoben

- **Das Zeitraster eines Repositories erreichte den Versand nie.** Panel und Log
  zeigten es, gerundet wurde beim Schreiben aber immer mit der Vorgabe aus
  `~/.prosonata/config.json` — ein Repository konnte also eine Rundung anzeigen,
  die nie stattfand. Der Versand fragt das Raster jetzt für jeden Eintrag beim
  Repository ab und fällt nur zurück, wenn dort keines gesetzt ist. Damit wirkt
  ein geändertes Raster wie beschrieben auf alle noch offenen Einträge.

### Geändert

- **Die Statusleiste zeigt die Summe des Branches** statt des laufenden
  Segments; das Segment steht im Tooltip. Im Panel stehen weiterhin beide Zahlen.
- **Das Log öffnet als gesetzte Markdown-Vorschau** statt als Text und ist
  wirklich schreibgeschützt. Bisher war es ein unbenanntes Dokument: Man konnte
  hineintippen — wirkungslos —, und beim Schliessen fragte VS Code nach dem
  Speichern einer Datei, die es nie gab.

## [0.5.1] — 2026-08-02

Nachlese zur 0.5.0: vier Fehler, die erst im Alltag auffielen, und ein
einheitliches Vokabular für die Rückmeldungen.

### Behoben

- **Eine Korrektur setzte die Grenze fürs Zurückdrehen.** Ihr Zeitstempel ist
  der Moment der Eingabe, nicht das Ende einer Messung — trotzdem galt er als
  „bis hierhin ist alles erfasst". Wer um 18:05 eine Korrektur eintrug, konnte
  den Beginn eines später gestarteten Segments nur bis 18:05 zurückschieben
  statt bis zum Ende der letzten Messung um 18:04.
- **Negative Zeiten trugen zwei Minuszeichen**: Im Log stand `-1:-15` statt
  `−0:15`.
- **Der Dialog hatte seine Rückmeldung vertauscht.** Ohne Eingabe stand dort
  „nicht möglich", und beim Tippen einer Uhrzeit verschwand der Hinweis — denn
  ein QuickPick filtert seine Zeilen nach dem getippten Text. Die Absage steht
  jetzt im Titel, wo sie sichtbar bleibt; ohne Eingabe werden nur noch Beträge
  angeboten.
- **Die Grenze einer nachgetragenen Dauer nannte den falschen Behälter.** Sie
  sprach vom Eintrag, meinte aber die auf diesem Computer gemessenen Segmente:
  Hat ein anderer Rechner beigesteuert, zeigt der Eintrag mehr, als sich von
  hier abziehen lässt.

### Geändert

- **Die Rückmeldungen sagen zuerst, was möglich ist**, und begründen es mit dem
  Segment, das im Weg steht: `nur +1 Minute → letztes Segment reicht bis 18:04`
  statt „14 Minuten davon sind bereits erfasst". Rückwärts steht das letzte
  Segment im Weg, vorwärts das laufende — beides sagt nun dieselbe Zeile nicht
  mehr gleich.

## [0.5.0] — 2026-08-02

Die Zeit lässt sich vor- und zurückdrehen. Entstanden ist die Fassung aus vier
Rückfragen, und jede hat sie **einfacher** gemacht statt reicher: Erst zeigte
sich, dass ein Anker keine Differenz ist, dann dass ein verschobener Beginn die
Uhrzeiten erfindet, dann dass ein abgeschlossenes Segment alles davor für
erledigt erklärt — womit eine Lückenrechnung überflüssig wurde —, und zuletzt,
dass Uhrzeiten ohne laufendes Segment gar nichts bedeuten.

### Hinzugefügt

- **Die Zeit lässt sich vor- und zurückdrehen** — das Gegenstück zum vergessenen
  Anhalten *und* zum vergessenen Starten, das KONZEPT.md §5 seit jeher
  versprochen hat. Ein QuickPick, das beim Tippen zum Eingabefeld wird: ohne
  Eingabe Schritte von ±5 und ±15 Minuten, mit Eingabe eine Dauer (`+25`,
  `-1:30`) oder eine Uhrzeit. Jede Zeile zeigt vorher ihre Wirkung.
- **Uhrzeiten wirken absolut, nicht als Differenz.** `bis 9:40` heisst „ich habe
  um 9:40 aufgehört": Das laufende Segment wird bis dahin gebucht und der Timer
  **angehalten**. `ab 9:40` heisst „ich arbeite seit 9:40": Der Beginn des
  laufenden Segments wandert dorthin, sodass eine durchgehende Messung entsteht
  statt einer Messung plus Nachtrag.
- **Uhrzeiten setzen einen laufenden Timer voraus.** Sie ändern das laufende
  Segment; steht der Timer, gibt es keines, auf das sie sich beziehen könnten —
  und ein fertiges Segment wird nicht umgeschrieben, weil „alles nach 17:15
  zählt nicht" nicht sagt, welche der gebuchten Spannen schrumpfen soll. Der
  Dialog sagt das und verweist auf die Dauer.
- **Eine nachgetragene Dauer trägt keine Uhrzeiten.** `+20` ohne laufenden Timer
  ist eine Korrektur, keine Messung; im Protokoll steht sie deshalb ohne
  Anfangszeit statt mit einer erfundenen Spanne.
- **Zwei Grenzen, die nie überschritten werden**: Keine Korrektur reicht hinter
  das **Ende des letzten Segments** zurück — ein abgeschlossenes Segment sagt
  gerade, dass bis dahin alles richtig erfasst ist —, und kein Eintrag fällt
  unter null. Wird ein Wunsch deshalb gekürzt, sagt es die Zeile, bevor man sie
  anklickt: „erst ab 14:25 möglich — davor ist alles erfasst". Korrekturen bei
  stehendem Timer stehen als eigene Zeile im Segmentprotokoll und sind die
  einzigen, deren Dauer negativ sein darf.
- **Erreichbar über das Stift-Symbol an der Timer-Zeile**, die Befehlspalette
  und `prosonata adjust`.

### Geändert

- **Die Timer-Zeile im Panel nennt beide Zahlen**, das laufende Segment zuerst,
  dahinter die Summe des Branches: `0:42:13 · 3:48:02`. Sie beantworten
  Verschiedenes — „wie lange sitze ich an diesem Stück" und „was wird
  abgerechnet" —, und nur die erste macht einen vergessenen Timer sichtbar.

## [0.4.1] — 2026-08-01

### Geändert

- **Der Umschalter zwischen „pro Branch" und „pro Commit" hat eine eigene
  Panel-Zeile.** Er hing hinter dem Branchnamen, und Namen wie
  `167-startseite-mobile-tablet-expertise-layout` schieben ihn in einer
  schmalen Seitenleiste aus dem Bild — ausgerechnet die Einstellung, die
  bestimmt, was auf der Rechnung landet. Die Zeile heisst „Zeiteintrag" und
  zeigt „pro Branch" oder „pro Commit".
- **Das README nennt, was seit 0.3.1 dazugekommen ist und überraschen würde**:
  das Pausieren beim Schliessen des Fensters, die Frage nach einem langen
  Segment, den Log samt gelöschten Branches und das Verhalten auf mehreren
  Computern. Keine Feature-Liste — die veraltet und steht hier. Die CLI-Liste
  stimmt wieder mit `prosonata help` überein.

### Behoben

- **Zwei Panel-Zeilen trugen dasselbe Symbol.** `clock` ist in VS Code ein
  Alias auf `history`; das schlichte Zifferblatt heisst `clockface`.

## [0.4.0] — 2026-08-01

Zwei Fehler, die im Betrieb Zeit gekostet hätten, waren nur zu finden, indem die
API gemessen statt gelesen wurde. Dazu bekommt der vergessene Timer — das
eigentliche Problem, für das es dieses Werkzeug gibt — endlich mehr als eine
Warnung: eine Frage, eine Pause beim Zuklappen, und ein Protokoll, das zeigt,
wo die Stunden hingegangen sind.

### Hinzugefügt

- **Ein Protokoll aller gemessenen Segmente**, `~/.prosonata/segments.jsonl`,
  mit Beginn, Ende, Dauer, Branch und dem, was das Segment beendet hat. Es ist
  ein Archiv, kein Puffer: Es wird nicht gekürzt. Damit lässt sich zum ersten
  Mal beantworten, wie viel an welchem **Tag** gearbeitet wurde — ein
  Zeiteintrag trägt nur eine Summe und das Datum seines letzten Schreibvorgangs.
  Eine gekürzte Messung steht mit beidem drin: was behalten wurde und wie lange
  wirklich gelaufen war.
- **Der Knopf „Log" im Panel** zeigt es als Dokument, mit einer Auswahl der
  Branches davor — und die Liste stammt aus dem Protokoll, nicht aus Git:
  **gelöschte Branches behalten ihre Stunden**. Im Terminal dasselbe mit
  `prosonata log [Branch|alle|?]`.
- **Ein laufender Timer ist für andere Rechner sichtbar.** ProSonata hat kein
  Statusfeld, nimmt aber `workingTimeStart` an und zeigt es nur an — die blosse
  Anwesenheit des Werts genügt als Zustand. Er reist mit einem ohnehin fälligen
  Schreibvorgang mit und verschwindet beim Pausieren wieder. Ein zweiter Rechner
  meldet dann beim Start: „Auf einem anderen Rechner läuft seit 09:12 ein Timer
  auf diesem Branch." Nur eine Warnung — anhalten lässt sich ein Timer auf einem
  schlafenden Rechner nicht, und was diese Stunden waren, weiss nur, wer dabei
  war.
- **Der vergessene Timer wird gefragt, nicht geraten.** Läuft ein Segment länger
  als die Schwelle, fragt die Erweiterung „Wie viel davon zählt?" — alles
  behalten, eine eigene Dauer, verwerfen — statt „noch dran?" zu warnen. Nach
  „alles behalten" schweigt sie eine Stunde. Im Terminal bucht
  `prosonata pause [h:mm|Minuten]` dasselbe.
- **Die Statusleiste zeigt das laufende Segment** statt der Eintragssumme:
  `14:22:07` fällt auf, `37:15:44` auf einem lang laufenden Branch nicht. Branch,
  Gesamtsumme und Rückstand stehen im Tooltip.
- **Beim Schliessen des Fensters wird pausiert**, abschaltbar über
  `pauseOnWindowClose` in `~/.prosonata/config.json`. Anhalten ist die
  vorsichtige Richtung; ein Timer, der das Schliessen überlebt, verbucht eine
  Nacht. Starten bleibt eine Entscheidung von Hand.

### Geändert

- **Der Log sitzt in der Titelleiste der Ansicht**, wo VS Code unterbringt, was
  auf die Ansicht wirkt statt auf eine Zeile. Start und Pause sind von dort
  verschwunden: Sie wirken auf den Timer, und dafür gibt es die Timer-Zeile
  darunter, die Statusleiste und die Befehlspalette.

### Behoben

- **Der Tooltip der Statusleiste war noch englisch** — ein Rest der
  Sprachumstellung von 0.3.0.
- **Die Warnung vor einem langen Timer mass das Falsche.** Verglichen wurde die
  Summe des ganzen Eintrags mit der Schwelle — bei einem Branch-Eintrag mit
  zwanzig Stunden also ab der ersten Sekunde nach jedem Start, alle dreissig
  Sekunden. Gemessen wird jetzt das laufende Segment.
- **Ein anderswo abgeschlossener Eintrag wurde wieder aufgerissen.** Schloss
  Rechner A den Branch-Eintrag ab, schrieb Rechner B beim nächsten fälligen
  Schreibvorgang munter weiter hinein: Der Marker landete wieder im Text, der
  endgültige Rechnungstext war überschrieben, der Abschluss faktisch rückgängig.
  Der Abgleich wiederum bemerkte den Abschluss zwar, liess die hier gemessene
  Zeit aber in einem abgeschlossenen Eintrag liegen, wo sie nie gesendet wurde.
  Jetzt wird der Eintrag **geparkt** — nichts wird geschrieben, der Timer läuft
  weiter hinein — und gefragt, wo jemand antworten kann: im Editor mit zwei
  Knöpfen, im Terminal mit `prosonata resume [add|neu]`. „Hinzufügen" schickt
  ein `PUT`, das nur die Summe trägt, damit der endgültige Text unberührt
  bleibt; „neu" fasst die alte `timeID` gar nicht an.
- **Ein Subtree-Import konnte alle Branch-Kennungen ändern.** Der Root-Commit
  wurde als erste Zeile von `git rev-list --max-parents=0 HEAD` genommen — bei
  mehreren Wurzeln also die jüngste. Holt man eine fremde Historie herein, etwa
  einen Subtree, gewinnt deren Wurzel, und jeder Branch des Repositories bekommt
  am selben Tag eine neue Kennung: Offene Zeiteinträge in ProSonata wären nicht
  mehr auffindbar, jeder Rechner legte einen zweiten an. Gesucht wird jetzt
  entlang der First-Parent-Linie, wo nur die eigene Wurzel liegt. In einem der
  hier geprüften Repositories war der Fall bereits eingetreten.
- **Der Abgleich mit ProSonata lief nie.** `Session.sync()` war gebaut und
  getestet, aber von keinem der beiden Frontends aufgerufen — die Übernahme
  eines Eintrags vom anderen Rechner und das Erkennen eines anderswo
  abgeschlossenen Eintrags fanden schlicht nicht statt. Jetzt fragt das Werkzeug
  beim **Öffnen eines Fensters** und beim **Start des Timers** nach, letzteres
  nur, wenn es lokal keinen offenen Eintrag für diesen Branch gibt. Scheitert
  die Abfrage, startet der Timer trotzdem und der Grund landet im Journal:
  Messen geht ohne Netz, nur Senden nicht.
- **Eine leere Antwort galt als Fehler.** Findet eine Suche nichts, antwortet
  ProSonata mit `204 No Content` und leerem Körper — am Konto gemessen, nicht
  dokumentiert. `JSON.parse('')` machte daraus „ProSonata hat mit etwas anderem
  als JSON geantwortet": Der Alltagsfall „dieser Branch hat noch keinen Eintrag"
  sah aus wie eine kaputte Schnittstelle. Ein leerer Körper ist jetzt ein leeres
  Ergebnis; bleibt der Status ein Fehlerstatus, bleibt es ein Fehler.
- **Zwei Personen am selben Branch buchten in denselben Zeiteintrag.** Die
  Branch-Kennung ist ein Hash aus Root-Commit und Branchname und damit in jedem
  Klon gleich — auch im Klon einer anderen Person. Die Suche nach dem offenen
  Eintrag filterte aber nur nach Projekt und Marker, nicht nach Benutzer: Wer
  als Zweiter dazukam, übernahm den fremden Eintrag und schrieb hinein, sodass
  seine Stunden in der Zeiterfassung des anderen landeten — oder gar nicht, wenn
  die Rechtestufe das Schreiben auf fremde Einträge verweigert. Die Abfrage
  filtert jetzt auf `userID=myself`; jede Person führt ihren eigenen Eintrag pro
  Branch, so wie ProSonata Zeiten ohnehin Benutzern zuordnet.

## [0.3.1] — 2026-07-31

### Behoben

- **Die Installation über einen Symlink lud nichts mehr.** `npm run install-local`
  verlinkte dieses Repository nach `~/.vscode/extensions`, damit ein Build als
  Update genügt. VS Code lädt seine Benutzererweiterungen inzwischen aus
  `extensions.json`, und diesen Eintrag schreibt nur `code --install-extension`
  — ein von Hand hineingelegter Ordner wird stillschweigend übergangen. Der Weg
  ist ersatzlos weg, `install.mjs` räumt zurückgebliebene Symlinks auf, und
  `npm run install-vsix` ist der eine verbliebene Befehl: bauen, packen,
  installieren. Zum Entwickeln braucht es ohnehin keine Installation, dafür gibt
  es F5 und den Extension Development Host.

### Geändert

- **Das Panel zeigt die Projektnummer.** „24-017 Website" statt „Website" — die
  Nummer ist es, worauf sich ein Kundenanruf und eine Rechnung beziehen, und
  zwei gleichnamige Projekte sind an nichts anderem auseinanderzuhalten. Sie
  steht in `git config` unter `prosonata.<id>.no` und kommt in ein bestehendes
  Repository mit der nächsten Projektwahl; bis dahin bleibt es beim Namen
  allein. `prosonata status` nennt sie ebenfalls.
- **Die Kategorienauswahl ist gruppiert.** Die Gruppe steht als Überschrift über
  ihrem Block statt klein hinter jedem Namen — im Editor über
  `QuickPickItemKind.Separator`, im Terminal als Zwischenzeile in der
  durchlaufenden Nummerierung. Die Reihenfolge ist ProSonatas eigene:
  `categoryOrder` läuft über die ganze Liste, die Gruppen fallen als
  zusammenhängende Blöcke daraus. Der Platz in der Beschreibung gehört damit
  wieder allein dem Hinweis „aktuell" an der zuletzt benutzten Kategorie.

## [0.3.0] — 2026-07-31

Zwei Wege, auf denen Zeit still nicht bei ProSonata ankam, sind geschlossen, die
Zeitkategorie ist im Editor angekommen, und die Kommandozeile kann alles, was
das Panel kann — erst das macht sie ohne die Erweiterung brauchbar. Ausserdem
spricht die Oberfläche jetzt durchgehend Deutsch.

### Behoben

- **Ein aus dem Editor installierter Hook lief nie.** Er hält absolute Pfade
  fest, und der Node-Pfad war `process.execPath` — im Extension-Host ist das
  nicht Node, sondern das Electron-Binary von VS Code, das ein Skript nur mit
  gesetztem `ELECTRON_RUN_AS_NODE` ausführt. Es brach mit „Unable to find helper
  app" ab, und `|| true` verschluckte es: In einem so eingerichteten Repository
  buchte kein einziger Commit etwas. Der Block setzt die Variable jetzt; echtes
  Node ignoriert sie, damit schreiben beide Frontends dieselbe Zeile.
- **Hooks aus einer älteren Fassung wurden nie repariert.** Die Prüfung verglich
  nur die zwei festgehaltenen Pfade — ein Block mit richtigen Pfaden, sonst aber
  veraltet, galt für immer als gesund. Verglichen wird nun der ganze Block.
- **Einträge gingen mit Kategorie 0 raus.** `category` ist in ProSonata ein
  Pflichtfeld, und ein im Editor angelegter Eintrag bekam nie eine — in der
  Erweiterung fragte schlicht nichts danach. Der Schreibvorgang wird jetzt
  zurückgehalten und benannt: im Panel, in `prosonata status` und nach einem
  Versand, statt mit einem Wert loszuziehen, der nicht buchbar ist.

### Hinzugefügt

- **Die Zeitkategorie im Editor**: ein eigener Befehl, eine Panel-Zeile über dem
  Timer und die Rückfrage direkt nach der Projektwahl — der Weg über den Editor
  ist damit so vollständig wie `prosonata init`.
- **Korrekturen erreichen, was schon unterwegs ist.** Projekt und Kategorie
  werden beim Anlegen in den Eintrag eingefroren; eine Wahl galt deshalb immer
  erst für das Nächste. Eine gewählte Kategorie erreicht nun jeden noch nicht
  fertigen Eintrag des Repositories, und ein korrigiertes Projekt nimmt sie alle
  mit — auch den, in dem der Timer läuft, und auch die, die ProSonata schon
  kennt, deren PUT die neue `projectID` trägt. Liegen bleibt, was abgeschlossen
  ist und dessen Abschluss draussen ist; ein fakturierter Eintrag kann gar nicht
  folgen und bekommt stattdessen einen Nachfolger.
- **Sechs Befehle in der CLI**: `project`, `category`, `grid`, `mode`, `close`
  und `text`. Ohne Argument fragt jeder, mit Argument läuft er durch — einen
  Eintrag abschliessen, seinen Text ändern oder den Modus umschalten braucht
  also die Erweiterung nicht mehr. Abschliessen und Text ändern waren in
  KONZEPT.md §8 von Anfang an vorgesehen; für Modus und Zeitraster gab es
  ausserhalb des Editors überhaupt keinen Weg.
- **„ProSonata: Text des offenen Zeiteintrags ändern"** in der Erweiterung, das
  Gegenstück zu `prosonata text`. Bisher liess sich ein Tippfehler im Trailer
  nur durch einen weiteren Commit korrigieren — oder indem man einen Eintrag
  abschloss, der gar nicht fertig war.

### Geändert

- **Die Oberfläche ist auf Deutsch**: Befehlsnamen, Panel, Dialoge, alle
  Meldungen der CLI und dieser Changelog. ProSonata ist ein deutsches Produkt,
  und die Fachbegriffe der Oberfläche sind es auch. Der Code bleibt englisch.
- Die Kategorie steht in `git config` als `15:Gestaltung` statt als `15`, damit
  das Panel sie benennen kann, ohne die API zu fragen. Eine blosse Id aus einer
  älteren Installation wird weiterhin gelesen.
- `prosonata init` ist die Kontoeinrichtung plus genau das, was `prosonata
  project` tut — der Dialog für Projekt und Kategorie steht einmal im Code statt
  zweimal.

## [0.2.0] — 2026-07-31

Die Einrichtung geschieht jetzt vollständig im Editor, und die Erweiterung kann
in jedem Fenster leben statt nur im Entwicklungshost.

### Behoben

- **Die Projektwahl setzte ein gewähltes Projekt voraus.** Jeder Befehl hing im
  selben Wrapper, der einen vollständigen Kontext verlangt — Repository *und*
  Projekt. Für „Timer starten" ist das richtig, für „Projekt wählen" Unsinn, denn
  genau dafür gibt es den Befehl. Es gibt nun zwei Wrapper: einen, der ein
  konfiguriertes Projekt braucht, und einen, dem ein Git-Repository genügt.
  `chooseProject` las die bekannten Projekte ausserdem aus diesem Kontext, also
  aus etwas, das ohne Projekt nicht existiert; gelesen werden sie jetzt aus der
  Repository-Konfiguration.

### Hinzugefügt

- **Willkommensinhalt mit echten Knöpfen** (`contributes.viewsWelcome`) statt
  Baumzeilen, die nur wie Daten aussehen. Zwei Kontextschlüssel,
  `prosonata.hasAccount` und `prosonata.hasProject`, entscheiden, welcher
  erscheint.
- **`npm run install-local`** verlinkt dieses Repository nach
  `~/.vscode/extensions`, damit die Erweiterung in jedem Fenster ist.
  Aktualisiert wird dann mit `git pull`, einem Build und einem Reload — das
  Nächste an einem automatischen Update ohne Marketplace, den VS Code als
  einzige Quelle je prüft.
- **`npm run install-vsix`** für den Weg über das Paket, mit Versionsnummer.
  Beide entfernen Links, die unter einem früheren Paketnamen liegen geblieben
  sind — zwei Ordner mit derselben Extension-Id würden sonst doppelt geladen.

## [0.1.0] — 2026-07-31

Erste lauffähige Fassung. Nicht veröffentlicht: selbst bauen und die `.vsix`
installieren.

### Hinzugefügt

- **Die Regeln im Kern** (`src/core/tracking.ts`): Segmente und Zeiteinträge, ein
  Eintrag pro Branch und einer pro Commit auf dem Main-Branch, der Commit als
  Trennlinie eines laufenden Segments, das Abschliessen von Hand mit dem
  endgültigen Text und ein Umschalter pro Branch zwischen beiden Modi.
- **Zustandsverwaltung** (`src/core/state-store.ts`) mit Versionszähler, weil
  atomares Ersetzen allein noch immer Änderungen verliert, wenn Hook und Editor
  im selben Moment schreiben. Eine unlesbare Zustandsdatei wird beiseitegelegt
  statt überschrieben — sie ist die einzige Spur von Zeit, die ProSonata nie
  erreicht hat.
- **API-Client** für `projects`, `projecttimecategories` und `projecttimes`,
  dazu ein Doppelgänger im Speicher für die Tests, der das gegen ein Live-Konto
  gemessene Verhalten nachbildet statt des dokumentierten.
- **Aufgeschobener Versand**: Ein Schreibvorgang geht raus, sobald er älter als
  zehn Minuten ist, damit zurückgenommene Commits ProSonata nie erreichen.
  Geschrieben wird die Summe `fremd + eigen`, damit ein zweiter Rechner einen
  Eintrag ergänzt, statt ihn zu überschreiben.
- **Mehrere Rechner**: Ein offener Eintrag wird über die Branch-Kennung in
  seinem Marker wiedergefunden. Die Erholung von einer verlorenen Zustandsdatei
  nimmt denselben Weg — ein Rechner ohne Zustand ist von einem, der den Branch
  nie gesehen hat, nicht zu unterscheiden.
- **`post-commit`-Hook** mit absoluten Pfaden zu Node und zur CLI, weil ein aus
  einem GUI-Git-Client gestarteter Hook eine Umgebung ohne nvm erbt, und mit
  einem Filter, der unkonfigurierte Repositories gar nicht erst Node starten
  lässt.
- **CLI** `prosonata init | start | pause | status | send`.
- **Erweiterung**: Statusleiste mit Sekunden, Panel in der Seitenleiste, Watcher
  auf der Zustandsdatei, HEAD-Beobachtung für Branch-Wechsel, Warnungen bei
  langem Lauf ohne Commit und bei einem Commit ohne Timer, stündliches
  `fetch --prune`, um geschlossene Pull Requests zu bemerken, und die
  Kontoeinrichtung im Editor — das Terminal wird nie gebraucht.
- **Sandbox** (`npm run sandbox`) mit eigenem Zustandsverzeichnis und eigenem
  Repository, damit sich die Erweiterung ausprobieren lässt, ohne ein echtes
  Konto zu berühren.
- **Icons** für Aktivitätsleiste, View und Extension-Seite, nach jedem Export
  von `npm run icons` normalisiert.

### Anmerkungen

- Ein Text über der `detail`-Grenze wird **nicht** gesendet: ProSonata schneidet
  wortlos ab, statt abzulehnen, und ein abgeschnittener Satz auf einer Rechnung
  ist schlimmer als ein Schreibvorgang, der wartet.
- Das Binary heisst `prosonata`, nicht `ps` — dieser Name gehört der
  Unix-Prozessliste.
- Einstellungen pro Repository nutzen die Id als **Subsection**
  (`prosonata.166.category`), weil git einen Schlüssel ablehnt, dessen letzter
  Teil nicht mit einem Buchstaben beginnt.
- Die Erweiterung heisst `:Profitlich` und ist **kein offizielles
  ProSonata-Produkt**. Sie ist so geschrieben, als wäre sie veröffentlicht,
  damit eine spätere Veröffentlichung nichts entwirren muss.
