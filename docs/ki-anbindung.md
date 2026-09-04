# KI-Anbindung der Zeiterfassung

Überlegungen dazu, wie ein Coding-Agent dieses Werkzeug bedient. Ergänzt [KONZEPT.md](../KONZEPT.md),
ersetzt nichts darin. Stand: September 2026, nichts davon gebaut.

## Ausgangslage

Die Entwicklung läuft bereits mit einem Agenten, und **das Werkzeug wird schon heute von ihm
getrieben — nur blind.** Jeder Commit, den der Agent macht, schneidet ein Segment und schliesst
oder füllt einen Zeiteintrag, ohne dass irgendwer das als KI-Bedienung bezeichnet hätte.

Belegt ist das durch einen Fehlerfall: In `lequipe-visuelle.ch` entstanden am 17.08.2026 zwischen
16:45 und 16:51 vier Zeiteinträge mit 0,00 h, aus vier Commits in sechs Minuten. Die Ursache lag
im Werkzeug und ist behoben; was bleibt, ist die Beobachtung über das Tempo — dazu unten mehr.

Eine technische Anbindung ist nicht nötig. Die CLI kennt achtzehn Befehle, darunter `start`,
`pause`, `discard`, `adjust`, `text`, `close`, `attach`, `status` und `log`. Jeder Agent mit
Shell-Zugriff kann das bereits alles. Zu entscheiden ist einzig, **wer was auslöst.**

## Die Trennlinie

Naheliegend wäre, zwischen „die Laufzeitumgebung handelt" und „das Modell entscheidet" zu
trennen. Das ist zu grob und schliesst Sinnvolles aus. Die tragfähige Frage lautet:

> **Erfindet die Handlung eine Zahl, oder wählt sie nur einen Zeitpunkt?**

| | Beispiel | Fehlerwirkung |
|---|---|---|
| **Zeitpunkt wählen** | `prosonata pause`, `prosonata start` | Die Zahl liefert die Uhr; gebucht wird das gemessene Segment. Ein schlecht getroffener Moment verschiebt eine Grenze um Minuten, und das Segmentprotokoll hält fest, was wirklich lief. **Begrenzt und nachvollziehbar.** |
| **Zahl erfinden** | `adjust +90`, die Antwort auf „wie viel von acht Stunden zählt" | Die Zahl kommt vom Modell. **Unbegrenzt und unsichtbar** — auf der Rechnung steht sie wie jede andere. |

Fast der ganze Nutzen liegt in der oberen Zeile, fast das ganze Risiko in der unteren.

---

## Stufe 1: Das Sitzungsende hält den Timer an

Ein Hook in `settings.json` ruft beim **Ende einer Agenten-Sitzung** `prosonata pause`. Am
Werkzeug ist dafür nichts zu ändern; der Befehl existiert.

Das ist dasselbe Muster, das [KONZEPT.md](../KONZEPT.md) §3 für den Branch beschreibt: eine
Klammer, deren Ende **nicht von Disziplin abhängt.** Beim Branch erzwingt Git das Ende, hier die
Laufzeitumgebung. Ein dauerhaft laufender Handtimer scheitert genau daran, dass ihn nichts
beendet — und ein Agent, den man bittet, ans Anhalten zu denken, ist derselbe Handtimer mit einem
zusätzlichen Vergessensrisiko.

**Nicht nach jedem Turn.** Wer eine Antwort liest, nachdenkt und weitertippt, arbeitet; der Timer
stünde währenddessen still. Die Grenze ist das Sitzungsende, nicht der einzelne Austausch.

**Was es nicht abdeckt:** ein zugeklapptes Terminal ohne sauberes Sitzungsende — dann feuert kein
Hook. Dafür bleiben `pauseOnWindowClose` und die Sechs-Stunden-Warnung das Netz; beide gibt es.

Beim Bau ist der genaue Ereignisname in der Dokumentation von Claude Code nachzusehen. Hier steht
bewusst „Sitzungsende" und keine Kennung, die sich ändern kann.

