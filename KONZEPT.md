# ProSonata Zeiterfassung – Konzept

Werkzeug zur Zeiterfassung für Code-Arbeit, angebunden an ProSonata (SaaS, REST API).
Bedienung über eine VS-Code-Extension, Beschreibung der Arbeit über Git-Commits.

Dieses Dokument ist die Entscheidungsgrundlage. Abschnitt 11 listet bewusst verworfene
Alternativen – diese nicht erneut vorschlagen.

---

## 1. Problem und Grundidee

**Das Problem sind die vergessenen Timer.** Bei der Arbeit in VS Code geht regelmässig
unter, in ProSonata einen Timer zu starten oder zu beenden. Ein vergessener Start ist
verlorene Zeit, ein vergessenes Ende ist eine falsche Zeit – beides endet in geschätzten
Nachträgen.

**Der zweite Hebel ist der Text.** Was gearbeitet wurde, lässt sich am besten dort
beschreiben, wo die Arbeit stattfindet: im Editor, beim Commit. Nicht Tage später in einer
fremden Oberfläche.

**Deshalb koppelt dieses Werkzeug die Zeiterfassung an Commits und Branches** und macht
Arbeit am Code semi-automatisch zu Zeiteinträgen. „Semi-automatisch" heisst: Start und Pause
bleiben Handarbeit, alles danach geschieht von selbst.

Daraus folgen die tragenden Entscheidungen:

**Der Timer läuft lokal, ProSonata bekommt nur Zeiteinträge.**
Eine Timer-API existiert bei ProSonata, ist aber öffentlich nicht verfügbar (Stand jetzt).
Die lokale Emulation ist semantisch identisch und wird später ggf. dahinter ausgetauscht.

**Zeit und Text sind entkoppelt.**
Der Timer misst. Der Commit beschreibt.

**Start und Pause geschehen immer von Hand.**
Keine Automatik aus Editor-Aktivität, Branch-Wechseln oder Dateiänderungen. Das Werkzeug
**warnt** bei erkennbarer Fehlbedienung (Abschnitt 3), aber es bucht nie von selbst.

**Der Code wird geschrieben, als würde er veröffentlicht.**
Das Repo ist öffentlich. Eine Marketplace-Extension ist **nicht** beschlossen, aber möglich –
und die Anforderungen aus Abschnitt 10 kosten während der Entwicklung fast nichts, während
sie nachträglich einzubauen ein Umbau wäre.

---

## 2. Zwei Ebenen: Segment und Zeiteintrag

Die wichtigste Unterscheidung des Konzepts, und die Quelle der meisten Missverständnisse,
wenn sie fehlt:

- **Segment** – eine gemessene Arbeitsstrecke. Entsteht beim Start, endet bei Pause oder
  Commit. Bleibt **lokal** und erreicht ProSonata nie einzeln.
- **Zeiteintrag** – ein `projecttimes`-Datensatz in ProSonata. Trägt Zeit, Projekt, Kategorie
  und den Text, den der Kunde auf der Rechnung liest.

**Segmente sind die Messung, Zeiteinträge sind die Abrechnung.** Viele Segmente ergeben einen
Zeiteintrag. Wie viele, entscheidet Abschnitt 3.

---

## 3. Fachliche Semantik

### Woraus ein Zeiteintrag entsteht

| Ort der Arbeit | Zeiteintrag |
|---|---|
| **Branch** (nicht der Hauptbranch) | **Ein Zeiteintrag pro Branch**, wächst über dessen ganze Lebensdauer |
| **Hauptbranch** | **Ein Zeiteintrag pro Commit** |

Der Branch ist die natürliche Klammer um ein Stück Arbeit, das der Kunde als Einheit bezahlt.
„Buchungsmodul: 12,5 h" ist die Zeile, die auf eine Rechnung gehört – nicht fünfzehn
Commit-Subjects. Auf dem Hauptbranch wird dagegen typischerweise Wartung erledigt, wo jeder
Commit für sich eine abgeschlossene Kleinigkeit ist.

Der Hauptbranch ist **konfigurierbar**. Default ist der Branch, auf den
`refs/remotes/origin/HEAD` zeigt, ersatzweise `main`.

Kurzform im weiteren Text: **Branch-Eintrag** für den einen Zeiteintrag eines Branches.

### Umschalter pro Branch

Die Tabelle oben ist die **Voreinstellung**, nicht das Gesetz. Für jeden Branch lässt sich der
Modus umschalten – `pro Branch` oder `pro Commit`. Auf dem Hauptbranch steht er fest auf
`pro Commit` und ist deaktiviert: dort gibt es keine Klammer, die einen wachsenden Eintrag
rechtfertigen würde.

Gebraucht wird das, wenn ein Branch ausnahmsweise nicht als eine Rechnungszeile taugt – etwa
weil auf ihm mehrere unabhängige Kleinigkeiten liegen, die der Kunde einzeln sehen soll.

- Ablage in `git config --local` unter der **Kennung** des Branches (Abschnitt 3), nicht unter
  seinem Namen: `prosonata.mode.a3f9c1 = commit`. Branchnamen enthalten Schrägstriche und
  Punkte und wären als Config-Schlüssel unhandlich.
- **Ein Umschalten wirkt ab dem nächsten Commit.** Bereits abgeschlossene Zeiteinträge bleiben,
  wie sie sind.
- Wird von `pro Branch` auf `pro Commit` umgeschaltet, während ein Branch-Eintrag offen ist,
  wird dieser **abgeschlossen** – mit Rückfrage nach dem endgültigen Text, wie bei jedem
  Abschluss. Umgekehrt beginnt der nächste Commit einen neuen Branch-Eintrag.
- Der Umschalter steht im Panel (Abschnitt 8), wo auch der aktuelle Branch sichtbar ist.

### Zeitwert und Datum

- `workingTime` ist die **absolute Summe in Dezimalstunden**, nicht die Differenz.
  Damit ist jeder Schreibzugriff idempotent: ein Wiederholungsversuch verdoppelt nichts, und
  es braucht kein Read-Modify-Write.
- Das **Zeitraster** ist pro Repo einstellbar; Default ist exakt mit zwei Nachkommastellen
  (0,01 h = 36 s). Gerundet wird beim Schreiben, damit der angezeigte Wert der abgerechnete
  ist.
- `date` wird bei **jedem** Schreibzugriff auf **heute** gesetzt. Das Datum benennt damit die
  **Fertigstellung**, nicht den Beginn. Ein Zeiteintrag darf sich über mehrere Tage erstrecken;
  kein Sonderfall um Mitternacht, kein automatisches Schliessen bei Tageswechsel.
- **„Heute" ist die lokale Zeit des schreibenden Rechners**, nicht UTC. Der Arbeitstag ist
  durch die eigene Uhr definiert, nicht durch einen Meridian. Eine Umrechnung findet ohnehin
  nicht statt: `date` ist in der API ein reines Datum ohne Zeitanteil. Die einzige Frage ist,
  welchen Tag der Client für heute hält – und das ist der, an dem der Benutzer sitzt.
  Der Randfall bleibt bewusst: Wer über Mitternacht hinaus arbeitet und danach schreibt,
  bekommt den neuen Tag. Das passt zur Datumssemantik.
- `workingTimeStart` und `workingTimeEnd` tragen die **Spanne des Arbeitstages**: den Beginn
  des ersten und das Ende des jüngsten Segments dieses Eintrags, aus dem Segmentprotokoll.
  ProSonata zeigt beide nur an und rechnet nichts daraus; für die Rechnung zählt die Dauer.
  **Beide Enden müssen auf denselben Tag fallen** – sonst wird `null` geschrieben, was die
  Felder löscht. Eine Spanne sagt nur etwas über einen Tag; `08:12–17:40` auf einem Eintrag,
  der über drei Wochen gewachsen ist, behauptete eine Anwesenheit, die es nie gab. Wächst ein
  Eintrag über Mitternacht, verliert er seine Spanne also wieder. Mit dem Modus hat das nichts
  zu tun: Auch ein Commit-Eintrag kann über Mitternacht gehen.
- **Der laufende Timer steht nicht in diesen Feldern, sondern in der Marke** (Abschnitt 3).
  Früher trug `workingTimeStart` diesen Zustand – die blosse Anwesenheit hiess „hier läuft ein
  Timer". Das kostete zweierlei: das Feld selbst, und die Auskunft, *wann*. Eine Uhrzeit ohne
  Tag lässt einen auf einem schlafenden Rechner vergessenen Timer eine Woche später aussehen
  wie einen von heute früh. Ein zweiter Rechner **warnt** daran weiterhin – anhalten kann er
  nichts, ein schlafender Rechner liest nichts, und was diese Stunden waren, weiss nur, wer
  dabei war.
- Der Vermerk reist mit einem **ohnehin fälligen** Schreibvorgang, nie mit einem eigenen
  Aufruf. Er ist damit bis zu zehn Minuten alt; für eine Warnung genügt das. Das Pausieren
  merkt dafür einen Schreibvorgang vor, damit der Vermerk auch wieder verschwindet – beim
  Schliessen von VS Code sofort, weil dort ohnehin gesendet wird.
- **Am Konto gemessen:** Die Kurzform `09:12` wird angenommen und als `09:12:00` gespeichert,
  `null` löscht wirklich – ein leerer String dagegen schreibt `01:00:00` hinein.

### Der Text

Der Text geht auf die **Kundenrechnung**. Woher er im Einzelnen stammt, steht in „Marker im
Commit" und in der Tabelle darunter. Zwei Eigenschaften gelten übergreifend:

- **Beim ersten Commit auf einem neuen Branch** fragt das Werkzeug einmal nach einer
  Bezeichnung. Einmal pro Feature, nicht einmal pro Commit.
- **Änderbar bleibt er jederzeit**, über die Oberfläche oder über einen späteren Commit. Oft
  lässt sich der endgültige Rechnungstext erst bei Fertigstellung sinnvoll schreiben.

### Marker im Commit

Der Beschreibungstext für ProSonata steht in einem **Git-Trailer** als letzter Absatz der
Commit-Message:

```
fix: Rundungsfehler in der zweiten Rabattstufe

Test ergänzt, Grenzwerte geprüft.

Prosonata: Korrektur der Rabattberechnung im Shop
```

- Extraktion per `git interpret-trailers --parse`, kein eigener Parser. Weitere Trailer im
  selben Absatz (etwa `Co-Authored-By:`) stören nicht.
