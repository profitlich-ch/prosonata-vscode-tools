# Changelog

Alle nennenswerten Änderungen an diesem Projekt stehen hier. Das Format folgt
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), die Versionen folgen
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unveröffentlicht

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