## Stufe 2: Anhalten auf ausdrückliche Aufforderung

„Wenn Du fertig bist, stoppe den Prosonata-Timer" im Prompt. Der Zeitpunkt wird damit **zum
Arbeitsauftrag** — das Modell bestimmt ihn, aber ausgelöst durch eine menschliche Anweisung, nicht
durch eine Vermutung. Nach der Trennlinie oben ist das zulässig: Es wählt einen Zeitpunkt, keine
Zahl.

Es trifft, was ein Hook nicht kann — das Ende einer **Aufgabe**, auch mitten in einer Sitzung.

**Voraussetzung:** eine Zeile in der globalen `CLAUDE.md`, etwa *„Zeiterfassung: `prosonata pause`
im Repo-Verzeichnis hält den Timer an"*. Ohne sie rät das Modell, ob es den Befehl überhaupt gibt.
Und der Agent soll melden, was er getan hat; die CLI schreibt es ohnehin nach stderr.

**Schwäche, offen benannt: best effort.** Stürzt die Sitzung ab, wird sie mit Ctrl-C unterbrochen
oder läuft der Agent in einen Fehler, wird die Anweisung nie ausgeführt. Das ist die gnädige Sorte
Versagen — es bleibt ein sichtbar laufender Timer stehen, den die Sechs-Stunden-Warnung aufgreift.
Unangenehmer ist der umgekehrte Fall: Der Agent hält sich mitten in der Sitzung für fertig und
hält an, während weitergearbeitet wird. Dagegen hilft, die Aufforderung an eine **benannte
Aufgabe** zu binden statt an ein allgemeines „fertig".

**Verhältnis zu Stufe 1:** Ergänzung, nicht Konkurrenz. Die Aufforderung trifft den Moment genau,
aber unzuverlässig; der Hook am Sitzungsende trifft ihn grob, aber sicher. Beides zu haben kostet
nichts, weil `pause` auf einen bereits stehenden Timer nicht wirkt.

## Stufe 3: Der Agent schlägt den Rechnungstext vor

Das ist die eine Aufgabe, die das Werkzeug nicht lösen kann und die der Mensch aufschiebt.
[KONZEPT.md](../KONZEPT.md) §3 sagt zum Rückfall auf das Commit-Subject ausdrücklich: „ein Angebot,
kein Freibrief: technische Subjects sind vor dem Fakturieren zu prüfen." Genau diese Prüfung kann
ein Agent leisten, der die Arbeit gerade gemacht hat — in Kundensprache, solange es frisch ist.

Zwei Wege, beide vorhanden:

- **Der `Prosonata:`-Trailer** in der Commit-Message, die der Agent ohnehin schreibt. Der in §3
  dokumentierte Kanal, kein neuer Code.
- **`prosonata text "…"`** für einen offenen Branch-Eintrag.

Risikoarm ist es zusätzlich, weil ein Text in ProSonata jederzeit korrigierbar ist — Stunden
sind es nach dem Fakturieren nicht.

Dasselbe gilt eine Ebene höher für die **Branch-Bezeichnung** beim ersten Commit.

## Stufe 4: Das Modell erfindet Zahlen — nicht

Kein `adjust`, keine Antwort auf die Frage „wie viel davon zählt", kein Zuschlagen einer Dauer zu
einem abgeschlossenen Eintrag. `start` und `pause` sind davon **nicht** betroffen: Sie wählen
einen Zeitpunkt, und die Zahl kommt von der Uhr.

Sollte das je gewollt sein, ist die **Herkunft** die Vorbedingung, nicht die Kür: `Timer.origin`
ist bereits als `'local' | 'remote'` angelegt und laut §7 „heute konstant `local`". Dort und im
Segmentprotokoll gehört festgehalten, dass ein Agent geschrieben hat. Ohne das ist eine
Reklamation an einer Rechnung nicht beantwortbar.

---

## Was dafür spricht

- **Es geschieht bereits, nur unbewusst.** Es explizit zu machen ist strikt besser, als es
  implizit zu lassen.
