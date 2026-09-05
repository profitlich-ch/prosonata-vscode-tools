# Modus `pro Branch und Tag`

Ein Entwurf: Ein Branch-Eintrag, der über mehrere Tage wächst, wird pro Tag geschnitten.
Ergänzt [KONZEPT.md](../KONZEPT.md), ersetzt nichts darin. Stand: September 2026, **nichts
davon gebaut**.

## Wofür

**Der Tagesmodus ist der Modus für Abrechnung nach Zeit auf Branch-Arbeit.**

KONZEPT.md §3 ordnet die beiden bestehenden Modi zwei Abrechnungsarten zu: `pro Commit` der
Abrechnung nach **Zeit**, `pro Branch` der Abrechnung nach **Leistung**. Daran hängt, was
wesentlich ist und was nebensächlich — beim Branch-Eintrag sind Datum und Tagesspanne
nebensächlich, weil das Ergebnis bezahlt wird und nicht die Anwesenheit.

Zwischen den beiden klafft aber eine Lücke: **Wer nach Zeit abrechnet, aber auf Branches
arbeitet.** Dann liefert `pro Branch` genau das Falsche — eine Summe ohne Tag, ohne Spanne,
ohne Nachweis. Und `pro Commit` liefert es auch nicht, weil ein Branch aus fünfzehn Commits
besteht, von denen der erste die ganze Zeit trägt. Dafür ist dieser Modus gedacht.

Dasselbe gilt für die **Projektsteuerung**, die immer zeitbasiert ist, auch wenn nach Leistung
abgerechnet wird: Sie fragt, was an einem Tag geschah.

## Warum

Ein Branch-Eintrag wächst über seine ganze Lebensdauer, und `date` wird bei jedem
Schreibzugriff auf **heute** gesetzt (§3). Ein dreiwöchiger Branch trägt am Ende seine ganzen
12,5 h auf dem Tag des letzten Schreibvorgangs. Für die Projektsteuerung ist das nicht
unscharf, sondern **falsch**. §3 räumt die Lücke ein und verweist auf das Segmentprotokoll —
das aber lokal bleibt und in ProSonata nicht existiert.

Dass daraus mehrere Rechnungspositionen werden, ist **gewollt**: In ProSonata wird aus jedem
Zeiteintrag eine Position, und mehrere Zeilen zeigen, dass hier kein geschlossenes
Arbeitspaket abgerechnet wird, sondern etwas in Arbeit. Ebenso gewollt ist, dass die Rundung
pro Tag anfällt.

---

## 1. Der Modus

Dritter Wert neben `branch` und `commit` in `EntryMode` (`types.ts`), abgelegt wie die anderen
unter `prosonata.<branchKey>.mode` (`repo-config.ts`). Dazu eine **Repo-Vorgabe**
`prosonata.mode`, damit ein ganzes Projekt einmal eingestellt wird statt Branch für Branch —
dieselbe Kette wie beim Raster: `readRepoConfig(root).mode ?? config.mode`.

## 2. Die Tagesgrenze liegt um Mitternacht

**Nicht** bei einem konfigurierbaren Tagesbeginn. Der Grund sind `workingTimeStart` und
`workingTimeEnd`: Sobald ein Eintrag ein Datum **und** Uhrzeiten trägt, müssen beide zusammen
stimmen. Ein Eintrag vom 17. mit der Spanne `22:00–02:00` ist unlesbar — das Ende läge vor dem
Beginn. Eine Spanne sagt nur innerhalb eines Kalendertages etwas, also muss der Eintrag in
einem Kalendertag liegen.

Der Tag ist **halboffen**: Ein Segment, das um Mitternacht endet, gehört noch zum alten Tag;
eines, das dort beginnt, zum neuen. Ein Eintrag von 0:00 bis 0:00 kann so nicht entstehen.

Ausgelöst wird der Wechsel bei der **ersten Buchung, deren Tag nicht der Tag des Eintrags
ist** — kein Zeitgeber, kein Hintergrundprozess. Seit 0.11.3 bucht `flush()` das laufende
Segment vor jedem Schreibvorgang, der Wechsel geschieht also von allein innerhalb der
Versandverzögerung.

Die Mechanik existiert: `closeEntry` schliesst einen Eintrag und legt einen Nachfolger an. Der
muss künftig **Text und Tag erben** statt leer zu starten.

## 3. Jeder Eintrag bekommt wieder eine Tagesspanne

