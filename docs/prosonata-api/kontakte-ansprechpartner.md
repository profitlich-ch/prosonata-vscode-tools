# API Ressource: Ansprechpartner | ProSonata Agentursoftware
ProSonata API

Kontakte: Ansprechpartner
-------------------------

alle Ansprechpartner (inkl. Adresse) auflisten
----------------------------------------------

```
GET /api/v1/contacts
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 85,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 436,
    "apiLimitReset": 516
  },
  "data": [
    {
      "contactID": 48,
      "title": "Herr",
      "firstName": "Karl",
      "lastName": "Schmidt",
      "customerID": 10,
      "customerName": "ABC Versicherung",
      "addressID": 36,
      "name1": "ABC Versicherung AG",
      "name2": "",
      "street": "Unfallstraße",
      "streetNo": 23,
      "postalCode": 12345,
      "city": "Hamburg",
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
GET /api/v1/contacts?lastName=Meier
```



|Parameter               |Beschreibung                           |
|------------------------|---------------------------------------|
|firstName               |Vorname                                |
|lastName                |Nachname                               |
|customerID              |ID der Firma/Gruppe                    |
|customerName            |Bezeichnung der Firma/Gruppe           |
|addressID               |ID der Adresse                         |
|name1                   |Zeile 1 der Firmierung                 |
|name2                   |Zeile 2 der Firmierung                 |
|name3                   |Zeile 3 der Firmierung                 |
|addressName             |interne Bezeichnung der Adresse        |
|postalCode              |Postleitzahl                           |
|city                    |Stadt                                  |
|country                 |Land                                   |
|comments                |Anmerkungen zum Ansprechpartner        |
|contactFilter1 (2, 3, …)|Filter 1 (oder 2, 3, …)                |
|active                  |Kontakt aktiv:0 = nein1 = ja (Standard)|


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

contactID, customerID, addressID, firstName, lastName, birthday, postalCode, city, country, accountManagerUserID, active

einen Ansprechpartner aufrufen
------------------------------

```
GET /api/v1/contacts/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 446,
    "apiLimitReset": 723
  },
  "data": {
    "contactID": 48,
    "title": "Herr",
    "firstName": "Karl",
    "lastName": "Schmidt",
    "customerID": 10,
    "customerName": "ABC Versicherung",
    "addressID": 36,
    "name1": "ABC Versicherung AG",
    "name2": "",
    "street": "Unfallstraße",
    "streetNo": 23,
    "postalCode": 12345,
    "city": "Hamburg",
    "country": "",
    "position": "",
    "department": "",
    "email": "karl.schmidt@versicherung.de",
    "email2": "",
    "telephone": "01234 5678945",
    "fax": "",
    "mobile": "",
    "telephonePrivate": "",
    "mobilePrivate": "",
    "streetPrivate": "",
    "streetNoPrivate": "",
    "postalCodePrivate": "",
    "cityPrivate": "",
    "countryPrivate": "",
    "usePrivateForCSV": 0,
    "messenger": "",
    "socialMedia": "",
    "website": "",
    "comments": "",
    "birthday": "1967-02-07",
    "contactFilter1": 0,
    "contactFilter2": 1,
    "contactFilter3": 1,
    "contactFilter4": 1,
    "contactFilter5": 0,
    "contactFilter6": 0,
    "contactFilter7": 0,
    "contactFilter8": 0,
    "contactFilter9": 0,
    "contactFilter10": 0,
    "accountManagerUserID": null,
    "createdByUserID": 1,
    "contactCreationDate": null,
    "editedByUserID": 1,
    "active": 1,
    "isLocked": 0,
    "contactViaApi": 0
  }
}
```


einen Ansprechpartner erstellen
-------------------------------

```
POST /api/v1/contacts
```


Eine neue Firma/Gruppe bzw. eine neue Adresse muss zunächst über die entsprechende Ressource erstellt werden!

Notwendige und mögliche Parameter im Body:



* Parameter: title
  * Beschreibung: Anrede:HerrFrauHerr Dr.Frau Dr.…
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: firstName
  * Beschreibung: Vorname
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: lastName
  * Beschreibung: Nachname
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: customerID
  * Beschreibung: ID der Firma/Gruppedie Firma/Gruppe muss vorhanden sein,ansonsten wird ein 409-Fehler zurückgegeben
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: addressID
  * Beschreibung: ID der Adressedie Adresse muss vorhanden sein
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: position
  * Beschreibung: Position
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: department
  * Beschreibung: Abteilung
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: email
  * Beschreibung: E-Mail-Adresse
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: email2
  * Beschreibung: E-Mail-Adresse 2
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: telephone
  * Beschreibung: Telefonnummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: fax
  * Beschreibung: Faxnummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: mobile
  * Beschreibung: Mobilnummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: telephonePrivate
  * Beschreibung: private Telefonnummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: mobilePrivate
  * Beschreibung: private Mobilnummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: streetPrivate
  * Beschreibung: private Straße
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: streetNoPrivate
  * Beschreibung: private Hausnummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: postalCodePrivate
  * Beschreibung: private PLZ
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: cityPrivate
  * Beschreibung: private Stadt
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: countryPrivate
  * Beschreibung: privates Land
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: usePrivateForCSV
  * Beschreibung: private Adresse für CSV-Exporte verwenden
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: messenger
  * Beschreibung: Messenger Adresse
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: socialMedia
  * Beschreibung: Social Media Profil
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: website
  * Beschreibung: Website
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: comments
  * Beschreibung: Anmerkungen
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: birthday
  * Beschreibung: Geburtstag
  * Typ: Date
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: contactFilter1 (2, 3, …)
  * Beschreibung: Filter 1 (oder 2, 3, …) aktiv0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: accountManagerUserID
  * Beschreibung: Kundenbetreuer (Benutzer ID)
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: active
  * Beschreibung: Ansprechpartner aktiv0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  


Beispiel:

```
{
    "title": "Herr",
    "firstName": "Karl",
    "lastName": "Schmidt",
    "customerID": 10,
    "addressID": 36,
    "email": "karl.schmidt@versicherung.de",
    "telephone": "01234 5678945",
    "birthday": "1967-02-07",
    "contactFilter1": 1,
    "contactFilter3": 1
}
```


einen Ansprechpartner bearbeiten
--------------------------------

```
PUT /api/v1/contacts/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Es stehen die Parameter zum Erstellen der Ressource zur Verfügung (s.o.).