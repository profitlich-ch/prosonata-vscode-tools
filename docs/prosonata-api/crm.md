# API Ressource: CRM | ProSonata Agentursoftware
ProSonata API

CRM Ereignisse
--------------

alle CRM Ereignisse auflisten
-----------------------------

```
GET /api/v1/crmevents
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 511,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 348,
    "apiLimitReset": 619
  },
  "data": [
    {
      "eventID": 4,
      "contactID": 102,
      "title": "Herr",
      "firstName": "Jan",
      "lastName": "Müller",
      "email": "jm@test.de",
      "telephone": "06123 1234567",
      "customerName": "Auto Müller",
      "name1": "Autohaus Müller GmbH",
      "name2": "",
      "name3": "",
      "street": "Bahnhofstraße",
      "streetNo": "7",
      "postalCode": "61231",
      "city": "Wiesbaden",
      "country": "",
      "createdByUserID": 1,
      "username": "Admin1",
      "showToUsergroup": null,
      "eventDate": "2022-06-05",
      "eventTime": "14:09:18",
      "eventNote": "<p>Hier stehen ausführliche Infos zum Ereignis</p>",
      "media": 0,
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
GET /api/v1/crmevents?contactID=4&eventDate=2022-06-04
```




* Parameter: contactID
  * Beschreibung: ID eines Ansprechpartners
* Parameter: firstName
  * Beschreibung: Vorname eines Ansprechpartners
* Parameter: lastName
  * Beschreibung: Nachname eines Ansprechpartners
* Parameter: customerID
  * Beschreibung: ID einer Firma/Gruppe
* Parameter: customerName
  * Beschreibung: Bezeichnung einer Firma/Gruppe
* Parameter: name1
  * Beschreibung: Firmierung 1 der Firmenadresse
* Parameter: name2
  * Beschreibung: Firmierung 2 der Firmenadresse
* Parameter: showToUsergroup
  * Beschreibung: auf Benutzergruppen beschränkte Ereignisse1 = Teamleiter und höher2 = Verwaltung und höher3 = Administratoren
* Parameter: eventDate
  * Beschreibung: Datum des Ereignissesdurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: media
  * Beschreibung: das Medium des Ereignisses0 = E-Mail1 = Telefon2 = Newsletter3 = Social Media10 = Brief11 = Mailing15 = Meeting20 = Sonstige
* Parameter: projectID
  * Beschreibung: ID eines Projekts
* Parameter: projectNo
  * Beschreibung: Projektnummer
* Parameter: projectName
  * Beschreibung: Bezeichnung eines Projekts
* Parameter: eventPrio
  * Beschreibung: Priorität eines Ereignisses5 = normal1 = niedrig9 = hoch
* Parameter: crmTags
  * Beschreibung: Tag eines Ereignisses
* Parameter: followUpDate
  * Beschreibung: Datum der Wiedervorlagedurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: followUpUser
  * Beschreibung: Wiedervorlagen für einen Benutzer (ID des Benutzers)Sonderwert: String »myself« für Wiedervorlagen des anfragenden Benutzeraccounts
* Parameter: followUpDone
  * Beschreibung: Wiedervorlage ist erledigt0 = nein1 = ja


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

eventID, contactID, eventDate, createdByUserID, eventPrio, followUpDate, followUpUser, followUpDone

ein CRM Ereignis aufrufen
-------------------------

```
GET /api/v1/crmevent/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 192,
    "apiLimitReset": 533
  },
  "data": {
    "eventID": 15,
    "contactID": 53,
    "title": "Frau",
    "firstName": "Christiane",
    "lastName": "Maier",
    "email": "c.maier@beckermode.de",
    "telephone": "01334 12345678",
    "customerID": 12,
    "customerName": "Versandmode Becker",
    "name1": "Versandmode Becker KG",
    "name2": "Your Fashion Today",
    "name3": "",
    "street": "Fabrikstraße",
    "streetNo": "65",
    "postalCode": "12345",
    "city": "Nähstadt",
    "country": "",
    "createdByUserID": 1,
    "username": "Admin1",
    "showToUsergroup": null,
    "eventDate": "2022-11-10",
    "eventTime": "09:46:41",
    "eventNote": "<p>Hier steht eine ausführliche Information zum Ereignis</p>",
    "media": 0,
    "projectID": null,
    "projectNo": null,
    "projectName": null,
    "eventPrio": 5,
    "crmTags": "",
    "followUpDate": null,
    "followUpTime": null,
    "followUpUser": null,
    "followUpUsername": "",
    "followUpNote": "",
    "followUpDone": 0,
    "eventViaApi": 0
  }
}
```


eine CRM Ereignis erstellen
---------------------------

```
POST /api/v1/crmevents
```


Notwendige und mögliche Parameter im Body:



* Parameter: contactID
  * Beschreibung: ID des Ansprechpartners
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: eventDate
  * Beschreibung: Datum des Ereignisses
  * Typ: Date
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: eventTime
  * Beschreibung: Uhrzeit des Ereignisses
  * Typ: Time
  * Default-Wert: 09:00:00
  * Pflichtfeld:  
* Parameter: showToUsergroup
  * Beschreibung: Ansicht auf Benutzergruppen beschränkt1 = Teamleiter und höher2 = Verwaltung und höher3 = Administratorennull = alle
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: media
  * Beschreibung: das Medium des Ereignisses0 = E-Mail1 = Telefon2 = Newsletter3 = Social Media10 = Brief11 = Mailing15 = Meeting20 = Sonstige
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: eventNote
  * Beschreibung: Notiz/Info zum Ereignis(html Tags sind erlaubt)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: projectID
  * Beschreibung: ID eines zugehörigen Projekts
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: eventPrio
  * Beschreibung: Priorität des Ereignisses5 = normal1 = niedrig9 = hoch
  * Typ: Int
  * Default-Wert: 5
  * Pflichtfeld:  
* Parameter: crmTags
  * Beschreibung: Tags zum Ereignis(mehrere kommasepariert möglich)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: followUpDate
  * Beschreibung: Datum der Wiedervorlage(aktiviert die Wiedervorlagenfunktion)
  * Typ: Date
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: followUpTime
  * Beschreibung: Uhrzeit der Wiedervorlage
  * Typ: Time
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: followUpUser
  * Beschreibung: Wiedervorlagen für Benutzer mit ID
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: followUpNote
  * Beschreibung: Notiz zur Wiedervorlage(keine html Tags)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  


Beispiel:

```
{
    "contactID": 124,
    "eventDate": "2022-11-13",
    "eventTime": "11:30:00",
    "eventNote": "<p>Hier steht eine <strong>Info</strong> zum Ereignis</p>",
    "media": 1,
    "followUpDate": "2022-12-08",
    "followUpUser": 3,
    "followUpNote": "eine Info zur Wiedervorlage"
}
```


ein CRM Ereignis bearbeiten
---------------------------

```
PUT /api/v1/crmevents/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Es stehen die Parameter zum Erstellen der Ressource zur Verfügung (s.o.).

Ergänzend stehen weitere Parameter zur Verfügung:


|Parameter   |Beschreibung          |Typ|
|------------|----------------------|---|
|followUpDone|erledigt0 = nein1 = ja|Int|


ein CRM Ereignis löschen
------------------------

```
DELETE /api/v1/crmevents/{id}
```


Es müssen keine weiteren Parameter übergeben werden.