- Das Schlüsselwort ist **`Prosonata`**, konfigurierbar. Es benennt das Zielsystem, ist ein
  Eigenname und braucht deshalb für die veröffentlichte Extension keine Übersetzung – anders
  als ein deutsches `Zeit`. Und es kollidiert nicht: `Zeit: 3 Stunden` könnte jemand als
  gewöhnlichen Satz in den letzten Absatz schreiben, und Git läse es als Trailer.
  Verglichen wird ohne Rücksicht auf Gross- und Kleinschreibung.
- **Nicht `#` als Markerzeichen** – Git strippt Kommentarzeilen.
- Auf einem **Branch** ersetzt ein Trailer den Text des Branch-Eintrags. Der letzte gewinnt.
- Auf dem **Hauptbranch** setzt er den Text des Zeiteintrags, den dieser Commit abschliesst;
  ohne Trailer gilt das Subject.

Der Fallback auf das Subject ist ein Angebot, kein Freibrief: technische Subjects sind vor dem
Fakturieren zu prüfen. Der Text ist in ProSonata jederzeit nachbearbeitbar.

### Wirkung eines Commits

| Fall | Wirkung |
|---|---|
| **Commit auf einem Branch** | Das laufende Segment wird geschnitten, seine Zeit fliesst in den Branch-Eintrag. Der bleibt **offen**. Ein Trailer ersetzt seinen Text. |
| **Erster Commit auf einem neuen Branch** | Zusätzlich: Rückfrage nach der Bezeichnung, falls kein Trailer vorliegt. |
| **Commit auf dem Hauptbranch** | Das Segment wird geschnitten, seine Zeit wird als eigener Zeiteintrag **abgeschlossen**. `detail` = Trailer, sonst Subject. |
| **Commit ohne laufenden Timer** | Keine Zeit zu buchen. Hinweis mit Angebot, die Zeit seit dem letzten Commit nachzutragen. |

Ein laufender Timer wird durch keinen dieser Fälle angehalten; das nächste Segment gehört zum
nächsten Zeiteintrag.

**Geschnitten wird am Commit-Zeitpunkt.** Beispiel: 9:00 Start, 10:00 Pause, 10:30 Start,
11:15 Commit → 1,75 h fliessen in den Zeiteintrag, danach läuft das nächste Segment ab 11:15.

### Das Segmentprotokoll

`segments.jsonl` hält **jedes gemessene Segment** fest: Beginn, Ende, Dauer, Repository,
Branch, Projekt und was das Segment beendet hat – Pause, Commit oder eine Kürzung von Hand.
Anders als `log.jsonl`, das ein Puffer ist und gekürzt wird, ist es ein **Archiv**.

Es beantwortet zwei Fragen, die sonst niemand beantworten kann:

- **Wie viel wurde an welchem Tag gearbeitet?** Ein Zeiteintrag trägt eine Summe und ein
  Datum – das seines letzten Schreibvorgangs. Ein Branch über drei Wochen sagt über den
  Dienstag in der Mitte nichts.
- **Was war auf einem Branch, den es nicht mehr gibt?** Die Branch-Liste der Ansicht stammt
  aus dem Protokoll, nicht aus Git. Gelöschte Branches behalten damit ihre Stunden.

Besonders festgehalten wird die **Kürzung**: mit der behaltenen Spanne *und* der tatsächlich
gelaufenen Dauer. Es ist die einzige Stelle, an der gemessene Zeit absichtlich verschwindet –
sie darf nicht zusätzlich unbemerkt verschwinden.

Gezeigt wird das Protokoll als **gesetzte Markdown-Vorschau** von VS Code, mit einer QuickPick
für den Branch davor; im Terminal gibt `prosonata log` dasselbe aus. Kein eigenes Webview
(Abschnitt 8): Der Text kommt aus einem `TextDocumentContentProvider` unter dem Schema
`prosonata:`, VS Code setzt ihn. Damit ist er nicht bearbeitbar, ohne dass es jemand verbieten
müsste – ein unbenanntes Dokument liesse sich beschreiben und fragte beim Schliessen nach dem
Speichern einer Datei, die es nie gab. Die Darstellung selbst liegt in `core`, damit beide
Frontends dieselben Summen und dieselben Worte zeigen.

Was es nicht weiss: den anderen Rechner. Segmente werden dort aufgezeichnet, wo sie anfallen –
ProSonata hält die Summe beider, dieses Protokoll die Einzelheiten eines einzigen.

**Warum es nicht bearbeitbar ist.** Die Frage kommt naheliegenderweise auf: Da steht eine Liste,
und in ihr steht eine falsche Zeile. Bearbeiten wäre trotzdem falsch:

- Das Protokoll ist **keine Autorität**. Abgerechnet wird `entry.seconds` und, sobald gesendet,
  der Eintrag in ProSonata; die Segmente fliessen nie dorthin zurück. Eine geänderte Zeile
  änderte den Bericht, nicht die Rechnung – danach widersprächen sich beide, und das Protokoll
  wäre das Dokument, das lügt.
- Es wird **nur angehängt**. Das macht es unempfindlich gegen Abstürze: Eine abgerissene Zeile
  kostet diese Zeile, nicht die Datei. Bearbeiten hiesse, die Datei neu zu schreiben.
- Das Ändern einer Summe **gibt es bereits**, in der Form, die zum Archiv passt: als
  Korrekturzeile. Sie hängt an, statt zu überschreiben, und hält damit fest, *dass* korrigiert
  wurde – ein Bearbeiten löschte genau diese Spur.
- Der auf einem anderen Rechner gemessene Anteil liegt gar nicht hier und wäre von hier aus
  ohnehin nicht zu berichtigen.

Wer einen bereits gesendeten Eintrag korrigieren muss, tut das in ProSonata. Was hier korrigiert
werden kann, ist das laufende Segment – über die Zeitkorrektur (Abschnitt 3, *Zeitwert und
Datum*).

### Das Zeitraster

Gerundet wird **einmal**: beim Schreiben, auf die Gesamtsumme des Zeiteintrags. Segmente bleiben
sekundengenau – rundete jedes für sich, summierten sich die Fehler. Gerundet wird **aufwärts**
(`Math.ceil`): Bei einem Raster von 15 Minuten werden aus 2:05 h gebuchte 2.25 h.

Das Raster gehört zum **Repository**, denn die Abmachung, wie gerundet wird, gehört zum Kunden.
Hat ein Repository keines, gilt die Vorgabe aus `config.json`; die ist nur dort zu ändern und
steht auf `exakt`. Beides zusammen ist eine Kette – `readRepoConfig(root).grid ?? config.grid` –,
und sie muss überall dieselbe sein: Panel, Log **und** Versand. Genau daran fehlte es lange: Der
Versand kannte nur die Vorgabe, sodass ein Repository eine Rundung anzeigen konnte, die nie
stattfand.

Gefragt wird im Augenblick des Schreibens, nicht beim Anlegen des Eintrags. Damit erreicht ein
geändertes Raster jeden noch offenen Eintrag – dieselbe Linie wie bei Projekt und Kategorie, wo
eine Korrektur ebenfalls alles Unfertige mitzieht.

### Nacharbeit einem geschlossenen Eintrag zuschlagen

Auf dem Hauptbranch schliesst ein Commit seinen Eintrag, und der Timer läuft in einen neuen
weiter. Wer danach noch nacharbeitet und nicht mehr committet, misst Zeit, die zum eben
gemachten Commit gehört – gebucht würde sie aber beim nächsten, unter dessen Text.

Deshalb lässt sie sich **von Hand** dem zuletzt abgeschlossenen Eintrag dieses Branches
zuschlagen. Geschrieben wird dabei nur `workingTime` als neue **Gesamtsumme**; Text, Datum und
Marker bleiben unberührt – dieselbe Mechanik wie bei der Antwort „hinzufügen" auf einen anderswo
abgeschlossenen Eintrag.

Das biegt bewusst eine Regel: `close()` verspricht, dass eine geschlossene `timeID` nie wieder
geschrieben wird. Das gilt für alles, was das Werkzeug von sich aus tut. Hier entscheidet ein
Mensch, einmal, für einen Eintrag. Drei Grenzen bleiben:

- Ein **fakturierter** Eintrag wird abgelehnt (`isInvoiced`), auch auf Wunsch.
- Die Ausgangszahl kommt aus **ProSonata**, nicht aus dem lokalen Zustand – dort kann von Hand
  korrigiert worden sein, und geschrieben wird eine Summe.
- Der offene Eintrag muss ProSonata noch **unbekannt** sein. Ist er schon angelegt, bliebe dort
  sonst eine leere Hülle zurück; dann ist Abschliessen der richtige Weg.

Gezeigt wird vorher, was tatsächlich geschrieben wird – **nach** dem Raster, das aufrundet: Fünf
Minuten machen bei Viertelstunden-Raster aus 2.00 h nicht 2.08 h, sondern 2.25 h.

### Offene Zeiteinträge: `[LAUFEND:kennung]`

Ein Branch-Eintrag ist wochenlang offen. Solange steht am Anfang seines Textes ein Marker:

```
[LAUFEND:a3f9c1][260802-08:12] Buchungsmodul
```

Er leistet dreierlei:

- **Er sagt, seit wann gemessen wird.** Die zweite Klammer `[JJMMTT-HH:MM]` steht nur, solange
  ein Timer läuft; Pausieren entfernt sie. Sie ist der Statusanzeiger, der früher
  `workingTimeStart` war – im eigenen Namensraum, und mit dem Tag, den eine Uhrzeit allein
  nicht hat. Eine **eigene** Klammer, keine erweiterte erste: Ein älterer Stand liest
  `^\[LAUFEND:([0-9a-f]+)\]` und fände eine Marke mit Zeit *innerhalb* der Klammer nicht mehr –
  er schlösse daraus „anderswo abgeschlossen" und parkte laufende Stunden. Daneben greift sein
  Muster weiter.
- **Er macht den Eintrag als unfertig sichtbar.** Die API hat **kein Statusfeld** –
  `timeViaApi` ist nur lesend. Der Text ist der einzige Kanal dafür. Bleibt der Abschluss
  einmal aus, fällt der Marker beim Fakturieren auf – genau dort, wo es darauf ankommt.
