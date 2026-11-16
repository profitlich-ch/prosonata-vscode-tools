# 0001 — Zeiteinträge durchsehen als Webview-Tabelle mit Svelte

**Status:** angenommen, 2026-11-16; überarbeitet am selben Tag vor dem Merge, nach dem Bau:
Darstellungsregeln laufen in der Webview, Laufzeit von Svelte gemessen, Löschen bleibt modal,
keine Komponententests.

## Kontext

Das Durchsehen der Zeiteinträge eines Repositories (KONZEPT.md §3, *Zeiteinträge durchsehen und
berichtigen*) ist eine mehrfach wählbare QuickPick in `src/extension/browse.ts`. Sie zeigt pro
Zeile Text, Stunden, Datum und Nummer, kennt zwei Knöpfe für die Auswahl und einen pro Zeile.
Text und Stunden werden in zwei InputBoxen nacheinander geändert, das Zusammenlegen ebenso.

Was die Liste nicht kann:

- **Den Branch zeigen.** ProSonata kennt ihn nicht, dieses Werkzeug schon; die Verknüpfung ist der
  Grund, warum es das Durchsehen gibt. In einer QuickPick lässt er sich nur in die Beschreibung
  hängen, nicht gruppieren und nicht summieren.
- **Fakturierte Einträge zeigen, ohne sie wählbar zu machen.** Die stabile API kennt keine
  QuickPick-Zeile ohne Checkbox, darum blendet `browse.ts` sie aus (Issue #11).
- **Vorher zeigen, was eine Handlung ergibt** – die Summe der Auswahl, die einmal gerundete Zahl
  beim Zusammenlegen, ob das Segmentprotokoll die Einträge deckt. Heute erscheint das erst im
  zweiten Dialog, nach dem Entscheid.
- **Doppel sichtbar machen.** Gleicher Branch, gleicher Tag, gleicher Text war das Muster der 61
  doppelt angelegten Einträge (CLAUDE.md); in einer flachen Liste liest man Zeilen gegeneinander.

KONZEPT.md §8 hält fest, dass alle Auswahlen native QuickPicks sind – «kein Webview, kein
Svelte». Das galt, solange keine Liste mehr brauchte, als die QuickPick hergibt.

## Entscheidung

- Der Befehl **«Zeiteinträge durchsehen»** öffnet eine **Webview-Tabelle in einem Editor-Tab**.
  Sie ersetzt die QuickPick; eine zweite Fassung desselben Wegs gibt es nicht.
- Die Tabelle zeigt Budget, Suche, Sortierung, Gruppen nach Branch oder Kalenderwoche mit Summe,
  fakturierte Einträge gesperrt, eine Spalte für die Deckung durch das Segmentprotokoll und den
  Hinweis «mögliches Doppel». Text und Stunden werden in der Zelle geändert; Zusammenlegen und
  Löschen zeigen ihre Wirkung in der Tabelle, bevor sie bestätigt werden.
- Gebaut wird der Webview-Teil mit **Svelte 5**, als zweiter esbuild-Einstieg.
- **Die Regeln bleiben in `core`.** Was in die Abrechnung greift oder über einen Eintrag
  urteilt – Branch zuordnen, Doppel erkennen, `planMerge`, `planRemoval`, Rundung, das
  endgültige Parsen von Stunden – läuft im Extension-Host. Die Webview bekommt fertig
  entschiedene Zeilen und schickt nur Absichten zurück («zusammenlegen #4821 #4822»).
- **Darstellungsregeln laufen in der Webview, aber aus `core`.** Suchen, sortieren, gruppieren
  und summieren sind reine Funktionen in `core/browse-view.ts`, die Schreibweise der Stunden
  und ihre Vorprüfung kommen aus `core/working-time.ts`. Beide Module haben keine Importe und
  werden mitgebündelt; so läuft eine Regel nie ein zweites Mal in eigener Fassung, und eine
  Umgruppierung kostet keinen Weg zum Host.
- **Keine neuen Schreibvorgänge.** Die Tabelle schreibt nur, was das Durchsehen heute schon
  schreibt: Text und Stunden eines Eintrags, Zusammenlegen, Löschen.
- Das Panel in der Seitenleiste und alle übrigen Auswahllisten bleiben nativ.

## Begründung

Die Tabelle beantwortet die Frage, die zum Durchsehen führt – «was habe ich hier gebucht» –
nach Leistung gegliedert statt als Liste von Datensätzen, und sie zeigt die Folgen einer
Berichtigung, bevor sie geschrieben wird. Für ein Werkzeug, das in ein Abrechnungssystem schreibt,
ist das Zweite der grössere Gewinn.

**Ein Framework**, weil die Oberfläche eigenen Zustand hat: Auswahl, Bearbeiten in der Zelle,
Vorschau, die von der Auswahl abhängt, und Updates von aussen, wenn Hook oder CLI schreiben. Ohne
Framework entstünde dafür ein eigenes, und Texte aus ProSonata müssten an jeder Stelle von Hand
escaped werden. **Svelte**, weil es genau diese Art von Formular-Zustand am knappsten ausdrückt.
Gebaut sind es 84 KB Script und 8 KB CSS, minifiziert – mehr als «Svelte kompiliert weg»
verspricht, für eine lokal geladene Seite ohne Netz aber ohne Belang. Der Werkzeugpreis ist
einmalig: ein esbuild-Plugin, `svelte-check` in `npm run check` und `.svelte` im l10n-Test.

Die Grenze zu `core` hält Svelte austauschbar und verhindert, dass eine Regel ein zweites Mal
geführt wird – der Fehler mit `watchHead` (KONZEPT.md §8) war genau das.

Verworfen:

- **QuickPick behalten und erweitern.** Separatoren (`QuickPickItemKind.Separator`) gliedern nach
  Branch und eine Summe passt in den Titel. Keine Zeile ohne Checkbox, keine Spalten, keine
  Vorschau, keine Bearbeitung in der Zeile – der grössere Teil des Nutzens bliebe aus.
- **Durchsehen als TreeView mit Checkboxen** (`TreeItem.checkboxState`, ab VS Code 1.80).
  Gruppen ja, aber weder Spalten noch Bearbeiten in der Zeile, und die Seitenleiste ist für eine
  Tabelle zu schmal.
- **Lit 3.** Eine einzige Abhängigkeit, die Werkzeuge blieben unverändert und `tsc` prüfte alles.
  Komponenten mit Zustand lesen sich in Lit umständlicher; das wiegt bei dieser Oberfläche schwerer
  als die einmaligen Werkzeugkosten von Svelte.
- **Ohne Framework.** Keine Abhängigkeit, aber Escaping, Fokus beim Neuzeichnen und Abgleich der
  Zeilen von Hand. Die Skizze zu diesem Entscheid zeigte die Fehler schon bei Beispieldaten.
- **`@vscode-elements/elements`.** VS-Code-Bausteine auf Lit-Basis; eine Tabelle mit Gruppen und
  Bearbeiten in der Zelle bilden sie nicht ab.
- **`@vscode/webview-ui-toolkit`.** Von Microsoft abgekündigt.

**Die stärkste Gegenposition** steht in KONZEPT.md §11: Ein eigenes Review-Frontend ist
verworfen, die ProSonata-Oberfläche ist das Review. Eine Tabelle mit Bearbeiten in der Zelle
lädt dazu ein, die Abrechnung hier statt dort durchzusehen, und sie ist der grösste Block
Oberflächencode in einem Werkzeug, das eine Person pflegt und das in Rechnungen schreibt. Ihr
begegnet dieser Entscheid mit zwei Grenzen: keine neuen Schreibvorgänge, und die Tabelle zeigt
nur, was ProSonata nicht zeigen kann oder nicht richtig rechnet – den Branch, die Deckung durch
das Protokoll, das einmalige Runden beim Zusammenlegen. Wer Einträge anderer Projekte oder über
alle Repositories durchsehen will, tut das weiter in ProSonata.

## Konsequenzen

- Ein zweiter Build-Einstieg für den Browser, mit Content-Security-Policy und Nonce.
- Ein Nachrichtenprotokoll zwischen Webview und Extension in beide Richtungen. Die Tabelle wird
  neu gezeichnet, wenn sich der Zustand ändert; eine Absicht nennt die Einträge, auf die sie sich
  bezieht, und die Extension prüft sie gegen den aktuellen Stand, nicht gegen den gezeigten.
- `t()` läuft nicht in der Webview. Die Texte werden aus dem Extension-Host hinübergereicht, und
  der l10n-Test liest `.svelte`-Dateien mit.
- Tastaturbedienung, Fokus und Screenreader, die die QuickPick mitbrachte, müssen gebaut und
  geprüft werden.
- Das Löschen fragt weiter mit dem modalen Dialog von VS Code, aufgerufen aus der Extension: so
  sieht es aus wie jede andere Frage, die sich nicht zurücknehmen lässt. Das Zusammenlegen
  bestätigt man im Formular unter der Tabelle, das Summe, Text und die gelöschten Einträge zeigt.
- **Keine Komponententests.** `@sveltejs/vite-plugin-svelte` verlangt vite 8, vitest 2 bringt
  vite 5 mit; ein vitest-Upgrade gehört nicht in dieses Paket. Was sich testen lässt, liegt
  deshalb in `core`; die Komponente ist Verdrahtung und wird beim Ändern im Browser geprüft.
- KONZEPT.md §3, §8 und §11 sind nachgezogen.
