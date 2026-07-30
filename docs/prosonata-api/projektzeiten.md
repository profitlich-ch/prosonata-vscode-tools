# API Ressource: Projektzeiten | ProSonata Agentursoftware
Folgende HTTP-Methoden stehen für Projektzeiten zur Verfügung:

*   GET: Ressource lesen
*   [POST: Ressource erstellen](https://www.prosonata.de/infos-und-hilfen/api/api-projektzeiten.html#post)
*   [PUT: Ressource bearbeiten](https://www.prosonata.de/infos-und-hilfen/api/api-projektzeiten.html#put)
*   [DELETE: Ressource löschen](https://www.prosonata.de/infos-und-hilfen/api/api-projektzeiten.html#delete)

Zugriff für **alle Benutzergruppen**.  
Benutzer bis **Zeiterfasser 1** erhalten nur ihre **eigenen Projektzeiten**.  
Nur **Administratoren** können **Projektzeiten aller Benutzer** erstellen/bearbeiten/löschen.  
**Alle Benutzer** können ihre **eigenen Projektzeiten** erstellen/bearbeiten/löschen.

alle Projektzeiten auflisten
----------------------------

```
GET /api/v1/projecttimes
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 2432,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 476,
    "apiLimitReset": 656
  },
  "data": [
    {
      "timeID": 1,
      "category": 11,
      "categoryName": "Konzeption",
      "date": "2012-01-04",
      "detail": "Besprechung Job",
      "workingTime": 0.5,
      "projectID": 45,
      "projectNo": "12-11-001",
      "projectName": "Frühstücks-Flyer",
      "customerID": 11,
      "customerName": "Bäckerei Back",
      "userID": 1,
      "username": "Admin1",
      ...
    },
    ...
  ]
}
```


Filterung/Suche
---------------

Über Parameter kann gefiltert werden:

```
GET /api/v1/projecttimes?projectID=45
```




* Parameter: category
  * Beschreibung: ID der Zeitkategorie
* Parameter: categoryName
  * Beschreibung: Bezeichnung der Kategorie
* Parameter: date
  * Beschreibung: Datum des Zeiteintragsdurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: date2
  * Beschreibung: zweite Datumsangabe, um die Suchanfrage weiter einzuschränkendurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: detail
  * Beschreibung: Details/Beschreibung
* Parameter: projectID
  * Beschreibung: ID eines Projekts
* Parameter: projectNo
  * Beschreibung: Projektnummer
* Parameter: projectName
  * Beschreibung: Bezeichnung eines Projekts
* Parameter: customerID
  * Beschreibung: ID einer Firma/Gruppe
* Parameter: userID
  * Beschreibung: ID eines BenutzersSonderwert: String »myself« für Zeiten des anfragenden Benutzeraccounts
* Parameter: username
  * Beschreibung: Benutzername
* Parameter: linkedTaskID
  * Beschreibung: ID einer verlinkten Aufgabe
* Parameter: notInvoiceable
  * Beschreibung: nicht berechenbar0 = nein1 = ja
* Parameter: isInvoiced
  * Beschreibung: Zeiteintrag ist berechnet0 = nein1 = ja


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

timeID, category, date, projectID, customerID, userID, notInvoiceable, isInvoiced

eine Projektzeit aufrufen
-------------------------

```
GET /api/v1/projecttimes/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 456,
    "apiLimitReset": 546
  },
  "data": {
    "timeID": 449,
    "category": 15,
    "categoryName": "Workshop",
    "date": "2019-03-02",
    "detail": "Meeting beim Kunden",
    "workingTime": 1.25,
    "projectID": 189,
    "projectNo": "19-14-001",
    "projectName": "ZX Produktbroschüre",
    "customerID": 14,
    "customerName": "ZX Testfirma",
    "userID": 3,
    "username": "Admin2",
    "linkedTaskID": null,
    "notInvoiceable": 0,
    "isInvoiced": 0,
    "creationDate": "2019-03-02 10:40:12",
    "workingTimeStart": null,
    "workingTimeEnd": null,
    "freeTimeInput": 0,
    "timeViaApi": 0
  }
}
```


eine Projektzeit erstellen
--------------------------

```
POST /api/v1/projecttimes
```


Notwendige und mögliche Parameter im Body:



* Parameter: category
  * Beschreibung: ID der Zeitkategorie
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: date
  * Beschreibung: Datum des Zeiteintrags
  * Typ: Date
  * Default-Wert: aktueller Tag
  * Pflichtfeld:  
* Parameter: detail
  * Beschreibung: Details/Beschreibung(max. 200 Zeichen)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: workingTime
  * Beschreibung: Projektzeit in Stunden
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: projectID
  * Beschreibung: ID des Projekts
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: userID
  * Beschreibung: ID des Benutzers(nur Administratoren können Zeiten für andere Benutzer erfassen!)
  * Typ:  
  * Default-Wert: ID des anfragenden Benutzers
  * Pflichtfeld:  
* Parameter: linkedTaskID
  * Beschreibung: ID einer verknüpften Aufgabe
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: notInvoiceable
  * Beschreibung: Zeit ist nicht berechenbar0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: isInvoiced
  * Beschreibung: Zeit ist berechnet0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: workingTimeStart
  * Beschreibung: Startzeitpunkt der Bearbeitung
  * Typ: Time
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: workingTimeEnd
  * Beschreibung: Endzeitpunkt der Bearbeitung
  * Typ: Time
  * Default-Wert: null
  * Pflichtfeld:  


Angabe von Dezimalwerten mit Punkt als Trennzeichen.

Beispiel:

```
{
    "category": 15,
    "date": "2019-03-02",
    "detail": "Layout der Broschüre angefangen",
    "workingTime": 1.25,
    "projectID": 89,
    "userID": 3
}
```


eine Projektzeit bearbeiten
---------------------------

```
PUT /api/v1/projecttimes/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Es stehen die Parameter zum Erstellen der Ressource zur Verfügung (s.o.).

eine Projektzeit löschen
------------------------

```
DELETE /api/v1/projecttimes/{id}
```


Es müssen keine weiteren Parameter übergeben werden.