- **Er macht den Eintrag über Rechnergrenzen wiederfindbar.** Die Kennung identifiziert den
  **Branch**, nicht den Eintrag – die `timeID` steht ja bereits im Eintrag selbst. Ein anderer
  Rechner erkennt daran, welcher der offenen Zeiteinträge zu seinem Branch gehört.

Die Kennung ist ein kurzer Hash aus **Root-Commit-SHA des Repos** und **Branchname**. Beides
ist auf jedem Klon identisch, die Kennung lässt sich also überall ohne Absprache berechnen.
Gesucht wird der Root-Commit **entlang der First-Parent-Linie**: Eine mit
`--allow-unrelated-histories` hereingeholte Historie – ein Subtree, eine zusammengelegte
Fremdhistorie – bringt eine eigene Wurzel mit, und die ist oft die jüngere. Ohne diese
Einschränkung stünde sie in `rev-list` zuoberst und alle Branches des Repositories bekämen am
Tag des Imports stillschweigend neue Kennungen; offene Zeiteinträge wären nicht mehr
auffindbar.
Der Branchname selbst erscheint dadurch nicht in ProSonata (Abschnitt 5). Das Wort `LAUFEND`
ist konfigurierbar.

**Beim Abschluss fällt der ganze Marker weg**, samt Klammern und Leerzeichen. Auf der Rechnung
steht nur der Text.

Zwei Fallstricke:

- Wird `detail` in ProSonata von Hand geändert und der Marker dabei zerstört, ist die
  Verknüpfung weg. Daran darf das Werkzeug nicht scheitern: fehlt die Kennung, legt es einen
  neuen Zeiteintrag an, statt zu raten.
- Ein umbenannter Branch ergibt eine neue Kennung und damit einen neuen Zeiteintrag.

Auf dem Hauptbranch gibt es keine offenen Zeiteinträge: jeder Commit schliesst seinen ab. Dort
steht deshalb nie ein Marker.

### Mehrere Rechner

Büro und Zuhause haben getrennte `state.json`. Ohne Vorkehrung entstünde pro Rechner ein
eigener Zeiteintrag – ein Branch, zwei Rechnungszeilen, beide offen. Zwei Schritte verhindern
das:

1. **Finden.** Trifft ein Rechner auf einen Branch, zu dem er lokal keinen Eintrag hat, sucht
   er ihn per `GET /projecttimes?projectID=…&isInvoiced=0&userID=myself&detail=LAUFEND:kennung`
   – ein gezielter Aufruf, kein Durchsuchen einer Liste. Findet er ihn, übernimmt er die
   `timeID` ohne Rückfrage. Findet er ihn nicht, legt er einen neuen Zeiteintrag an.
   Dass der `detail`-Filter als Teilstring sucht, ist am Konto belegt (Abschnitt 9).
   **`userID=myself` wiegt so schwer wie der Marker.** Die Kennung ist ein Hash aus
   Root-Commit und Branchname, also in jedem Klon gleich – auch im Klon einer Kollegin.
   Ohne den Filter fänden zwei Personen am selben Branch den Eintrag der jeweils anderen und
   schrieben hinein: Die Stunden der einen erschienen in der Zeiterfassung der anderen, denn
   ein Zeiteintrag gehört dem, der ihn angelegt hat. Mit dem Filter führt **jede Person ihren
   eigenen Eintrag pro Branch** – was dem Datenmodell von ProSonata entspricht und einer
   Rechnung, die „Buchungsmodul: A 8 h, B 4 h" ausweist.
2. **Summieren.** Die absolute Summe ist rechnergebunden und darf nicht mehr unbesehen
   geschrieben werden – der Bürorechner würde sonst am nächsten Tag die zu Hause gearbeiteten
   Stunden überschreiben. Jeder Rechner merkt sich deshalb den **fremden Anteil** und schreibt
   `fremd + eigen`. Gelesen wird im GET, der wegen `isInvoiced` ohnehin vor jedem PUT fällig
   ist. Der geschriebene Wert hängt nicht vom gelesenen ab und bleibt damit idempotent.

Vorausgesetzt ist, dass immer nur **ein Rechner derselben Person zur Zeit** am selben Branch
arbeitet – Büro tagsüber, zu Hause abends. Zwei Personen stören einander nicht, sie haben je
einen eigenen Eintrag; zwei Rechner **einer** Person, die gleichzeitig buchen, sind nicht
abgedeckt (Abschnitt 12).

Der Abschluss trägt über Rechnergrenzen mit: Schliesst du im Büro ab, verschwindet der Marker.
Der Heimrechner sieht das beim nächsten GET – entweder im Abgleich oder vor dem nächsten
Schreibvorgang, denn dort wird ohnehin gelesen.

**Was dann mit der Zeit geschieht, die hier noch nicht geschrieben ist, entscheidet der
Benutzer.** Der abgeschlossene Zeiteintrag gehört dem, der ihn abgeschlossen hat: Der
endgültige Text steht, der Marker ist weg, Korrekturen in ProSonata sollen bleiben. Ein
weiterer Schreibzugriff würde alle drei zunichtemachen. Die hier gemessene Zeit ist aber echt
und muss irgendwohin. Deshalb wird der Eintrag **geparkt** – nichts wird geschrieben, der
Timer läuft weiter hinein, die Antwort deckt am Ende alles Angefallene ab – und gefragt wird
dort, wo jemand antworten kann: im Editor oder mit `prosonata resume`. Nicht im
`post-commit`-Hook, wo der Fall meist auffällt und niemand zuhört.

Zwei Antworten:

- **Hinzufügen** – ein letztes `PUT` auf die alte `timeID`, das **nur** `workingTime` trägt.
  Ohne `detail` bleibt der endgültige Text unberührt und der Marker kommt nicht zurück.
- **Neuer Eintrag** – auf die alte `timeID` wird nichts geschrieben; die Restzeit wird beim
  nächsten Schreibvorgang ein eigener Zeiteintrag.

Danach ist der lokale Eintrag in beiden Fällen von der alten `timeID` gelöst: Was ab jetzt
anfällt, gehört zu einem neuen Zeiteintrag, denn der alte ist fertig.

### Abschluss eines Branch-Eintrags

**Von Hand**, mit dem endgültigen Text. Der Präfix fällt weg, und auf diese `timeID` schreibt
das Werkzeug nie wieder – der Zeiteintrag gehört ab dann dem Benutzer, Korrekturen in
ProSonata bleiben bestehen.

Daraus folgt der Vorbehalt zur absoluten Summe: Korrekturen an einem **offenen** Zeiteintrag
werden beim nächsten Schreibzugriff überschrieben. Das ist akzeptiert, solange sie erst nach
dem Abschluss erfolgen.

Das Werkzeug **schlägt** den Abschluss vor, sobald eines von vier Signalen anspricht. Alle
sind nur Vorschläge, keines schliesst von selbst ab.

| Signal | Erkennung |
|---|---|
| Branch ist gemergt | `git merge-base --is-ancestor <branch> <hauptbranch>` |
| **Remote-Branch verschwunden** | `git fetch --prune`, danach fehlt `refs/remotes/origin/<branch>` |
| Lokaler Branch gelöscht | Ref existiert nicht mehr, Zeiteintrag aber schon |
| Zeiteintrag ruht | Seit längerem keine neue Zeit und kein Commit |

Das zweite Signal ist das wichtigste, weil Pull Requests auf github.com geschlossen werden und
VS Code davon nichts mitbekommt. Ein **Squash-Merge** ist über den ersten Weg nämlich nicht
erkennbar: dabei entsteht ein neuer Commit, der alte Branch-Tip taucht im Hauptbranch nie auf.
Löscht GitHub den Branch nach dem Merge – die übliche Einstellung –, verschwindet nach einem
`fetch --prune` aber die Remote-Ref, und genau das ist zuverlässig sichtbar.

`git fetch --prune` hängt deshalb am Zeitgeber der Extension (Abschnitt 4), läuft aber
seltener als der Versand – etwa stündlich, und nur solange ein Branch-Eintrag offen ist. Es
ist ein Netzzugriff auf das Git-Remote, kein API-Call an ProSonata.

Das vierte Signal fängt den Rest: Branches, die nie gemergt und nie gelöscht werden. Offene
Zeiteinträge sind ausserdem jederzeit in der Oberfläche sichtbar, mit ihrem Alter – wer sie
übersieht, sieht spätestens den `LAUFEND`-Präfix in ProSonata.

### Fakturierte Zeiteinträge

Vor jedem PUT ist `isInvoiced` zu prüfen – im selben GET, der den fremden Anteil liefert. Ist
der Zeiteintrag fakturiert, darf er nicht wachsen. Stattdessen entsteht ein Folgeeintrag mit
demselben Text und derselben Kennung; er bekommt die Zeit, die seit dem letzten Schreibzugriff
dazugekommen ist, und beginnt selbst wieder mit fremdem Anteil null.

### Warnungen

Rein informierend. Gebucht wird nie automatisch.

- **Segment läuft ungewöhnlich lange** – Pause vergessen? Gemessen wird das **laufende
  Segment**, nicht die Summe des Eintrags: Ein Branch-Eintrag kann zwanzig Stunden halten und
  vor einer Minute gestartet sein. Gefragt wird nicht „noch dran?", sondern **wie viel davon
  zählt** – ein über Nacht laufender Timer hat Wanduhrzeit gemessen, und was davon Arbeit war,
  weiss nur, wer dabei war. Antworten: alles behalten, eine eigene Dauer, verwerfen. Nach
  „alles behalten" schweigt die Frage eine Stunde, sonst wäre sie nach zwei Tagen unsichtbar.
  Im Terminal dasselbe über `prosonata pause [h:mm]`.
