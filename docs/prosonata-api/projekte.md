# API Ressource: Projekte | ProSonata Agentursoftware
Folgende HTTP-Methoden stehen für Projekte zur Verfügung:

*   GET: Ressource lesen
*   [POST: Ressource erstellen](https://www.prosonata.de/infos-und-hilfen/api/api-projekte.html#post)
*   [PUT: Ressource bearbeiten](https://www.prosonata.de/infos-und-hilfen/api/api-projekte.html#put)

Zugriff ab Benutzergruppe **Zeiterfasser 2**.  
Lesender Zugriff auf »meine Projekte« für Benutzergruppen bis **Zeiterfasser 1**.

alle Projekte auflisten
-----------------------

```
GET /api/v1/projects
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 64,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 498,
    "apiLimitReset": 883
  },
  "data": [
    {
      "projectID": 1,
      "projectNo": "19-12-001",
      "projectName": "Kundenmailing",
      "customerID": 12,
      "customerName": "Versandmode Becker",
      "contactID": 53,
      "firstName": "Christiane",
      "lastName": "Maier",
      "projectDate": "2019-01-18",
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
GET /api/v1/projects?projectName=Testprojekt
```




* Parameter: projectNo
  * Beschreibung: Projektnummer
* Parameter: projectName
  * Beschreibung: Bezeichnung des Projekts
* Parameter: customerID
  * Beschreibung: ID des Kunden (Firma/Gruppe)
* Parameter: customerName
  * Beschreibung: Bezeichnung des Kunden (Firma/Gruppe)
* Parameter: contactID
  * Beschreibung: ID des Kunden Ansprechpartners
* Parameter: lastName
  * Beschreibung: Nachname des Kunden Ansprechpartners
* Parameter: userID
  * Beschreibung: zugeordnete Projekte des Benutzers mit der ID,Sonderwert: String »myself« für Projekte des anfragenden Benutzeraccounts
* Parameter: projectStatus
  * Beschreibung: Status des Projekts:0 = offen1 = in Abrechnung2 = abgeschlossen3 = abgebrochen4 = bereit zur Abrechnung
* Parameter: financeStatus
  * Beschreibung: Faktura-Status des Projekts:0 = kein Angebot/Rechnung1 = Angebot2 = Rechnung3 = 1. Mahnung4 = 2. Mahnung5 = 3. Mahnung
* Parameter: activeStatus
  * Beschreibung: Aktiv-Status des Projekts (offenes Projekt »ruht«):0 = inaktiv1 = aktiv
* Parameter: projectDate
  * Beschreibung: Datum des Projektsdurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: projectDateEnd
  * Beschreibung: Enddatum des Projektsdurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: projectQuickInfo
  * Beschreibung: Kurzinfo zum Projekt
* Parameter: projectTags
  * Beschreibung: Tags des Projekts
* Parameter: internalDepartment
  * Beschreibung: interne Abteilung (0 bis 9)
* Parameter: recurringProject
  * Beschreibung: wiederkehrendes Projekt:0 = nicht wiederkehrend1 = monatlich2 = zweimonatlich3 = quartalsweise4 = halbjährlich5 = jährlich6 = zweijährlich
* Parameter: userResponsibleID
  * Beschreibung: ID des verantwortlichen Benutzers


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

projectID, projectName, customerID, customerName, contactID, lastName, projectDate, projectDateEnd, projectStatus, timeNeeded

ein Projekt aufrufen
--------------------

```
GET /api/v1/projects/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 491,
    "apiLimitReset": 493
  },
  "data": {
    "projectID": 45,
    "projectNo": "19-11-001",
    "projectName": "Frühstücks-Flyer",
    "customerID": 11,
    "customerName": "Bäckerei Back",
    "contactID": 50,
    "firstName": "Hans",
    "lastName": "Back",
    "projectDate": "2019-01-13",
    "projectDateEnd": null,
    "recurringProject": 0,
    "createdByUserID": 4,
    "userResponsibleID": null,
    "projectStatus": 1,
    "financeStatus": 3,
    "activeStatus": 1,
    "projectInfo": "",
    "projectQuickInfo": "",
    "projectTags": "",
    "projectLinks": [
      {
        "name": "Testlink Website",
        "url": "https://www.baeckerei-back-test.de"
      },
      {
        "name": "ProSonata",
        "url": "https://www.prosonata.de"
      }
   ],
    "timePlanned": 20,
    "timeNeeded": 15.25,
    "projectCostRate": null,
    "internalDepartment": 0,
    "projectGroupID": null,
    "isProjectTemplate": 0,
    "usersAssigned": [
      {
        "userID": 2,
        "username": "Designer2",
        "userFirstName": "",
        "userLastName": ""
      },
      {
        "userID": 3,
        "username": "Admin2",
        "userFirstName": "Max",
        "userLastName": "Mustermann"
      }
    ]
  }
}
```


ein Projekt erstellen
---------------------

```
POST /api/v1/projects
```


Die Projektnummer (projectNo) wird beim Anlegen automatisch generiert!

Notwendige und mögliche Parameter im Body:



* Parameter: projectName
  * Beschreibung: Bezeichnung des Projekts
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: customerID
  * Beschreibung: ID des Kunden (Firma/Gruppe)
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: contactID
  * Beschreibung: ID des Kunden Ansprechpartners
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: activeStatus
  * Beschreibung: Aktiv-Status des Projekts:0 = inaktiv1 = aktiv
  * Typ: Int
  * Default-Wert: 1
  * Pflichtfeld:  
* Parameter: projectDate
  * Beschreibung: Datum Projektstart
  * Typ: Date
  * Default-Wert: aktueller Tag
  * Pflichtfeld:  
* Parameter: projectDateEnd
  * Beschreibung: Datum Projektende
  * Typ: Date
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: recurringProject
  * Beschreibung: wiederkehrendes Projekt:0 = nicht wiederkehrend1 = monatlich2 = zweimonatlich3 = quartalsweise4 = halbjährlich5 = jährlich6 = zweijährlich
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: userResponsibleID
  * Beschreibung: ID des verantwortlichen Benutzers
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: projectQuickInfo
  * Beschreibung: Kurzinfo zum Projekt
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: projectInfo
  * Beschreibung: erweiterte Infos zum Projekt
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: projectTags
  * Beschreibung: Tags (kommasepariert)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: projectLinks
  * Beschreibung: bis zu 5 Links pro ProjektLinks werden als Arrays übergeben:name: Bezeichnung des Linksurl: URL des Links (inkl. https)
  * Typ: Array
  * Default-Wert: []leeres Array
  * Pflichtfeld:  
* Parameter: timePlanned
  * Beschreibung: geplante Zeit (in Std.) für das Projekt
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: projectCostRate
  * Beschreibung: Stundensatz des Projekts
  * Typ: Dec
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: internalDepartment
  * Beschreibung: interne Abteilung (0 bis 9)
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: projectGroupID
  * Beschreibung: ID der zugeordneten Projektgruppe
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: isProjectTemplate
  * Beschreibung: Projekt als Vorlage markieren
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: usersAssigned
  * Beschreibung: zugeordnete Benutzer speichern(ein Array der userID(s) kann übergeben werden)
  * Typ: Array
  * Default-Wert: []leeres Array
  * Pflichtfeld:  


Angabe von Dezimalwerten mit Punkt als Trennzeichen.

Beispiel:

```
{
    "projectName": "Muster Projekt",
    "customerID": 10,
    "contactID": 49,
    "projectDateEnd": "25.06.2019",
    "userResponsibleID": 2,
    "projectInfo": "Hier stehen erweiterte Infos zum Projekt",
    "projectQuickInfo": "eine Kurzinfo zum Projekt",
    "projectLinks": [
      {
        "name": "ProSonata",
        "url": "https://www.prosonata.de"
      }
    ]
    "timePlanned": 20,
    "projectCostRate": 80.00,
    "internalDepartment": 2,
    "usersAssigned": [
      {
        "userID": 2
      },
      {
        "userID": 3
      }
    ]
}
```


ein Projekt bearbeiten
----------------------

```
PUT /api/v1/projects/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Ergänzend zum Erstellen der Ressource stehen weitere Parameter zur Verfügung:



* Parameter: projectNo
  * Beschreibung: Projektnummer
  * Typ: String
* Parameter: projectStatus
  * Beschreibung: Status des Projekts:0 = offen1 = in Abrechnung2 = abgeschlossen3 = abgebrochen4 = bereit zur Abrechnung
  * Typ: Int
* Parameter: financeStatus
  * Beschreibung: Faktura-Status des Projekts:0 = kein Angebot/Rechnung1 = Angebot2 = Rechnung3 = 1. Mahnung4 = 2. Mahnung5 = 3. Mahnung
  * Typ: Int