Heute verliert jeder Eintrag `workingTimeStart` und `-End`, sobald er über Mitternacht wächst —
eine Spanne sagt nur innerhalb eines Kalendertages etwas. Ein Branch-Eintrag hat also nie eine.
Am eigenen Konto nachgezählt: **327 von 559 Einträgen ohne Spanne.**

Ein Tages-Eintrag liegt konstruktionsbedingt in einem Kalendertag. Die Regel greift nie mehr,
und jeder Eintrag trägt wieder Anfang und Ende — genau der Nachweis, den die Abrechnung nach
Zeit braucht.

## 4. Zwei Grenzen, die nicht dasselbe sind

| Grenze | Wert | Wirkung |
|---|---|---|
| Schnitt von Segment und Buchung | exakt `00:00:00` | verlustfrei; die Summen stimmen sekundengenau |
| `workingTimeEnd` in ProSonata | `23:59` | reine Anzeige — `24:00` nimmt das Feld nicht an |

Daraus folgt ein neuer Sonderfall: Die Spanne kann **kürzer erscheinen als die Dauer**. Wer
23:30 bis 00:30 arbeitet, bekommt für den ersten Tag `23:30–23:59` bei 0,50 h. Bisher war die
Spanne stets länger als die Dauer, weil Pausen darin liegen. Gerechnet wird daraus nichts —
§3 hält fest, dass ProSonata die Spanne nur anzeigt.

Geklemmt wird nur, wenn der Tag durchgearbeitet wurde. Endet das letzte Segment um 22:15,
steht dort 22:15.

## 5. Ein Segment über Mitternacht wird geteilt — in allen Modi

Der eigentliche Bauaufwand. Eine Spanne, die eine oder **mehrere** Mitternachtsgrenzen
überschreitet — ein über das Wochenende vergessener Timer —, wird an jeder Grenze zerlegt.

Zwei Gründe zwingen dazu, beide im Code:

- **`Segment.entryId` ist einzahlig.** Eine Zeile nennt genau einen Eintrag; im Tagesmodus
  speist ein Segment über Mitternacht aber zwei.
- **`byDay` gruppiert nach dem Ende** (`segment.until.slice(0, 10)`). Ein ungeteiltes Segment
  22:00–02:00 landet vollständig auf dem 18., der 17. verliert seine zwei Stunden — **schon
  heute, in jedem Modus.** Das Protokoll beantwortet damit die eine Frage falsch, für die es
  angelegt wurde.

| Was | Wo |
|---|---|
| **Segment schneiden** | immer, in allen drei Modi — dann stimmt `byDay` von selbst |
| **Buchung auf verschiedene Einträge verteilen** | nur im Tagesmodus; sonst tragen beide Hälften dieselbe `entryId` |

Betroffen sind alle Wege, die buchen: Commit, Pausieren, `settle`. Also **ein** Helfer, der
eine Spanne zerlegt, statt drei Aufrufstellen zu flicken. Das Protokoll bekommt einen weiteren
Grund neben `pause`, `commit`, `trimmed`, `correction`, `entry` und `asleep` — ohne ihn stünde
dort `pause`, und eine Pause hat es nicht gegeben.

## 6. Der Tag muss im Eintrag stehen

Neues Feld `day` (ISO-Datum), beim Anlegen gesetzt. Der Versand schreibt dann
`date: entry.day ?? clock.today()` statt unbedingt heute (`sender.ts`).

Das ändert die Datumssemantik aus §3 — `date` benennt nicht mehr den Schreibvorgang, sondern
den Tag, an dem gearbeitet wurde. Genau darum geht es.

## 7. Der Marker bleibt, wie er ist

Die Kennung identifiziert den **Branch**, nicht den Eintrag:

| Eintrag | Marker |
|---|---|
| Heutiger Tag, offen | `[LAUFEND:a3f9c1] Text` — `LAUFEND:a3f9c1` findet genau **einen** |
| Zurückliegende Tage | `[a3f9c1] Text` — `a3f9c1]` findet **alle** Tage des Branches |

Mehrrechner-Abgleich und Wiederherstellung laufen unverändert. Nebenbei wird der fremde Anteil
täglich zurückgesetzt, womit das Fenster für §12.4 auf einen Tag schrumpft.

## 8. Der Text

Solange der Branch läuft, tragen die Tage den vorläufigen Text. Beim **Abschluss** wird der
endgültige über die zurückliegenden Tage nachgezogen — gefunden über `a3f9c1]`, in **einem**
gefilterten GET, der `detail` und `isInvoiced` mitliefert (§9).