- **Zeit vor- und zurückdrehen.** Zwei Alltagsfehler, einer je Richtung: Der Timer lief durch
  ein Telefonat, oder er lief nie, obwohl gearbeitet wurde. Beides erinnert ein Mensch als
  **Uhrzeit** („um 9:40 klingelte das Telefon"), nicht als Differenz – deshalb wirken Anker
  absolut. `bis 9:40` bucht das laufende Segment bis dahin und **hält an**; nur so stimmen im
  Segmentprotokoll auch die Uhrzeiten, während ein verschobener Beginn die Dauer erhielte und
  den Zeitpunkt erfände. `ab 9:40` verschiebt den **Beginn** des
  laufenden Segments dorthin, sodass eine durchgehende Messung entsteht statt einer Messung
  plus Nachtrag; ohne laufenden Timer wird die Zeit seither als eine Spanne ergänzt.

  **Uhrzeiten setzen einen laufenden Timer voraus.** Sie ändern das laufende Segment; steht
  der Timer, gibt es keines, auf das sie zeigen könnten. Ein fertiges Segment wird nicht
  umgeschrieben – das Protokoll ist ein Archiv, und „alles nach 17:15 zählt nicht" sagt nicht,
  welche der gebuchten Spannen schrumpfen soll. Was bleibt, ist das Nachtragen einer **Dauer**;
  sie ist keine Messung und trägt deshalb im Protokoll keine Anfangszeit.

  **Die Grenze ist das Ende des letzten Segments.** Ein abgeschlossenes Segment ist eine
  Aussage: Bis hierhin ist alles richtig erfasst. Deshalb darf kein Anker dahinter greifen –
  und deshalb braucht es auch keine Suche nach Lücken: Zwischen jenem Ende und jetzt liegt
  nichts Gemessenes ausser dem laufenden Segment selbst. Wird ein Wunsch dadurch gekürzt,
  sagt es die Zeile, bevor sie angeklickt wird. Gerechnet wird beides in einer reinen Funktion, die
  beide Frontends zweimal brauchen: einmal, um die Wirkung zu zeigen, einmal, um sie zu tun.
- **Beim Schliessen des letzten VS-Code-Fensters wird pausiert** (abschaltbar über
  `pauseOnWindowClose`). Anhalten ist die vorsichtige Richtung; ein Timer, der das Schliessen
  des Editors überlebt, ist der klassische Weg, eine Nacht zu verbuchen. Starten bleibt
  dagegen eine Entscheidung, die niemand für dich trifft.
- **Timer läuft ungewöhnlich lange ohne Commit** – Pause vergessen? Verhindert, dass das
  Mittagessen auf der Kundenrechnung landet.
- **Commit ohne laufenden Timer** – Start vergessen? Mit Angebot, die Zeit seit dem letzten
  Commit nachzutragen. Das ist der teurere der beiden Fehler, weil die Zeit sonst
  unwiederbringlich verloren ist.

### Zurückgerollte Commits

**Grundsatz: Ein Rückroll ändert nie den Zeitwert, nur seine Zuordnung.** Gearbeitete Zeit ist
gearbeitet, unabhängig davon, ob der Commit überlebt. Sie wird nie verworfen und nie doppelt
gezählt.

**Auf einem Branch** ist der Fall gegenstandslos: der Zeiteintrag hängt am Branch, nicht an
SHAs. `reset`, `amend`, `rebase` und Squash lassen ihn unberührt – die Zuordnung ist dadurch
robuster als eine SHA-Verknüpfung. Nur ein Text, der aus dem Trailer des zurückgerollten
Commits kam, bleibt stehen, bis ein neuer ihn ersetzt.

**Auf dem Hauptbranch** hängt jeder Zeiteintrag an seiner SHA. Ist diese von HEAD nicht mehr
erreichbar, war der Commit zurückgerollt:

- **Noch nicht gesendet** – durch den aufgeschobenen Versand der Normalfall, auch bei einem
  `--amend` unmittelbar nach dem Commit: die Sekunden fliessen in den nächsten Zeiteintrag,
  dessen Commit die Arbeit ersetzt. Keine Rückfrage. In ProSonata ist nie etwas Falsches
  erschienen.
- **Schon gesendet** – der Zeiteintrag steht in ProSonata und trägt echte Zeit. Rückfrage im
  nächsten VS-Code-Fenster, nicht im Hook: **zusammenführen** oder **stehen lassen**.
  Zusammenführen heisst summieren – ein Zeiteintrag behält die Gesamtzeit und den neuen Text,
  die übrigen werden per `DELETE /projecttimes/{id}` entfernt. Stehen lassen heisst: der alte
  bleibt mit seiner Zeit und seinem Text, der neue Commit legt einen eigenen an. Beide Wege
  erhalten die Summe.

---

## 4. Versand

**Gesendet wird aufgeschoben:** was älter als etwa zehn Minuten ist, geht beim nächsten
Ereignis raus. Nicht sofort beim Commit, nicht beim Push.

Auslöser sind **Handlungen und ein Zeitgeber**, nicht der Fensterwechsel:

- Commit (über den Hook)
- Start, Pause, Abschluss eines Zeiteintrags, Textänderung
- ein Zeitgeber in der Extension, solange sie läuft
- das Schliessen von VS Code

**Kein Versand bei Fensterfokus.** Zwischen Fenstern wird ständig gewechselt; daran gekoppelt
wäre der Versand kein aufgeschobener mehr, sondern ein dauerndes Klopfen an die API.

Begründung: Zurückgerollte Commits erreichen ProSonata so gar nicht erst, ohne dass der
Versand an ein Remote gebunden wäre. Ein `pre-push`-Hook hätte drei Löcher: Repos ohne Remote,
tagelange lokale Arbeit, und ein Rebase mit Force-Push, nach dem sämtliche Zuordnungen eines
Branches verwaist sind.

- Ein Zeiteintrag wird erst geschrieben, wenn er **einen Text hat** – also ab dem ersten
  Commit auf dem Branch. Vorher bleibt er lokal.
- Erster Schreibzugriff POST, danach PUT.
- Mehrere Änderungen innerhalb des Fensters werden zusammengefasst; dank absoluter Summe
  zählt ohnehin nur der letzte Stand.
- Bei HTTP-Fehlern bleibt der Schreibzugriff ausstehend und wird beim nächsten Ereignis erneut
  versucht. 429 und 403 werden verständlich gemeldet, nicht verschluckt.
- Am selben Zeitgeber hängt `git fetch --prune`, um geschlossene Pull Requests zu bemerken
  (Abschnitt 3) – aber deutlich seltener, etwa stündlich, und nur solange es überhaupt einen
  offenen Branch-Eintrag gibt. Das ist ein Zugriff auf das Git-Remote, kein API-Call an
  ProSonata.

---

## 5. Scope

Der Scope ist **Arbeitsverzeichnis + Branch**. Pro Scope gibt es höchstens einen laufenden
Timer und höchstens einen offenen Zeiteintrag. Mehrere Scopes sind gleichzeitig möglich,
ebenso mehrere parallel laufende Timer.

Der Branch ist Teil des Scopes, weil er den Zeiteintrag bestimmt: Zeit auf `feature/buchung`
darf nicht in dem Zeiteintrag landen, der zu `fix/login` gehört.

Wechselt der Branch, während ein Timer läuft, wird die bis dahin aufgelaufene Zeit dem
**alten** Scope zugeschlagen; danach fragt das Werkzeug, ob im neuen Scope weitergelaufen
wird. Dafür HEAD beobachten, solange ein Timer läuft. Das ist kein Aktivitäts-Watcher, sondern
ein einzelner Dateizeiger.

Geschieht der Wechsel im Terminal **ohne offenes VS-Code-Fenster**, bemerkt es niemand – ein
`post-checkout`-Hook ist bewusst verworfen (Abschnitt 11). Der Wechsel fällt dann erst beim
nächsten Schreibzugriff auf, rückblickend und ohne bekannten Zeitpunkt. In diesem Fall geht
die gesamte Zeit an den alten Scope, der Timer wird pausiert, und die Frage kommt beim
nächsten Öffnen.

**Worktrees beachten.** Paralleles Arbeiten an mehreren Branches geschieht über
`git worktree` oder mehrere Klone. In einem Worktree ist `.git` eine **Datei**, nicht ein
Verzeichnis, und HEAD liegt unter `.git/worktrees/<name>/HEAD`. Den Pfad deshalb nie
hartcodieren, sondern per `git rev-parse --git-path HEAD` auflösen – das liefert in allen
Fällen den richtigen Ort. Ebenso `--git-common-dir` statt `--git-dir` verwenden, wo es um das
gemeinsame Repository geht.

Für `git config --local` gilt: die Projektzuordnung liegt im **gemeinsamen** Config aller
Worktrees, das ist richtig so. Nur der Scope-Schlüssel unterscheidet sich, weil Pfad und
Branch je Worktree verschieden sind.

Der Branchname selbst wird **nicht** an ProSonata übertragen. Er bestimmt die Klammer des
Zeiteintrags, nicht seinen Text – in den Marker offener Einträge geht nur sein Hash
(Abschnitt 3).

---

## 6. Zuordnung Repo → Projekt

Ein Repo gehört immer zu **einem Kunden**, aber nicht zwingend zu einem Projekt: ein
langlebiges Repo kann über die Jahre mehrere ProSonata-Projekte tragen (Wartung, Features mit
eigener Offerte).

Ablage in `git config --local`, mehrwertig plus aktiver Zeiger:

```
[prosonata]
    project = 189:Website Wartung
    project = 412:Feature Buchungsmodul
    active  = 412
    grid    = exact
[prosonata "189"]
    category = 15
[prosonata "412"]
    category = 7
[prosonata "a3f9c1"]
    mode = commit
```

**Die ID steht in der Untersektion, nicht im Schlüssel** – also `prosonata.412.category`
und nicht `prosonata.category.412`. Git verlangt, dass der letzte Teil eines Schlüssels mit
einem Buchstaben beginnt; eine Projekt-ID beginnt nie so, und eine Branch-Kennung nur
zufällig. `git config prosonata.category.412 7` scheitert mit „invalid key".

**Die Projektwahl gehört ins Panel, die Kategorienwahl in den Timer.**

- Das **Projekt** wechselt selten – oft über Monate nicht. Es steht deshalb im Panel
  (Abschnitt 8), zusammen mit Zeitraster und Branch-Modus.
- Die **Kategorie** wechselt innerhalb desselben Projekts und gehört deshalb an den Timer.
  Sie **bleibt gewählt**: der zuletzt benutzte Wert steht weiterhin da, Start ist ein Klick
  ohne Rückfrage. Gemerkt wird sie **pro Projekt** – nicht weil die Liste projektabhängig
  wäre (sie ist es nicht, siehe unten), sondern weil sich die Art der Arbeit je Projekt
  unterscheidet: in der Wartung wird anders gebucht als in der Feature-Entwicklung.
- Die **Kategorienliste ist global** (Abschnitt 9). Sie wird einmal geholt und gecacht.
  Eingeschränkt wird sie clientseitig auf `active = 1` und auf die Kategorien, die für den
  Kunden des aktiven Projekts gelten – das sind die allgemeinen mit
  `linkedCustomerID: null` plus die mit der `customerID` des Projekts.
- **Ein Umschalten des Projekts ist eine Korrektur.** Es wirkt auf alle noch nicht
  abgeschlossenen Zeiteinträge – auch auf den, in dem gerade Zeit läuft. Ein PUT braucht
  nicht alle Felder, `projectID` allein genügt. Gehört das neue Projekt zu einem anderen
  Kunden, kann die gemerkte Kategorie dort ungültig sein; dann wird auf die für dieses
  Projekt gemerkte umgestellt und, falls es keine gibt, einmal gefragt.
- `git config` reist **nicht** mit dem Clone. Jeder Rechner braucht eine einmalige
  Einrichtung. In einem unbekannten Repo fragt das Werkzeug und schreibt die Antwort weg.

---

## 7. Lokaler Zustand

Ablage zentral in `~/.prosonata/` – **nicht** in `.git/`, **nicht** in VS Codes `globalState`.

Begründung: Der `post-commit`-Hook läuft als eigener Prozess, oft ohne offenes VS Code.
`globalState` wäre für ihn unerreichbar. Ablage im Repo würde parallele Timer über mehrere
Repos verstreuen und wäre beim Neu-Klonen weg.

```
~/.prosonata/
  config.json      API-Key, Subdomain, globale Defaults   (Dateirechte 0600)
  state.json       laufende Timer, offene Zeiteinträge,
                   ausstehende Schreibzugriffe            (atomar, mit Version)
  log.jsonl        abgeschlossene Segmente,
                   SHA-Annotationen           (append-only, gekürzt statt archiviert)
  cache.json       Projekte, Kategorien
  segments.jsonl   jedes gemessene Segment, dauerhaft
```

### Nebenläufigkeit: atomar genügt nicht

Auf `state.json` schreiben **drei Akteure**: die Extension – womöglich aus mehreren Fenstern
–, der Hook bei jedem Commit, und die CLI.

**Atomar schreiben** heisst: in eine Temp-Datei, dann `rename`. Das verhindert, dass jemand
halb geschriebenes JSON liest; das Betriebssystem ersetzt die Datei in einem Zug.

**Es verhindert aber keinen verlorenen Schreibzugriff:**

```
22:14:03  Extension liest state.json   (Timer läuft, 0 s aufgelaufen)
22:14:03  Hook liest state.json        (derselbe Stand)
22:14:04  Hook schneidet Segment, schreibt  → 1800 s im Zeiteintrag
22:14:04  Extension schreibt "pausiert"     → überschreibt die 1800 s
```

Beide Schreibzugriffe waren für sich atomar, und trotzdem ist eine halbe Stunde weg –
genau das, wogegen dieses Werkzeug gebaut wird.

**Deshalb trägt `state.json` einen Versionszähler:**

```json
{ "formatVersion": 1, "version": 47, "timers": [...], "entries": [...] }
```

Wer schreiben will, merkt sich `version` beim Lesen und schreibt nur, wenn beim erneuten
Lesen immer noch derselbe Wert dasteht – dann mit `version + 1`. Sonst von vorn. Klassisches
Compare-and-Swap.

Gegenüber einer Sperrdatei hat das einen entscheidenden Vorzug: Ein abgestürzter Prozess
hinterlässt **keine Leiche**. Eine verwaiste `state.lock` würde alle anderen blockieren, bis
jemand sie für tot erklärt – und diese Entscheidung ist heikel, weil ein zu früher Übergriff
genau die Wettlaufsituation zurückholt, gegen die die Sperre gedacht war.

**Lesende brauchen nichts davon.** Das atomare `rename` garantiert ihnen immer einen in sich
stimmigen Stand.

**Temp-Dateien aufräumen:** Stirbt ein Prozess zwischen Schreiben und `rename`, bleibt eine
`state.json.tmp-*` liegen. Der nächste Schreiber löscht solche Reste, sobald sie einige
Minuten alt sind – er arbeitet ohnehin gerade in dem Verzeichnis. Kein eigener Prozess, kein
Zeitplan.

**`formatVersion`** steht daneben, damit spätere Änderungen am Aufbau migrierbar sind. Eine
veröffentlichte Extension trifft auf Zustände, die ältere Fassungen geschrieben haben.

### Journal

**`log.jsonl` ist append-only**, damit dort gar keine konkurrierenden Updates entstehen.

**Es ist ein Puffer, kein Archiv.** Was in ProSonata angekommen ist, wird dort geführt –
die lokale Zeile daneben belegt nichts, was der Zeiteintrag nicht besser belegt. Das Journal
trägt deshalb nur zwei Aufgaben:

- **Wiederherstellung**, falls `state.json` verloren geht oder unlesbar wird – und dafür
  zählt ausschliesslich, was **noch nicht** übertragen ist.
- **Fehlersuche** über die letzten Tage.

Daraus folgt die Regel: **Die Datei wird gekürzt, nicht rotiert.** Überschreitet sie eine
Grösse, behält der nächste Schreiber den jüngsten Teil und verwirft den Rest – niemals
jedoch Zeilen zu Segmenten, die noch auf ihre Übertragung warten. Es entstehen keine
Jahrgänge, nichts sammelt sich an, und niemand muss von Hand aufräumen.

Damit das Journal seine erste Aufgabe erfüllen kann, muss eine Zeile **alles enthalten, was
einen ausstehenden Schreibzugriff wieder aufbauen kann**: Projekt, Kategorie, Sekunden,
Datum, Text, Kennung und gegebenenfalls die SHA. Eine blosse Notiz „Segment beendet" wäre
für die Wiederherstellung wertlos.

### Wiederherstellung

Geht `state.json` verloren oder ist sie unlesbar, ist das **kein Sonderfall, sondern der
Mehrrechner-Mechanismus aus Abschnitt 3**. Ein Rechner mit leerem Zustand ist von einem
zweiten Rechner, der diesen Branch noch nie gesehen hat, nicht zu unterscheiden – und für
den ist der Weg schon beschrieben.

Der Ablauf:

1. **Erkennen.** Unlesbares JSON, fehlende `version` oder eine unbekannte `formatVersion`
   gelten als Verlust.
2. **Beiseitelegen statt überschreiben.** Die Datei wird zu `state.json.broken-<zeitstempel>`.
   Sie ist die einzige Spur noch nicht übertragener Zeit; wer sie überschreibt, vernichtet
   genau das, was zu retten wäre.
3. **Leeren Zustand anlegen** mit aktueller `formatVersion` und `version: 1`.
4. **Ausstehende Schreibzugriffe aus `log.jsonl` nachziehen.** Alles, was dort als noch nicht
   übertragen steht, wird wieder eingereiht.
5. **Offene Zeiteinträge beim nächsten Kontakt wiederfinden.** Das geschieht von selbst:
   `sync()` sucht zum Branch die Kennung und findet den offenen Zeiteintrag in ProSonata
   (Abschnitt 3). Übernommen werden `timeID` und Text; **`foreignSeconds` wird auf den dort
   stehenden Wert gesetzt, die eigene Summe beginnt bei null.** Damit ist nichts doppelt
   gezählt und nichts verloren – künftige Schreibzugriffe addieren nur, was ab jetzt
   dazukommt.
6. **Melden, was nicht zu retten ist.**

**Verloren ist genau eine Sache: das laufende Segment.** Die Zeit seit dem letzten
Schreibzugriff steht nirgends sonst – nicht in ProSonata, nicht im Journal. Das ist ehrlich
zu melden, statt es zu verschweigen oder zu schätzen.

Die Repo-Konfiguration ist nicht betroffen: Projekt, Kategorie und Branch-Modus liegen in
`git config --local` des jeweiligen Repos (Abschnitt 6) und überstehen den Verlust.

### API-Key

Liegt in `config.json` mit Dateirechten 0600 – **nicht** in VS Codes `SecretStorage` und nicht
in den Settings. Der Hook braucht den Key ebenfalls und kann `SecretStorage` nicht lesen.
Settings würden über Settings Sync in die Cloud wandern.

### Datenmodell

Ein laufender Timer trägt:

```
id            lokale UUID (nicht auf eine ProSonata-ID warten)
origin        "local" | "remote"      – heute konstant "local"
remoteTimerId null                    – reserviert für die Timer-API
repoPath, branch
startedAt     Zeitstempel des laufenden Segments
accumulated   Sekunden aus vorherigen Segmenten desselben Zeiteintrags
entryId       lokaler Zeiteintrag, in den die Zeit fliesst
```

Ein Zeiteintrag trägt:

```
id              lokale UUID
projectId, categoryId
repoPath, branch                      – auf dem Hauptbranch zusätzlich die SHA
key             Kennung aus Root-Commit-SHA und Branchname
text            Rechnungstext, vorläufig oder endgültig
seconds         eigene Summe auf diesem Rechner
foreignSeconds  Anteil anderer Rechner, aus dem letzten GET abgeleitet
lastWritten     zuletzt geschriebener Gesamtwert – daran erkennt der
                Rechner, dass ein anderer dazugeschrieben hat
timeID          ProSonata-ID, null vor dem ersten POST
state           "offen" | "abgeschlossen"
```

Die Statusleiste rendert eine **Liste** laufender Timer, kein Singleton – parallele Timer sind
der Normalfall, und später können fremde Timer von anderen Geräten dazukommen.

---

## 8. Architektur

**Ein Paket, drei Einstiegspunkte.** TypeScript/Node.

```
src/core        Logik, Zustand, API-Client. Importiert NIEMALS "vscode".
bin/cli         bin "prosonata". Wird vom post-commit-Hook aufgerufen.
src/extension   QuickPicks, Statusleiste, FileSystemWatcher.
```

Die Trennung ist die zentrale Strukturentscheidung. Läge die Logik in der Extension, könnte
der Hook sie nicht nutzen und man baute sie ein zweites Mal.

Ein Monorepo mit npm-Workspaces leistet dieselbe Trennung, kostet aber vom ersten Tag an
Versionsabgleich und drei Build-Konfigurationen. Aufteilen lässt es sich später jederzeit –
etwa wenn `core` eigenständig veröffentlicht werden soll.

**Alle Schreibzugriffe auf ProSonata laufen durch ein einziges Modul in `core`.** Es kennt drei
Vorgänge – Zeiteintrag schreiben, abschliessen, löschen – und ist heute als POST, PUT und
DELETE auf `projecttimes` implementiert. Kommt die Timer-API, wird dieses eine Modul
ausgetauscht; alles darüber bleibt unberührt.

Eine `sync()`-Funktion gleicht den lokalen Zustand mit ProSonata ab: sie sucht offene
Zeiteinträge zur Kennung des aktuellen Branches, übernimmt gefundene `timeID`s und aktualisiert
den fremden Anteil (Abschnitt 3). Aufgerufen wird sie vor jedem Schreibzugriff, beim ersten
Segment auf einem unbekannten Branch und bei Rückkehr nach langer Abwesenheit. Kommt die
Timer-API, ist sie auch die Stelle, an der fremde Timer sichtbar würden.

**Kein DDEV, kein PHP, keine Datenbank, kein Webserver.** Ein Node-Prozess und ein paar
JSON-Dateien.

Build: esbuild für Extension und CLI, vitest für `core`.
Entwicklung: `npm link` für die CLI, F5 für den Extension Development Host.
Installation: lokal als `.vsix`, später Marketplace.

### Laufzeit und Modulformat

Es sind **zwei** Laufzeiten, und die schwierigere ist nicht die naheliegende. Die Extension
läuft im Extension Host von VS Code – dort ist die Node-Version vorgegeben, sie kommt aus dem
mitgelieferten Electron. Die **CLI läuft auf dem Node des Benutzers**, und das ist die harte
Grenze: Was dort installiert ist, bestimmt jemand anderes.

- **`engines.node: ">=20"`.** Gebraucht wird wenig – `fs`, `child_process`, `crypto` für die
  Branch-Kennung und `fetch`. Global verfügbares `fetch` gibt es ab Node 18, darunter bräuchte
  es eine Abhängigkeit. Node 18 und 20 sind aus der Wartung; für etwas, das erst entsteht,
  ist 20 die sinnvolle Untergrenze. Vor dem Festschreiben den aktuellen LTS-Stand prüfen.
- **Die CLI prüft beim Start die Node-Version** und meldet sie verständlich, statt an einem
  fehlenden `fetch` zu scheitern.
- **`engines.vscode` niedrig ansetzen, etwa 1.75.** Gebraucht werden nur `TreeDataProvider`,
  `extensionKind` und der `FileSystemWatcher` mit `RelativePattern` auf absolutem Pfad – das
  kam mit 1.64. Ein niedriges Minimum kostet nichts und erreicht mehr Leute.

**Modulformat: ESM im Quelltext, CommonJS in der Ausgabe.** Der Extension Host lädt
CommonJS; ESM ist dort nicht der sichere Weg. Weil ohnehin gebündelt wird, betrifft das nur
das Ausgabeformat. Die CLI wird ebenfalls als CJS gebündelt, mit Shebang – das startet
schneller, und der Hook startet bei **jedem** Commit einen Prozess.

**`"type": "module"` gehört nicht in die `package.json`.** Damit wären `.js`-Dateien ESM und
der Extension-Einstiegspunkt liesse sich nicht mehr laden. Ein Werkzeug, ein Ausgabeformat,
keine Dual-Package-Fallen.

### CLI

bin heisst **`prosonata`** – nicht `ps`. `ps` ist das Unix-Werkzeug für die Prozessliste, und
der npm-bin-Pfad liegt in `$PATH` meist vor `/bin`; ein global installiertes `ps` würde bei
Fremdnutzern `ps aux` brechen. Ein kurzer Alias ist optional.

Befehle: `init`, `start`, `pause`, `status`, Zeiteintrag abschliessen, Text ändern.
Kein `end` – ein Timer kennt kein Beenden.

### Extension

- **Panel in der Seitenleiste** – ein eigener View-Container mit `TreeDataProvider`, keine
  Webview. Es zeigt für das geöffnete Repo dauerhaft:

  ```
  ProSonata
    Projekt        24-017 Feature Buchungsmodul
    Zeitraster     exakt
    Branch         feature/buchung
    Zeiteintrag    pro Branch
    Kategorie      Programmierung
    Läuft          0:42:13 · 3:48:02 · Buchungsmodul
    Offen          Rabattstufen         seit 6 Tagen

  Die Timer-Zeile nennt **beide** Zahlen: zuerst das laufende Segment, dann die Summe des
  Branches. Sie beantworten Verschiedenes – „wie lange sitze ich an diesem Stück" und „was
  wird abgerechnet" –, und nur die erste macht einen vergessenen Timer sichtbar.
  ```

  Klick auf eine Zeile öffnet den passenden QuickPick – Projekt wechseln, Zeitraster setzen,
  Kategorie und Modus umschalten, Zeiteintrag abschliessen. Auf dem Hauptbranch ist die Zeile
  `Zeiteintrag` deaktiviert und zeigt `pro Commit`.

  Der Modus steht in einer **eigenen Zeile**, nicht hinter dem Branchnamen: Namen wie
  `167-startseite-mobile-tablet-expertise-layout` schieben in einer schmalen Seitenleiste
  alles Nachfolgende aus dem Bild – ausgerechnet die Einstellung, die bestimmt, was auf der
  Rechnung landet. Die frühere Trennlinie in dieser Skizze gibt es nicht: Eine TreeView kennt
  keine Separatoren, und eine Zeile, die nur so aussieht, ist gebastelt.

  Die Stundenangabe neben dem Projekt stammt aus `timeNeeded` und `timePlanned`
  (Abschnitt 9) – beim Zeiterfassen die nützlichste Zahl, die die API hergibt. Sie wird nur
  beim Projektwechsel aktualisiert, nicht laufend abgefragt.
- Dropdowns über `window.showQuickPick` – native Liste mit Suchfeld, kein UI-Code, kein
  Webview, kein Svelte.
- Der Projekt-QuickPick ist **dreistufig**: oben die im Repo registrierten Projekte, darunter
  die eigenen (`userID=myself`), zuunterst alle übrigen. Gezeigt werden nur **offene, aktive**
  Projekte ohne Vorlagen – `projectStatus=0&activeStatus=1`. Ohne diesen Filter stünden nach
  ein paar Jahren abgeschlossene Projekte und Vorlagen in der Liste.
- Die **Kategorienwahl liegt am Timer** und zeigt den zuletzt benutzten Wert. Ihre Liste hängt
  am Projekt und wird pro Projekt gecacht; ein Command aktualisiert Projekte und Kategorien.
- Statusleiste mit `setInterval` (30 s), clientseitig aus `startedAt` hochgezählt.
- `FileSystemWatcher` auf `state.json`: schreibt der Hook, aktualisieren sich alle offenen
  Fenster sofort – ohne API-Call. Deckt Commits aus Terminal und Claude Code ab.
  Zwei Fallstricke: Die Datei liegt **ausserhalb des Workspace**, der Watcher braucht deshalb
  ein `RelativePattern` auf absolutem Pfad. Und das atomare `rename` erzeugt häufig ein
  Create/Delete-Paar statt eines Change-Events.
- `extensionKind: ["workspace"]`, damit die Extension bei Remote Tunnels dort läuft, wo Code,
  Hooks und `~/.prosonata` liegen.

### Hook

`post-commit`, der einzige Hook. Ruft die CLI, die den gemeinsamen Kern nutzt. Er schneidet
das Segment, schreibt den lokalen Zustand und annotiert die SHA – **gesendet wird nicht im
Hook**, sondern aufgeschoben (Abschnitt 4). Der Commit wartet dadurch nie auf das Netz.

**Der Hook darf sich nicht auf `$PATH` verlassen.** Git führt ihn mit der Umgebung des
Prozesses aus, der `git` aufgerufen hat – und die ist nicht immer deine:

| Woher der Commit kommt | Welche Umgebung der Hook erbt |
|---|---|
| Terminal | Dein interaktives `$PATH` – mit nvm, Homebrew, allem aus der Shell-Konfiguration |
| VS Codes Git-Oberfläche | Die Umgebung, mit der VS Code gestartet wurde |
| VS Code aus Dock oder Finder | Die von launchd – ohne nvm, oft nur `/usr/bin:/bin` |
| Fremde GUI-Clients | Dasselbe Problem |

Ein Hook mit schlichtem `node dist/cli.cjs` findet unter macOS beim Start aus dem Dock also
womöglich **gar kein Node** und scheitert lautlos – genau in den Fällen, die diese Extension
abdecken soll.

**Deshalb löst `prosonata init` die Pfade zur Installationszeit auf** und schreibt sie
absolut in den Hook:

```sh
#!/bin/sh
git config --local --get prosonata.active >/dev/null 2>&1 || exit 0
"/Pfad/zu/node" "/Pfad/zu/dist/cli.cjs" post-commit || true
```

- **Zeile 2 ist der Vorfilter.** In Repos ohne Konfiguration endet der Hook, ohne einen
  Node-Prozess zu starten. Das spart bei jedem fremden Commit den Startaufwand.
- **`|| true`** – der Hook lässt den Commit nie scheitern.
- **Der absolute Node-Pfad bricht bei einem Versionswechsel**, etwa über nvm. Die Extension
  prüft beim Start, ob der eingetragene Pfad noch existiert, und repariert den Hook
  stillschweigend.

Die Installation muss ein Befehl sein (`prosonata init`) und einen bereits vorhandenen
`post-commit` respektieren – die eigene Zeile anhängen, nicht überschreiben.

---

## 9. ProSonata API – relevante Fakten

Belegt durch die Dokumentation in [docs/prosonata-api/](docs/prosonata-api/). Was darüber
hinaus am eigenen Konto geprüft wurde, ist als **gemessen** gekennzeichnet; die Anfragen dazu
liegen in [bruno/](bruno/).

### Grundlagen

- Basis: `https://{subdomain}.prosonata.software/api/v1/{ressource}[/{id}]`
- Auth: Header `X-API-Key`, optional `X-APP-ID` bei App-Integration (volle Rechte).
  Beides ginge auch als Query-Parameter – **nicht** verwenden, Keys gehören nicht in URLs
  und damit in Logs.
- Genutzte Ressourcen: `projects`, `projecttimes`, `projecttimecategories`
- **Keine Timer-Ressource** in der öffentlichen API
- Jede Antwort ist umschlagen in `{ "meta": {…}, "data": […] }`. Nutzdaten stehen unter
  `data`, nie auf oberster Ebene.
- Fehler tragen eine `meta.message` – die ist verwertbar und gehört in die Meldung an den
  Benutzer (Abschnitt 10), statt durch eine eigene Formulierung ersetzt zu werden.
- Listen sind paginiert: `perPage` (Default 100, Maximum 1000) und `page`. Sortierung über
  `orderBy=feld ASC|DESC`, mehrere kommasepariert.

### `projects`

- Nur lesend genutzt. Die Ressource kennt GET, POST und PUT – **kein DELETE**. Das Werkzeug
  legt nie Projekte an und ändert nie welche.
- **Filter für den QuickPick:** `projectStatus` (0 = offen, 1 = in Abrechnung,
  2 = abgeschlossen, 3 = abgebrochen, 4 = bereit zur Abrechnung), `activeStatus`
  (0 = ruhend), `userID` mit dem Sonderwert `myself` für die eigenen Projekte.
- Ein Projekt trägt **`customerID`** – daraus ergibt sich, welche Kategorien gelten.
- **Gemessen:** Die **Liste** enthält bereits `timePlanned` und `timeNeeded` – geplante und
  bereits verbrauchte Stunden. Das Panel braucht für „15,25 von 20 h" also keinen
  Einzelabruf.
- `isProjectTemplate` markiert Vorlagen und steht ebenfalls in der Liste. Als Filterparameter
  ist es nicht dokumentiert – clientseitig aussortieren.

### `projecttimes`

- Die ID heisst **`timeID`**, nicht `id`.
- Pflicht beim POST: **nur `category` und `projectID`**. `date` hat als Default den
  aktuellen Tag, `workingTime` den Wert 0.00, `detail` ist optional.
- `workingTime` dezimal mit Punkt als Trennzeichen.
- POST antwortet **201** mit dem vollständigen Objekt, PUT und DELETE mit **200**.
- **Ein PUT braucht nicht alle Parameter.** Einzelne genügen – auch `projectID` lässt sich
  so nachträglich ändern, worauf sich die Korrektur in Abschnitt 6 stützt.
- **`DELETE /api/v1/projecttimes/{id}` ist verfügbar**, ohne weitere Parameter. Damit lässt
  sich beim Zusammenführen zurückgerollter Zeiteinträge der überzählige sauber entfernen,
  statt ihn auf `workingTime = 0` zu setzen und als Leiche stehen zu lassen.
- **Reichhaltige Filter beim GET:** `projectID`, `category`, `detail`, `date` und `date2`
  (mit vorangestelltem `>` oder `<` für ab/bis), `customerID`, `userID` (Sonderwert
  `myself`), `isInvoiced`, `notInvoiceable`.
- **Gemessen: Der `detail`-Filter sucht als Teilstring.** Acht Zeichen aus der Mitte eines
  vorhandenen Textes lieferten genau den zugehörigen Eintrag. Damit ist die Suche nach dem
  Marker (Abschnitt 3) ein gezielter Aufruf statt einer durchsuchten Liste.
- **Gemessen: Die Liste enthält `detail` und `isInvoiced`.** Für die Prüfung vor einem PUT
  ist also kein Einzelabruf nötig – ein gefilterter Listenaufruf genügt.
- **Gemessen: Ein PUT ersetzt `workingTime`, es addiert nicht.** 1,75 plus ein PUT mit 3,5
  ergab 3,5. Damit ist die absolute Summe tragfähig und jeder Schreibzugriff idempotent.
- **Gemessen: Ein PUT mit Teilrumpf lässt die übrigen Felder unangetastet.** Ein PUT mit
  nur `detail` liess `workingTime`, `date`, `category` und `projectID` unverändert –
  durch erneutes Lesen bestätigt, nicht nur an der Antwort abgelesen. Die Extension schickt
  daher beim Abschluss nur den Text und beim Wachsen nur die Summe.
- **Gemessen: Die Typen sind uneinheitlich, sogar zwischen den Methoden.** Beim GET kommt
  `workingTime` als String (`"1.25"`) und `timeID` als Zahl. In Schreibantworten ist
  `workingTime` eine Zahl; `timeID` ist beim POST ein String (`"2100"`), beim PUT eine Zahl.
  `isInvoiced`, `notInvoiceable` und `timeViaApi` sind durchweg Zahlen. Der Client muss
  beide Formen annehmen und darf sich auf keinen Typ verlassen.
- **Antworten belegen nicht, was gespeichert wurde.** Beim Test zur `detail`-Länge spiegelte
  die POST-Antwort die gesendeten 940 Zeichen zurück, gespeichert waren 800. Wo es darauf
  ankommt, ist erneut zu lesen.
- **Gemessen: Beide Datumsformate werden verstanden.** `"01.06.2026"` wurde als
  `2026-06-01` gespeichert, also korrekt als 1. Juni. Das Werkzeug schickt trotzdem ISO,
  weil eindeutig.
- **Gemessen:** Die Antwort auf einen POST trägt die neue ID doppelt – in `meta.insertID`
  und in `data.timeID`. `timeViaApi` steht auf 1.
- **Gemessen: Die Feldmengen von Lesen und Schreiben decken sich nicht.** Schreibantworten
  fehlen `categoryName`, `projectNo`, `projectName`, `customerID`, `customerName` und
  `username`; dem GET fehlt dafür `freeTimeInput`. Keine ist eine Obermenge der anderen –
  wer ein Feld braucht, muss wissen, aus welcher Antwort es kommt.
- **Gemessen: Eckige Klammern in `detail` bleiben unverändert erhalten.** Der Marker
  `[LAUFEND:kennung]` wird weder maskiert noch entfernt.
- **`detail` wird stillschweigend gekürzt.** Gemessen: 940 gesendete Zeichen wurden als 800
  gespeichert, mitten im Wort abgeschnitten – **ohne Fehler und ohne Meldung**. Die Antwort
  auf den POST spiegelt dabei den gesendeten Wert zurück; erst ein erneutes Lesen zeigt die
  Kürzung.
  Die Dokumentation nennt 200 Zeichen, das eigene Konto hat 800 – ProSonata erhöht das auf
  Anfrage. Die Grenze ist also **kontoabhängig und aus der Antwort nicht ablesbar**.
  Daraus folgt: **Die Extension muss die Länge selbst prüfen**, vor dem Senden warnen und
  den Text unverändert lassen. Auf eine Ablehnung durch die API ist kein Verlass – ein
  abgeschnittener Satz auf einer Kundenrechnung entstünde sonst unbemerkt. Die
  anzunehmende Grenze ist konfigurierbar, Default 200 wie dokumentiert.
  Der Marker `[LAUFEND:kennung]` verbraucht 15 Zeichen davon, mit der Zeitklammer 29.
- `timeViaApi` markiert per API erzeugte Einträge (nur lesend) – **kein** Statusfeld für
  „offen/fertig" vorhanden. Deshalb der Marker im Text.
- Rechte: Benutzer bis Stufe »Zeiterfasser 1« sehen und bearbeiten **nur ihre eigenen**
  Zeiten. Für dieses Werkzeug ist das die richtige Sicht.

### `projecttimecategories`

- **Nur lesend**, und **global** – die Ressource kennt keinen Projektbezug.
- Eine Kategorie kann über `linkedCustomerID` an einen **Kunden** gebunden sein. Der
  Projektbezug entsteht indirekt: ein Projekt trägt `customerID`, und dafür gelten die
  allgemeinen Kategorien (`linkedCustomerID: null`) plus die dieses Kunden.
- Filter: `category`, `categoryName`, `active`, `linkedCustomerID`, `priceGroup`.
  Anzeigereihenfolge über `categoryOrder`, Gruppierung über `groupName`.
- **Gemessen:** 25 Kategorien, davon 23 aktiv, und **keine einzige** mit gesetztem
  `linkedCustomerID`. Die Kundenbindung ist im eigenen Konto ungenutzt; für das Dropdown
  genügt `active=1`. Die Auswertung von `linkedCustomerID` bleibt für fremde Konten
  trotzdem nötig.

### Zugriffsbegrenzung

Je nach Paket 50 bis 500 Aufrufe pro 15 Minuten. **Gemessen: das eigene Konto hat 50** – das
kleinste Kontingent. Damit ist zu rechnen, nicht mit dem oberen Wert.

Jede Antwort trägt in `meta` die Felder `apiLimitRemaining` und `apiLimitReset` (Sekunden bis
zum neuen Intervall). Danach richtet sich das Werkzeug, statt zu schätzen.

Auch mit 50 bleibt es unkritisch, wegen des aufgeschobenen Versands: Ein offener Zeiteintrag
schreibt höchstens alle zehn Minuten, also 1,5-mal pro Intervall. Zehn parallele Zeiteinträge
kämen auf 15 Aufrufe. Zu bedenken ist aber, dass **dasselbe Kontingent für alles gilt**, was
sonst noch auf die API zugreift. Bei 429 nennt die Fehlermeldung die Wartezeit. Kein Polling
einbauen.

### Authentifizierung: persönlicher Benutzer-Key, keine App-Integration

**Gemessen:** Bei Zugriff über eine App-Integration trägt `meta` die Felder `requestAppID`
und `requestIntegration` – aber **weder `requestUserID` noch `usergroupName`**. Die
Integration ist kein Benutzer. Damit wäre offen, wem ein erzeugter Zeiteintrag gehört, und
der Filter `userID=myself`, auf den sich Projektliste und Markersuche stützen, hätte keinen
Bezugspunkt.

**Mit einem persönlichen Benutzer-Key stimmt es:** `meta` trägt `requestUserID`,
`requestUsername` und `usergroupName`, und ein erzeugter Zeiteintrag bekommt die `userID`
dieses Benutzers. Das Werkzeug verwendet deshalb einen Benutzer-Key.

Für die Veröffentlichung heisst das: Die Einrichtung muss das erklären, und `X-APP-ID` ist
optional. Zu bedenken ist dabei die Rechtestufe – Benutzer bis »Zeiterfasser 1« sehen nur
ihre eigenen Zeiten, was für dieses Werkzeug richtig ist, aber `projects` erst ab
»Zeiterfasser 2« vollständig lesbar macht.

### Testzugang

`https://www.prosonata-demo.de` mit eigener APP-ID und eigenem API-Key. Die Demo wird
**täglich zurückgesetzt**, beide Werte müssen danach neu gesetzt werden – dafür gibt es einen
Befehl (`prosonata init --demo` oder gleichwertig), damit das kein Handgriff in einer
JSON-Datei ist.

**Die Zugangsdaten gehören nicht ins Repo**, auch nicht die der Demo. Sie liegen wie alle
anderen in `~/.prosonata/config.json` mit Dateirechten 0600. Ein öffentliches Repo mit einem
eingecheckten Key ist genau der Fehler, den Abschnitt 10 ausschliesst.

Der Demo-Zugang ist die Grundlage für Tests gegen die echte API. `core` wird zusätzlich gegen
einen Fake-Client getestet, damit die Testsuite ohne Netz und ohne tägliche Neueinrichtung
läuft.

---

## 10. Veröffentlichbar bleiben

Das Repo ist öffentlich. Eine Marketplace-Extension ist **nicht beschlossen** – aber sie soll
möglich bleiben, ohne dass vorher etwas entwirrt werden muss.

Der Unterschied ist gering und lohnt sich: Diese Anforderungen laufend einzuhalten kostet
während der Entwicklung fast nichts. Sie nachträglich einzuziehen wäre ein Umbau, und zwar
genau an den Stellen, die man am wenigsten anfassen will – Konfiguration, Fehlerbehandlung,
Sprache der Oberfläche.

Zwei Dinge gelten deshalb **unabhängig** von einer Veröffentlichung, allein weil das Repo
öffentlich ist: keine Kontodaten darin, und eine Lizenz. Der Rest ist Vorsorge:

- **Keine Kontodaten im Repo.** Subdomain, API-Key, Projekt-IDs und Kategorie-IDs stammen
  ausschliesslich aus Konfiguration. Keine Fixtures mit Kundennamen.
- **Semantische Eigenheiten konfigurierbar halten.** Trailer-Schlüsselwort, `LAUFEND`-Präfix,
  Hauptbranch, Zeitraster, Modus pro Branch, `detail`-Grenze, Datumssemantik (Fertigstellung
  vs. Beginn), Fallback auf das Subject. Was für den eigenen Workflow richtig ist, muss für
  andere abschaltbar sein. Der Modus-Umschalter ist dafür der wichtigste Hebel: wer lieber
  pro Commit abrechnet, stellt ihn um, statt das Werkzeug zu meiden.
  Die **`detail`-Grenze** muss konfigurierbar sein, weil ProSonata sie je Konto anhebt und
  die API sie nicht verrät – Default 200 wie dokumentiert, im eigenen Konto 800.
- **Englisch** für Code, Bezeichner und Kommentare. **Deutsch für alles Sichtbare**: Namen
  der Befehle, Panel, Dialoge, Meldungen der CLI, README und Changelog. ProSonata ist ein
  deutsches Produkt, seine Fachbegriffe sind es auch; eine englische Oberfläche darüber wäre
  eine Übersetzungsschicht, die niemand braucht. Fehlertexte aus `core`, die den Benutzer
  erreichen, zählen zur Oberfläche.
- **MIT-Lizenz** von Anfang an, `README.md` und `CHANGELOG.md` mitführen.
- **Fehlerbehandlung sichtbar machen.** Andere Accounts haben andere Pakete, Rechtestufen und
  Limits. HTTP 429 und 403 gehören abgefangen und verständlich gemeldet, nicht verschluckt.
- **`core` ohne VS-Code-Abhängigkeit** ist auch hier der Hebel: die CLI ist für Fremde
  unabhängig von der Extension nutzbar.

ProSonata bietet in der API-Dokumentation an, Anbindungen auf der Website zu listen und in den
News zu erwähnen. Das setzt eine Veröffentlichung voraus und ist deshalb offen.

**Was fehlt, falls doch veröffentlicht wird:** ein Publisher bei Azure DevOps – der Name in
`package.json` ist bis dahin ein Platzhalter und muss dem registrierten entsprechen. Und ein
Hinweis, dass dies **kein offizielles ProSonata-Produkt** ist; das Repo trägt aus demselben
Grund weder deren Namen noch deren Logo.

---

## 11. Verworfene Alternativen

Nicht erneut vorschlagen:

- **Aktivitäts-Watcher / Idle-Erkennung** als Buchungsgrundlage (Dateisystem,
  Editor-Heartbeat). Start und Pause geschehen bewusst von Hand, Dateisystem-Aktivität ist
  ohnehin nicht deckungsgleich mit abrechenbarer Zeit. Die Warnungen aus Abschnitt 3 sind kein
  Widerspruch: sie melden, sie buchen nicht.
- **Automatischer Timer-Start** durch `post-checkout`, `post-merge`, Editor-Öffnen oder
  Branch-Wechsel.
- **Manuelles Beenden eines Timers.** Ein Timer kennt Start und Pause. Abgeschlossen werden
  Zeiteinträge, nicht Timer.
- **Versand beim Push (`pre-push`).** Bindet an ein Remote, versagt bei tagelanger lokaler
  Arbeit, und ein Rebase mit Force-Push lässt sämtliche Zuordnungen eines Branches verwaisen.
- **Sofortversand im Hook** und ebenso eine **dauerhafte Sende-Queue**. Der aufgeschobene
  Versand ist keins von beidem: er hält ausstehende Schreibzugriffe im ohnehin vorhandenen
  Zustand, nicht in einem eigenen, rechnergebundenen Kanal.
- **Ein Zeiteintrag pro Tag** oder **pro Commit** als allgemeine Regel. Der Branch ist die
  Klammer; pro Commit gilt nur auf dem Hauptbranch.
- **Zeiten im Repo speichern**, weder als committete Datei noch als `git notes`. Die Datei
  läge im **Kundenrepo** und zeigte dem Kunden den Aufwand pro Commit; ausserdem müsste ein
  `pre-commit`-Hook sie in den Commit hineinschreiben. `log.jsonl` bleibt lokal.
- **GitHub Action zum Erzeugen der Zeiteinträge.** Ein Runner kennt die Dauer nicht – sie
  liegt nur in `state.json`. Sie in die Commit-Message zu schreiben, würde in einem
  öffentlichen Repo den Aufwand pro Kundenarbeit veröffentlichen.
- **Monorepo mit npm-Workspaces**, vorerst. Ein Paket mit drei Einstiegspunkten leistet
  dieselbe Trennung.
- **ProSonata-Aufgaben / `linkedTaskID`.** Die Gruppierung von Rechnungspositionen nach Feature
  lässt sich in ProSonatas Rechnungen nicht abbilden – deshalb ist der Branch die Klammer.
  Keine Task-Anlage, keine Task-Zuordnung, kein `linkedTaskID` im POST/PUT.
- **Branch → Projekt-Mapping.** Granularitäten passen nicht: viele kurzlebige Branches, ein
  langlebiges Projekt. Der Branch bestimmt den Zeiteintrag, nicht das Projekt.
- **Eigenes Review-Frontend.** Die Texte entstehen im Commit, die Zeiteinträge stehen in
  ProSonata und sind dort editierbar. Die ProSonata-Oberfläche ist das Review.
- **Sync von `state.json` über iCloud/Dropbox.** Latenz in Minuten, atomares `rename` überlebt
  keine Sync-Engine, gleichzeitige Schreiber. Kaputte Konstruktion.
- **Addition statt absoluter Summe.** Nicht idempotent, Retry verdoppelt, Rundungsdrift,
  erfordert Read-Modify-Write.
- **Polling** des ProSonata-Zustands.
- **DDEV.**

---

## 12. Offene Punkte

1. **Timer-API.** Anfrage an ProSonata ist gestellt, Antwort steht aus. Gefragt ist nach
   Endpunkten für Start/Pause/Beenden und danach, ob der Stop-Endpunkt eine korrigierte
   Endzeit entgegennimmt. Parallele Timer und Pause/Resume sind laut UI vorhanden. Bis zur
   Antwort ändert sich nichts – die Emulation bleibt.
2. **Wenn die Timer-API kommt, ist alles aus Abschnitt 9 erneut zu prüfen.** Die gemessenen
   Eigenschaften – Ersetzen statt Addieren, Typen der Felder, stillschweigendes Kürzen –
   gelten für `projecttimes`. Für Timer-Endpunkte muss nichts davon gelten.
3. **Erkennung geschlossener Pull Requests über die GitHub-API** – zurückgestellt, nicht
   verworfen. Wäre eindeutig statt indirekt, bindet das Werkzeug aber an einen Hoster und
   braucht einen Token. Hervorholen, falls das Prune-Signal (Abschnitt 3) in der Praxis nicht
   trägt – etwa weil Branches nach dem Merge nicht gelöscht werden.
4. **Schwellwerte der Warnungen** (Abschnitt 3) und des Signals „Zeiteintrag ruht" – aus der
   Praxis festzulegen, nicht vorab zu erfinden.
5. **Gleichzeitiges Buchen von zwei Rechnern derselben Person auf denselben Branch** ist nicht
   abgedeckt. Die Regel „fremd + eigen" setzt voraus, dass immer nur einer schreibt. Laufen
   zwei Timer parallel, überholen sich die Schreibzugriffe und der Wert ist zeitweise zu
   niedrig. Bekannte Grenze, kein Fehler – erst lösen, wenn der Fall eintritt. Zwei
   **Personen** am selben Branch sind dagegen abgedeckt: Die Suche filtert auf
   `userID=myself`, jede führt ihren eigenen Zeiteintrag (Abschnitt 3).

---

## 13. Umsetzungsreihenfolge

1. Gerüst, `core` mit Zustandsverwaltung, Segmenten und Zeiteinträgen
2. API-Client und aufgeschobener Versand
3. CLI: `prosonata init` / `start` / `pause` / `status`
4. `post-commit`-Hook: Segmentschnitt, Trailer-Extraktion, Zeiteintrag nach Branch
5. Extension: Statusleiste, `FileSystemWatcher`, Abschluss und Textänderung
6. Panel in der Seitenleiste: Projekt, Zeitraster, Branch-Modus, offene Zeiteinträge
7. Branch-Scope und HEAD-Beobachtung, Warnungen bei Fehlbedienung
8. Mehrere Rechner: Kennung im Marker, `sync()`, Summe als fremd + eigen
9. README, Konfigurierbarkeit, Fehlerbehandlung für fremde Accounts