- **Die Laufzeitumgebung liefert die erzwungene Klammer geschenkt** — dieselbe Eigenschaft, die
  den Branch zur guten Klammer macht.
- **Der Rechnungstext** ist das Problem, das der Mensch vor sich herschiebt und der Agent am
  besten löst.
- **Die Risikogrenze ist ungewöhnlich sauber.** Einen Zeitpunkt zu wählen kostet im schlechtesten
  Fall eine um Minuten verschobene Grenze, die das Segmentprotokoll festhält; eine Zahl zu
  erfinden kostet eine falsche Rechnung. Selten lässt sich eine Trennlinie so eindeutig ziehen.

## Was dagegen spricht

- **Zeiteinträge werden Rechnungen.** `adjust.ts` formuliert das Versprechen des Werkzeugs im
  Kommentar: „Every limit here exists so that no time is invented." Ein nichtdeterministisches
  Verfahren mit Schreibrecht hebelt genau das aus. Ein halluziniertes `adjust +90` ist kein
  Programmfehler, sondern eine falsche Rechnung.
- **Der Code ist überall bewusst deterministisch** — absolute Summen statt Differenzen,
  `lastWritten`, Compare-and-Swap auf `state.json`. Modellurteil ist die Gegenrichtung zu dieser
  ganzen Linie.
- **Der Agent war nicht dabei.** §3 wiederholt es an mehreren Stellen: „was diese Stunden waren,
  weiss nur, wer dabei war." Das Telefonat, das Nachdenken, das Gespräch am Whiteboard sieht er
  nicht.
- **Agentengeschwindigkeit vervielfacht Fehler.** Die vier Nullstunden-Einträge oben entstanden
  in sechs Minuten. Der Fehler lag im Werkzeug, nicht in der KI — aber zehn Commits in sechs
  Minuten heissen zehn falsche Zeilen, bevor überhaupt jemand hinsieht. Was bei menschlichem
  Tempo als Einzelfall auffällt, ist hier schon eine Serie.
- **Prompt Injection über Repo-Inhalte**, weit hergeholt, aber die Sprengweite ist eine
  Kundenrechnung.

## Verworfene Möglichkeiten

**Untätigkeitserkennung per Herzschlagdatei.** Ein Hook nach jedem Werkzeugaufruf fasst eine Datei
an, ein Wächter vergleicht. Bei einem Agenten wäre das sogar zuverlässiger als beim Menschen —
ein Agent führt entweder Werkzeuge aus oder nicht, während ein Mensch beim Nachdenken genauso
aussieht wie beim Kaffeeholen. Verworfen trotzdem, aus demselben Grund wie die Sitzungserkennung
als Eintragsklammer: Die Grenze bleibt unsichtbar, und man kann nicht vorhersagen, was man
bekommt. Das saubere Sitzungsende deckt den Regelfall ab, die Sechs-Stunden-Warnung den Rest.

**Ein Zeiteintrag pro Agenten-Sitzung.** Verlockend, weil die Laufzeitumgebung Anfang und Ende
erzwingt. Aber eine Sitzungsgrenze bedeutet dem Kunden nichts, und Sitzungen werden unterbrochen
und fortgesetzt. Der Branch bleibt die bessere Klammer.

**Ein MCP-Server statt der CLI.** Die CLI kann bereits alles. Falls je strukturierte Daten
gebraucht werden, wäre ein `prosonata status --json` die billigere Antwort.

## Offene Frage, kaufmännisch statt technisch

Während der Agent zwanzig Minuten arbeitet, sitzt womöglich niemand davor. **Ist das Kundenzeit?**

Vertretbar ist ja — es wird an seinem Projekt gearbeitet, unter der Verantwortung dessen, der den
Agenten laufen liess. Die Frage ist hier festgehalten, weil die KI-Anbindung sie ans Licht zwingt,
statt sie offen zu lassen; beantworten lässt sie sich nicht aus dem Code.