- **Nachgezogen wird nur, wo der Text noch der ist, den das Werkzeug hinterlassen hat.** §3
  verspricht, dass ein abgeschlossener Eintrag dem Benutzer gehört; ein blindes Nachziehen
  bräche das. Dafür merkt sich der Eintrag den zuletzt geschriebenen Text — dieselbe Idee wie
  `lastWritten` für die Stunden.
- **Fakturierte Tage bleiben, wie sie sind.** Kein Mangel: Ihr Text sagt wahrheitsgemäss, wie
  der Stand war, als abgerechnet wurde.

Ein Zwanzig-Tage-Branch kostet beim Abschluss einen GET und bis zu zwanzig PUTs — gegen 50 je
Viertelstunde machbar, aber ein Stoss, der im Fehlerfall fortsetzbar sein muss. Seit 0.13.0
gibt es dafür die Drosselung in `send()`.

## 9. Bekannte Grenze

Wechseln zwei Rechner derselben Person den Tag, bevor sie den Eintrag des anderen gesehen
haben, entstehen zwei Einträge für denselben Branch-Tag. Deshalb: **Tageswechsel nur nach
einem Abgleich.** Das verkleinert das Fenster, schliesst es aber nicht — dieselbe Klasse wie
§12.4, und als solche zu benennen.

---

## Offen geblieben: die Anzeige nach Mitternacht

Die `Läuft`-Zeile im Panel zeigt `Strecke · Summe`, wobei die Summe die Sekunden des
**Eintrags** sind. Im Tagesmodus fällt sie um Mitternacht auf null zurück — inhaltlich
richtig, es ist ja das, was heute auf die Rechnung kommt. Nur steht im Kommentar der Zeile,
die zweite Zahl sei „everything the branch has collected", und das wird dann falsch.

**Vorschlag, noch nicht entschieden:** Die `Läuft`-Zeile zeigt Strecke und **Branch-Summe über
alle Tage**, die Zeile *Offener Eintrag* den **heutigen** Eintrag — was fakturiert wird. Dann
springt nichts unerklärt, und jede Zahl hält, was ihr Kommentar verspricht.

## Änderungen am Konzept

- **§3, *Woraus ein Zeiteintrag entsteht*** und ***Umschalter pro Branch*** — der dritte Modus
  und die Repo-Vorgabe.
- **§3, *Zeitwert und Datum*** — zweifach: `date` benennt künftig den Arbeitstag; und die
  Tagesgrenze liegt um Mitternacht, **weil** die Spanne sonst nicht stimmen kann. Der heutige
  Absatz sagt ausdrücklich das Gegenteil („kein Sonderfall um Mitternacht") — das gilt weiter
  für die anderen beiden Modi und ist zu trennen.
- **§3, *Das Segmentprotokoll*** — der neue Grund für den Schnitt an der Tagesgrenze.
- **§3, *Abschluss eines Branch-Eintrags*** — das Nachziehen des Textes samt der Regel „nur,
  wo unverändert".
- **§12** — die Zwei-Rechner-Grenze beim Tageswechsel.
- **§13** — Tabelle nachziehen.

## Prüfung

- **Tageswechsel:** Segmente am 17. und am 18. auf demselben Branch → zwei Einträge, je mit
  eigenem `date`, beide mit der Kennung; nur der zweite trägt `LAUFEND`.
- **Segment über Mitternacht:** 22:00 bis 02:00 ohne Pause → zwei Protokollzeilen, die
  lückenlos aneinanderstossen und den neuen Grund tragen; zwei Buchungen, 2 h auf den 17.,
  2 h auf den 18.; zwei Spannen, beide innerhalb ihres Tages.
- **Derselbe Fall in `branch`- und `commit`-Modus:** ebenfalls zwei Protokollzeilen, aber
  **dieselbe** `entryId`. Gegenprobe im Bericht: Der 17. weist seine zwei Stunden aus, statt
  sie wie heute an den 18. zu verlieren.
- **Über mehrere Mitternachte:** ein Freitagabend vergessener Timer bis Montag → eine Zeile je
  Kalendertag, keine verlorene Stunde.
- **Rundung:** je Tag ein Raster-Aufschlag, nicht einer über den ganzen Branch.
- **Text nachziehen:** drei Tage, der mittlere in ProSonata von Hand umbenannt, der erste
  fakturiert → nur der dritte und der unveränderte werden nachgezogen.
- **Gegenprobe:** jeden neuen Test einmal gegen den zurückgenommenen Code laufen lassen.
