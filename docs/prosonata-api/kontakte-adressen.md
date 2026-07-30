# API Ressource: Adressen | ProSonata Agentursoftware
ProSonata API

Kontakte: Adressen
------------------

alle Adressen auflisten
-----------------------

```
GET /api/v1/addresses
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
    "apiLimitRemaining": 443,
    "apiLimitReset": 812
  },
  "data": [
    {
      "addressID": 33,
      "customerID": 0,
      "customerName": "Intern",
      "companyStatus": 0,
      "name1": "Testcompany",
      "name2": "",
      "name3": "",
      "addressName": "",
      "street": "Teststraße",
      "streetNo": 12,
      "postalCode": 60123,
      "city": "Frankfurt",
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
GET /api/v1/addresses?name1=Testcompany
```




* Parameter: customerID
  * Beschreibung: ID der Firma/Gruppe
* Parameter: customerName
  * Beschreibung: Bezeichnung der Firma/Gruppe
* Parameter: companyStatus
  * Beschreibung: Status der Firma:0 = Kunde1 = Lieferant2 = Interessent3 = Akquise4 = PR/Presse5 = inaktiv/gekündigt6 = Sonstige
* Parameter: name1
  * Beschreibung: Zeile 1 der Firmierung
* Parameter: name2
  * Beschreibung: Zeile 2 der Firmierung
* Parameter: name3
  * Beschreibung: Zeile 3 der Firmierung
* Parameter: addressName
  * Beschreibung: interne Bezeichnung der Adresse
* Parameter: postalCode
  * Beschreibung: Postleitzahl
* Parameter: city
  * Beschreibung: Stadt
* Parameter: country
  * Beschreibung: Land
* Parameter: comments
  * Beschreibung: Anmerkungen zur Adresse
* Parameter: addressTags
  * Beschreibung: Tags der Adresse
* Parameter: taxID
  * Beschreibung: Steuer ID der Firma
* Parameter: fibuAccountNo
  * Beschreibung: FiBu-Konto der Firma
* Parameter: addressActive
  * Beschreibung: Adresse aktiv:0 = nein1 = ja (Standard)


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

addressID, customerID, name1, addressName, postalCode, city, country

eine Adresse aufrufen
---------------------

```
GET /api/v1/addresses/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 496,
    "apiLimitReset": 693
  },
  "data": {
    "addressID": 36,
    "customerID": 10,
    "customerName": "ABC Versicherung",
    "companyStatus": 0,
    "name1": "ABC Versicherung AG",
    "name2": "",
    "name3": "",
    "addressName": "",
    "street": "Unfallstraße",
    "streetNo": 23,
    "postalCode": 12345,
    "city": "Hamburg",
    "country": "",
    "companyEmail": "",
    "companyTelephone": "",
    "comments": "",
    "addressTags": "",
    "taxID": "DE12314123",
    "DUNS": "",
    "GLN": "",
    "supplierNo": "",
    "fibuAccountNo": 10028,
    "customerPaymentTarget": 14,
    "invoiceEmail": "buchhaltung@versicherung.de",
    "noInvoiceEmail": 0,
    "mandateReference": "MR0051535",
    "mandateDate": "2015-10-13",
    "IBAN": "DE123456789123456789",
    "BIC": "POSTEJFXXX",
    "bankName": "",
    "accountOwner": "ABC Versicherung AG",
    "invReverseCharge": 0,
    "invThirdCountry": 0,
    "invTextTemplate": null,
    "addressCreatedByUserID": 1,
    "addressEditedByUserID": 3,
    "addressActive": 1,
    "addressViaApi": 0,
    "contactsAssigned": [
      {
        "contactID": 48,
        "firstName": "Karl",
        "LastName": "Schmidt",
        "position": "",
        "department": "",
        "email": "karl.schmidt@versicherung.de",
        "email2": "",
        "telephone": "01234 5678945",
        "mobile": ""
      },
      ...
    ]
  }
}
```


eine Adresse erstellen
----------------------

```
POST /api/v1/addresses
```


Das FiBu-Konto (fibuAccountNo) wird beim Anlegen automatisch generiert!

Notwendige und mögliche Parameter im Body:



* Parameter: customerID
  * Beschreibung: ID der Firma/Gruppedie Firma/Gruppe muss vorhanden sein,ansonsten wird ein 409-Fehler zurückgegeben
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: name1
  * Beschreibung: Firmierung Zeile 1handelt es sich nicht um eine Firmenadressesollte eine Bezeichnung (addressName)vergeben werden
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: name2
  * Beschreibung: Firmierung Zeile 2
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: name3
  * Beschreibung: Firmierung Zeile 3
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: addressName
  * Beschreibung: (intern) Bezeichnung
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: street
  * Beschreibung: Straße
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: streetNo
  * Beschreibung: Hausnummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: postalCode
  * Beschreibung: PLZ
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: city
  * Beschreibung: Stadt
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: country
  * Beschreibung: Land
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: companyEmail
  * Beschreibung: zentrale E-Mail-Adresse der Firma
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: companyTelephone
  * Beschreibung: zentrale Telefonnummer der Firma
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: comments
  * Beschreibung: Anmerkungen zur Firma bzw. Adresse
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: taxID
  * Beschreibung: Steuernummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: DUNS
  * Beschreibung: DUNS-Nummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: GLN
  * Beschreibung: GLN-Nummer
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: supplierNo
  * Beschreibung: Lieferantennummer bei dieser Firma
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: fibuAccountNo
  * Beschreibung: FiBu-Konto
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: invoiceEmail
  * Beschreibung: Standard Rechnungs-E-Mail-Adresse
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: noInvoiceEmail
  * Beschreibung: keine Rechnungen per E-Mail gewünscht0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: mandateReference
  * Beschreibung: SEPA-Lastschrift Mandatsreferenz
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: mandateDate
  * Beschreibung: Mandatsdatum
  * Typ: Date
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: IBAN
  * Beschreibung: IBAN der Bankverbindung
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: BIC
  * Beschreibung: BIC der Bankverbindung
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: bankName
  * Beschreibung: Bankname
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: accountOwner
  * Beschreibung: Kontoinhaber
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: invReverseCharge
  * Beschreibung: Reverse-Charge, EU-Ausland0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: invThirdCountry
  * Beschreibung: Drittland0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: invTextTemplate
  * Beschreibung: Standard Rechnungsabbindernull = keine Vorauswahl0 bis 5 = Rechnungsabbinder 1 bis 6
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: addressActive
  * Beschreibung: Adresse aktiv0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 1
  * Pflichtfeld:  


Beispiel:

```
{
    "customerID": 10,
    "name1": "ABC Versicherung AG",
    "street": "Unfallstraße",
    "streetNo": 23,
    "postalCode": 12345,
    "city": "Hamburg"
}
```


eine Adresse bearbeiten
-----------------------

```
PUT /api/v1/addresses/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Es stehen die Parameter zum Erstellen der Ressource zur Verfügung (s.o.).