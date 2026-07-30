# API Ressource: Firmen | ProSonata Agentursoftware
ProSonata API

Kontakte: Firmen/Gruppen
------------------------

alle Firmen/Gruppen auflisten
-----------------------------

```
GET /api/v1/customers
```


Bitte beachte: Die Ressource bietet (anders als der Name vermuten lässt) Zugriff auf _alle_ Firmen der Kontaktverwaltung, also Kunden, Lieferanten, Interessenten etc. Die größte Menge der Einträge wird aber Kunden betreffen, daher die Bezeichnung, die als Parameter auch in anderen Ressourcen zu finden ist (_customerID_, _customerName_).

Der Parameter _invoiceCounter_ hat nur eine Bedeutung für Accounts, die als Rechnungsnummernmodus den Zähler pro Kunde aktiviert haben.

Antwort:

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 23,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 443,
    "apiLimitReset": 812
  },
  "data": [
    {
      "customerID": 10,
      "customerName": "Testfirma",
      "companyCode": "",
      "companyStatus": 0,
      "comments": "",
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
GET /api/v1/customers?customerName=Testfirma
```




* Parameter: customerName
  * Beschreibung: Bezeichnung der Firma/Gruppe
* Parameter: companyCode
  * Beschreibung: Kürzel der Firma/Gruppe
* Parameter: companyStatus
  * Beschreibung: Status der Firma:0 = Kunde1 = Lieferant2 = Interessent3 = Akquise4 = PR/Presse5 = inaktiv/gekündigt6 = Sonstige
* Parameter: companyTags
  * Beschreibung: Tags der Firma
* Parameter: comments
  * Beschreibung: Anmerkungen zur Firma/Gruppe
* Parameter: hourlyRateDiscount
  * Beschreibung: Rabatt (Prozent) auf den allgemeinen Stundensatz
* Parameter: customerCostRate
  * Beschreibung: individueller Stundensatz des Kunden
* Parameter: customerPriceGroup
  * Beschreibung: Preisgruppe des Kunden
* Parameter: customerPaymentTarget
  * Beschreibung: individuelles Zahlungsziel des Kunden
* Parameter: customerCashDiscountRate
  * Beschreibung: individueller Skontosatz des Kunden
* Parameter: customerCashDiscountPaymentTarget
  * Beschreibung: individuelles Zahlungsziel für den Skontobetrag


Angabe von Dezimalwerten mit Punkt als Trennzeichen.

Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

customerID, customerName, companyCode, companyStatus, hourlyRateDiscount, customerCostRate, customerPriceGroup, customerPaymentTarget, customerCashDiscountRate

eine Firma/Gruppe aufrufen
--------------------------

```
GET /api/v1/customers/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 486,
    "apiLimitReset": 642
  },
  "data": {
    "customerID": 10,
    "customerName": "ABC Versicherung",
    "companyCode": "ABC",
    "companyStatus": 0,
    "companyTags": "",
    "comments": "",
    "projectCounter": 32,
    "projectCounterYear": 2019,
    "invoiceCounter": 1,
    "invoiceCounterYear": 2015,
    "hourlyRateDiscount": 0,
    "customerCostRate": 80,
    "customerPriceGroup": null,
    "customerPaymentTarget": 7,
    "customerCashDiscountRate": null,
    "customerCashDiscountPaymentTarget": null,
    "companyViaApi": 0,
    "addressesAssigned": [
      {
        "addressID": 36,
        "name1": "ABC Versicherung AG",
        "name2": "",
        "name3": "",
        "addressName": "",
        "street": "Unfallstraße",
        "streetNo": 23,
        "postalCode": 12345,
        "city": "Hamburg",
        "country": ""
      }
    ],
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


eine Firma/Gruppe erstellen
---------------------------

```
POST /api/v1/customers
```


Die Firmennummer (customerNo) wird beim Anlegen automatisch generiert!

Notwendige und mögliche Parameter im Body:



* Parameter: customerName
  * Beschreibung: Bezeichnung der Firma/Gruppe
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: companyCode
  * Beschreibung: Kürzel der Firma/Gruppe
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: companyStatus
  * Beschreibung: Status der Firma/Gruppe:0 = Kunde1 = Lieferant2 = Interessent3 = Akquise4 = PR/Presse5 = inaktiv/gekündigt6 = Sonstige
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: comments
  * Beschreibung: Anmerkungen zur Firma/Gruppe
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: hourlyRateDiscount
  * Beschreibung: Rabatt (Prozent) auf den allgemeinen Stundensatz
  * Typ: Dec
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: customerCostRate
  * Beschreibung: individueller Stundensatz des Kunden
  * Typ: Dec
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: customerPriceGroup
  * Beschreibung: Preisgruppe des Kunden
  * Typ: String
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: customerPaymentTarget
  * Beschreibung: individuelles Zahlungsziel des Kunden
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: customerCashDiscountRate
  * Beschreibung: individueller Skontosatz des Kunden
  * Typ: Dec
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: customerCashDiscountPaymentTarget
  * Beschreibung: individuelles Zahlungsziel für den Skontobetrag
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  


Angabe von Dezimalwerten mit Punkt als Trennzeichen.

Beispiel:

```
{
    "customerName": "Testfirma API",
    "companyCode": "TAPI",
    "customerPaymentTarget": 7
}
```


eine Firma/Gruppe bearbeiten
----------------------------

```
PUT /api/v1/customers/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Es stehen die Parameter zum Erstellen der Ressource zur Verfügung (s.o.).