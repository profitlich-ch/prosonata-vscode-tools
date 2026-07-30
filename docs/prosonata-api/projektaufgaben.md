# API Ressource: Projektaufgaben | ProSonata Agentursoftware
Folgende HTTP-Methoden stehen für Projektaufgaben zur Verfügung:

*   GET: Ressource lesen
*   [POST: Ressource erstellen](https://www.prosonata.de/infos-und-hilfen/api/api-projektaufgaben.html#post)
*   [PUT: Ressource bearbeiten](https://www.prosonata.de/infos-und-hilfen/api/api-projektaufgaben.html#put)
*   [DELETE: Ressource löschen](https://www.prosonata.de/infos-und-hilfen/api/api-projektaufgaben.html#delete)

Zugriff für **alle Benutzergruppen**.  
**Alle Benutzer** können **Projektaufgaben erstellen/bearbeiten**.  
Nur Benutzer ab der Gruppe **Teamleiter** können **Projektaufgaben aller Benutzer** löschen.  
**Alle Benutzer** können ihre **eigenen Projektaufgaben** löschen.

alle Projektaufgaben auflisten
------------------------------

```
GET /api/v1/projecttasks
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 564,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 436,
    "apiLimitReset": 513
  },
  "data": [
    {
      "taskID": 13,
      "taskName": "Layout erstellen",
      "taskInfo": "<p>weitere Infos zur Aufgabe</p>",
      "projectID": 48,
      "projectNo": "19-12-001",
      "projectName": "Kundenmailing",
      "customerID": 12,
      "customerName": "Versandmode Becker",
      "userID": 7,
      "username": "Designer1",
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
GET /api/v1/projecttasks?projectID=45&userID=3&done=0
```




* Parameter: projectID
  * Beschreibung: ID eines Projekts
* Parameter: projectNo
  * Beschreibung: Projektnummer
* Parameter: projectName
  * Beschreibung: Bezeichnung eines Projekts
* Parameter: customerID
  * Beschreibung: ID einer Firma/Gruppe
* Parameter: customerName
  * Beschreibung: Bezeichnung einer Firma/Gruppe
* Parameter: userID
  * Beschreibung: ID eines BenutzersSonderwert: String »myself« für Zeiten des anfragenden Benutzeraccountsdurch Ergänzung des Parameters »additionalUser=true« werden auch Aufgaben berücksichtigt, bei denen der Benutzer Zuarbeiter ist
* Parameter: username
  * Beschreibung: Benutzername
* Parameter: taskName
  * Beschreibung: Aufgabe
* Parameter: taskDateStart
  * Beschreibung: Startdatum der Aufgabedurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: taskDateEnd
  * Beschreibung: Enddatum der Aufgabedurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: recurringTask
  * Beschreibung: wiederkehrende Aufgabe0 = keine Wiederholung1 = wöchentlich2 = 2-wöchentlich3 = monatlich4 = 2-monatlich5 = quartalsweise6 = halbjährlich
* Parameter: taskTimeCategory
  * Beschreibung: ID der Zeitkategorie
* Parameter: taskPrio
  * Beschreibung: Priorität der Aufgabe0 = ohne1 = niedrig5 = mittel9 = hoch
* Parameter: type
  * Beschreibung: Typ des Eintrags0 = Aufgabe1 = Meilenstein
* Parameter: read
  * Beschreibung: Aufgabe ist gelesen0 = nein1 = ja
* Parameter: done
  * Beschreibung: Aufgabe ist erledigt0 = nein1 = ja


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

taskID, projectID, customerID, userID, taskDateStart, taskDateEnd, taskOrder, taskPrio, type, read, done

eine Projektaufgabe aufrufen
----------------------------

```
GET /api/v1/projecttasks/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 186,
    "apiLimitReset": 403
  },
  "data": {
    "taskID": 304,
    "taskName": "erstes Layout vorbereiten",
    "taskInfo": "",
    "projectID": 122,
    "projectNo": "19-16-004",
    "projectName": "Gestaltung der Webseite",
    "customerID": 16,
    "customerName": "Maler Maier",
    "userID": 1,
    "username": "Admin1",
    "taskDateStart": null,
    "taskTimeStart": null,
    "taskDateEnd": null,
    "taskTimeEnd": null,
    "timePlanned": 3,
    "recurringTask": 0,
    "recurringTaskDateEnd": null,
    "taskOrder": 7,
    "taskTimeCategory": null,
    "categoryName": null,
    "taskPrio": 9,
    "type": 0,
    "read": 1,
    "donePercentage": 0,
    "done": 0,
    "doneMailToUserID": null,
    "changedInfoToUser": 0,
    "changedInfoToCreator": 0,
    "createdByUserID": 1,
    "taskCreationDate": "2019-03-11 17:19:03",
    "editedByUserID": 1,
    "taskEditDate": "2019-03-11 17:19:14",
    "linkedExtCostID": null,
    "taskViaApi": 0
  }
}
```


eine Projektaufgabe erstellen
-----------------------------

```
POST /api/v1/projecttasks
```


Notwendige und mögliche Parameter im Body:



* Parameter: taskName
  * Beschreibung: Bezeichnung der Aufgabe
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: taskInfo
  * Beschreibung: erweiterte Infos zur AufgabeEingabe mit html Tags(max. 5.000 Zeichen)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: projectID
  * Beschreibung: ID des Projekts
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: userID
  * Beschreibung: ID des Benutzers
  * Typ: Int
  * Default-Wert: ID des anfragenden Benutzers
  * Pflichtfeld:  
* Parameter: taskDateStart
  * Beschreibung: Datum Beginn der Aufgabe
  * Typ: Date
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: taskTimeStart
  * Beschreibung: Uhrzeit des Startdatums
  * Typ: Time
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: taskDateEnd
  * Beschreibung: Datum Ende der Aufgabe
  * Typ: Date
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: taskTimeEnd
  * Beschreibung: Uhrzeit des Enddatums
  * Typ: Time
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: timePlanned
  * Beschreibung: geplante Zeit der Aufgabe
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: recurringTask
  * Beschreibung: wiederkehrende Aufgabe0 = keine Wiederholung1 = wöchentlich2 = 2-wöchentlich3 = monatlich4 = 2-monatlich5 = quartalsweise6 = halbjährlich
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: recurringTaskDateEnd
  * Beschreibung: Datum Ende der Wiederholungen
  * Typ: Date
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: taskTimeCategory
  * Beschreibung: Zeitkategorie der Aufgabe
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: taskPrio
  * Beschreibung: Priorität der Aufgabe0 = keine Prio1 = niedrige Prio5 = mittlere Prio9 = hohe Prio
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: type
  * Beschreibung: Typ der Aufgabe0 = Aufgabe1 = Meilenstein
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: read
  * Beschreibung: Aufgabe gelesen0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: onTodayList
  * Beschreibung: Aufgabe ist auf »To-do-Liste« (Board-Spalte)0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: onFreeBoardColumn
  * Beschreibung: Aufgabe ist auf frei benannter Board-Spalte(Name der Spalte)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: donePercentage
  * Beschreibung: Aufgabe zu % erledigt0 bis 100
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: done
  * Beschreibung: Aufgabe ist erledigt0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: doneMailToUserID
  * Beschreibung: erledigt E-Mail an Benutzer mit der ID
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: changedInfoToUser
  * Beschreibung: Änderungen E-Mail an Mitarbeiter0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: changedInfoToCreator
  * Beschreibung: Änderungen E-Mail an Aufgabenersteller0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: additionalUsers
  * Beschreibung: Zuarbeiter (Benutzer) speichern(ein Array der userID(s) kann übergeben werden)
  * Typ: Array
  * Default-Wert: []leeres Array
  * Pflichtfeld:  


Angabe von Dezimalwerten mit Punkt als Trennzeichen.

Beispiel:

```
{
    "taskName": "eine Aufgabe zum Projekt",
    "taskInfo": "<p>hier steht eine erweiterte Beschreibung</p>",
    "projectID": 122,
    "userID": 3,
    "taskDateStart": "16.04.2019",
    "taskDateEnd": "20.04.2019",
    "timePlanned": 3.75,
    "taskPrio": 9,
    "additionalUsers": [
      {
        "userID": 2
      },
      {
        "userID": 6
      }
    ]
}
```


eine Projektaufgabe bearbeiten
------------------------------

```
PUT /api/v1/projecttasks/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Es stehen die Parameter zum Erstellen der Ressource zur Verfügung (s.o.).

Ergänzend stehen weitere Parameter zur Verfügung:


|Parameter     |Beschreibung                               |Typ|
|--------------|-------------------------------------------|---|
|read          |gelesen0 = nein1 = ja                      |Int|
|donePercentage|erledigt (Prozent)Werte: 0, 25, 50, 75, 100|Int|
|done          |erledigt0 = nein1 = ja                     |Int|


eine Projektaufgabe löschen
---------------------------

```
DELETE /api/v1/projecttasks/{id}
```


Es müssen keine weiteren Parameter übergeben werden.