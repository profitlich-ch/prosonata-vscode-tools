# API Ressource: Angebote | ProSonata Agentursoftware
Folgende HTTP-Methoden stehen für Angebote zur Verfügung:

*   GET: Ressource lesen

Für den Endpunkt steht nur ein lesender Zugriff zur Verfügung.  
Zugriff ab Benutzergruppe **Teamleiter**.

alle Angebote auflisten
-----------------------

```
GET /api/v1/quotations
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 287,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 469,
    "apiLimitReset": 452
  },
  "data": [
    {
      "quotationID": 37,
      "quotationName": "",
      "quotationHeadline": "",
      "quotationDate": "2023-06-05",
      "netValue": "3550.00",
      "grossValue": "4224.50",
      "currency": 0,
      "tax": "19.0",
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
GET /api/v1/quotations?projectName=Testprojekt
```




* Parameter: addressID
  * Beschreibung: ID der Kundenadresse
* Parameter: name1
  * Beschreibung: Firmierung des Kunden (Zeile 1 der Adresse)
* Parameter: projectID
  * Beschreibung: ID des Projekts
* Parameter: projectNo
  * Beschreibung: Projektnummer
* Parameter: projectName
  * Beschreibung: Bezeichnung des Projekts
* Parameter: projectTags
  * Beschreibung: Tag(s) des Projekts
* Parameter: customerID
  * Beschreibung: ID des Kunden (Firma/Gruppe)
* Parameter: customerName
  * Beschreibung: Bezeichnung des Kunden (Firma/Gruppe)
* Parameter: quotationDate
  * Beschreibung: Datum des Dokumentsdurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: createdByUserID
  * Beschreibung: Dokument angelegt von Benutzer ID
* Parameter: currency
  * Beschreibung: Währung:0 = Euro1 = CHF2 = USD3 = GBP4 = CAD
* Parameter: approved
  * Beschreibung: Angebot wurde vom Kunden freigegeben:0 = nein1 = ja


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

quotationID, projectID, addressID, quotationDate, grossValue

ein Angebot aufrufen
--------------------

```
GET /api/v1/quotations/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 484,
    "apiLimitReset": 412
  },
  "data": {
    "quotationID": 164,
    "quotationName": "",
    "quotationHeadline": "",
    "quotationDate": "2022-10-11",
    "netValue": "1290.00",
    "grossValue": "1535.10",
    "currency": 0,
    "tax": "19.0",
    "multipleTaxes": 0,
    "isSent": 1,
    "sentDate": null,
    "ocSentDate": null,
    "quotationComments": "",
    "projectID": 328,
    "projectNo": "22-30-001",
    "projectNoAddition": "",
    "projectName": "Produktportfolio",
    "projectTags": "",
    "customerID": 30,
    "customerName": "Architekturbüro XY",
    "addressID": 158,
    "name1": "Architekturbüro XY GmbH",
    "name2": "",
    "name3": "",
    "street": "Musterstraße",
    "streetNo": "12",
    "postalCode": "12345",
    "city": "Musterstadt",
    "country": "",
    "countryID": "",
    "standardSalutation": 0,
    "firstName": "Max",
    "lastName": "Muster",
    "email": "Muster@testfirma.de",
    "username": "Admin2",
    "positions": [
     {
       "detailID": 905,
       "isActive": 1,
       "position": "1",
       "categoryName": "Gestaltung",
       "detail": "<p>Gestaltung eines Flyers mit Umfang 4 Seiten. Bildmaterial wird vom Kunden geliefert.</p>",
       "quantity": "6.00",
       "unit": "",
       "netValue": "95.00",
       "taxSwitch": 0,
       "tax": "0.0",
       "additionalChargeSwitch": 0,
       "initialNetValue": "95.00",
       "additionalCharge1": "0.00",
       "additionalCharge2": "0.00",
       "discountPosition": 0,
       "discountSource": null,
       "discountPercent": "0.00",
       "detailComments": ""
     },
     {
       "detailID": 904,
       "isActive": 1,
       "position": "2",
       "categoryName": "Gestaltung",
       "detail": "<p>Text zur Position</p>",
       "quantity": "8.00",
       "unit": "",
       "netValue": "90.00",
       "taxSwitch": 0,
       "tax": "0.0",
       "additionalChargeSwitch": 0,
       "initialNetValue": "90.00",
       "additionalCharge1": "0.00",
       "additionalCharge2": "0.00",
       "discountPosition": 0,
       "discountSource": null,
       "discountPercent": "0.00",
       "detailComments": ""
     }
    ]
}
```
