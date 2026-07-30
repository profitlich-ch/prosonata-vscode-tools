# ProSonata API – Bruno-Sammlung

Zwei Teile, bewusst getrennt:

- **`grundlagen/`, `projects/`, `projecttimecategories/`, `projecttimes/`** bilden die
  Dokumentation in [../docs/prosonata-api/](../docs/prosonata-api/) ab. Neutral, ohne
  Annahmen aus unserem Konzept, mit allen dokumentierten Filtern als abgeschaltete
  Parameter.
- **`zeiterfassung/`** enthält, was nur wegen dieses Projekts existiert: die Anfragen so,
  wie die Extension sie stellt, und die Prüfungen der Annahmen aus
  [../KONZEPT.md](../KONZEPT.md).

## Zuordnung zur Dokumentation

Bruno kennt keinen Mechanismus, um Markdown-Dateien mit Anfragen zu verknüpfen – importieren
kann es OpenAPI, Postman und Insomnia, aber kein Markdown. Die Verbindung wird deshalb über
`docs`-Blöcke hergestellt, die Bruno auf drei Ebenen kennt: Sammlung, Ordner und Anfrage.
Jeder Ordner trägt eine `folder.bru`, die ihre Quelle nennt:

| Ordner | Quelldatei | Methoden laut Doku |
|---|---|---|
| `grundlagen/` | `grundlagen.md` | – |
| `projects/` | `projekte.md` | GET, POST, PUT |
| `projecttimecategories/` | `projektkategorien.md` | GET |
| `projecttimes/` | `projektzeiten.md` | GET, POST, PUT, DELETE |
| `quotations/` | `angebote.md` | GET |
| `crmevents/` | `crm.md` | GET, POST, PUT, DELETE |
| `externalcosts/` | `fremdkosten.md` | GET, POST, PUT |
| `addresses/` | `kontakte-adressen.md` | GET, POST, PUT |
| `contacts/` | `kontakte-ansprechpartner.md` | GET, POST, PUT |
| `customers/` | `kontakte-firmen.md` | GET, POST, PUT |
| `servicetemplates/` | `leistungsvorlagen.md` | GET, POST, PUT, DELETE |
| `projecttasks/` | `projektaufgaben.md` | GET, POST, PUT, DELETE |
| `invoices/` | `rechnungen.md` | GET, nur Einzelabruf |
| `zeiterfassung/` | `../KONZEPT.md` | – |

Alle Quelldateien liegen unter `docs/prosonata-api/`. Vollständig abgebildet ist jede
dokumentierte Methode; die gefilterten Listen führen jeden dokumentierten Filter als
abgeschalteten Parameter.

**Schreibende Anfragen ausserhalb von `projecttimes` sind mit „SCHREIBT" im Namen
markiert.** Sie ändern echte Daten – Kunden, Adressen, Ansprechpartner, Fremdkosten,
CRM-Ereignisse. Bei `externalcosts`, `addresses`, `contacts` und `customers` ist zudem
**kein DELETE dokumentiert**: Was dort entsteht, lässt sich über die API nicht wieder
entfernen, nur in ProSonata selbst. Das Werkzeug benutzt keine dieser Ressourcen.

In Bruno ist der Text über den Reiter **Docs** des jeweiligen Ordners sichtbar. Dort stehen
auch die Befunde vom Live-Konto, die von der Dokumentation abweichen oder über sie
hinausgehen.

**Nicht abgebildet** sind die übrigen Ressourcen, deren Dokumentation unter
`docs/prosonata-api/` liegt – Angebote, CRM, Fremdkosten, Kontakte, Leistungsvorlagen,
Projektaufgaben und Rechnungen. Das Werkzeug benutzt sie nicht; Projektaufgaben sind in
KONZEPT.md §11 ausdrücklich verworfen.

**Auf `projects` wird ausschliesslich lesend zugegriffen.** Die API erlaubt POST und PUT,
aber das Werkzeug legt keine Projekte an und ändert keine – und diese Sammlung tut es auch
nicht. Geschrieben wird nur auf `projecttimes`, und jeder dabei erzeugte Eintrag lässt sich
mit `projecttimes/06 Löschen` wieder entfernen.

## Einrichtung

```
cp .env.example .env
```

`.env` ausfüllen und in Bruno oben rechts die Umgebung **demo** wählen. In Bruno selbst ist
nichts einzutragen – die Umgebung liest alle Werte über `process.env` aus dieser Datei.
Bruno liest sie beim Laden der Sammlung; nach einer Änderung die Sammlung neu laden.

Die Datei ist über die `.gitignore` des Repos ausgeschlossen. Das Repo ist öffentlich, und
KONZEPT.md §10 verlangt, dass keine Kontodaten darin liegen.

## Reihenfolge beim ersten Durchlauf

1. `projects/01 Liste` – muss laufen, sonst stimmt etwas an Basis-URL oder Zugangsdaten
   nicht. Aus der Antwort `projectID` und `customerID` in die `.env` übernehmen, dazu ein
   zweites Projekt als `PROJECT_ID_ALT`.
2. `projecttimecategories/01 Liste` – eine `category`-ID in die `.env`.
3. `grundlagen/04 Fehlerfall` – zeigt in `meta`, als welcher Benutzer die Zugangsdaten
   auftreten. Beantwortet einen Teil von `zeiterfassung/07`, ohne etwas zu schreiben.
4. `zeiterfassung/01` und `02` – die beiden Listen, wie die Extension sie holt.
5. `zeiterfassung/03` – legt den Testeintrag mit Marker an, setzt `createdId`.
6. `zeiterfassung/04` bis `08`.
7. `projecttimes/06 Löschen` – **immer**. Für die Einträge aus `zeiterfassung/06` und `08`
   mit `overlongId` bzw. `dateTestId` wiederholen.

## Eine Ausnahme von der Vollständigkeit

Bei `projects` sind POST und PUT **bewusst nicht** abgebildet, obwohl dokumentiert. Ein per
API angelegtes Projekt liesse sich nicht wieder entfernen – die Ressource kennt kein DELETE
–, und das Werkzeug greift auf Projekte ohnehin nur lesend zu.

## Die offenen Fragen

| # | Frage | Anfrage |
|---|---|---|
| 1 | Sucht der `detail`-Filter als Teilstring oder exakt? | `zeiterfassung/04` |
| 2 | Ersetzt oder addiert ein PUT `workingTime`? | `zeiterfassung/05` |
| 3 | `detail` über 200 Zeichen – Fehler oder stilles Kürzen? | `zeiterfassung/06` |
| 4 | Welchem Benutzer gehört ein per App-Integration erzeugter Eintrag? | `zeiterfassung/07` |
| 5 | Welches Datumsformat gilt – die Doku widerspricht sich | `zeiterfassung/08` |
| 6 | Bleiben eckige Klammern im `detail` erhalten? | fällt bei `zeiterfassung/04` mit ab |
| 7 | Liefert `linkedCustomerID` auch die allgemeinen Kategorien? | `zeiterfassung/02` |

## Was die Dokumentation bereits klärt

Antwortumschlag `{ meta, data }`; die ID heisst `timeID`; POST liefert 201 mit dem
vollständigen Objekt, PUT und DELETE liefern 200; ein PUT braucht nicht alle Parameter;
Pflicht beim Anlegen sind nur `category` und `projectID`; `detail` fasst 200 Zeichen;
Kategorien sind global und über `linkedCustomerID` an Kunden gebunden, nicht an Projekte;
Listen sind über `perPage` und `page` paginiert; jede Antwort trägt `apiLimitRemaining`
und `apiLimitReset`.
