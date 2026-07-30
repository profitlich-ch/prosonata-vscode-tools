# API Ressource: Leistungsvorlagen | ProSonata Agentursoftware
alle Leistungsvorlagen auflisten
--------------------------------

```
GET /api/v1/servicetemplates
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
     "templateID": 2,
     "category": 1,
     "templateName": "Website klein",
     "detail": "<p>Beratung bei Konzeption und Struktur der Website. Kommunikation und Handling.</p>\r\n<p><strong>Zeitbedarf</strong>: ca. 4 Std.</p>",
     "detail_lang1": "",
     "quantity": "4.00",
     "unit": "",
     "unit_lang1": "",
     "netValue": "95.00",
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
GET /api/v1/servicetemplates?templateName=test
```



|Parameter         |Beschreibung                                     |
|------------------|-------------------------------------------------|
|templateName      |Bezeichnung der Leistungsvorlage                 |
|detail            |Beschreibungstext                                |
|detail_lang1      |Beschreibungstext englisch                       |
|category          |ID der Kategorie                                 |
|unit              |Einheit                                          |
|noCustomerDiscount|Kundenrabatte nicht berücksichtigen0 = nein1 = ja|
|hourlyRateService |Leistung auf Stundensatzbasis0 = nein1 = ja      |


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

templateID, category, netValue

eine Leistungsvorlage aufrufen
------------------------------

```
GET /api/v1/servicetemplates/{id}
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
    "templateID": 42,
    "category": 2,
    "templateName": "Gestaltung einer Website (klein)",
    "detail": "<p>Gestaltung der Website: ca. 12 Stunden</p>",
    "detail_lang1": "<p>Design of a website: approx. 12 hrs</p>",
    "quantity": "12.00",
    "unit": "",
    "unit_lang1": "",
    "netValue": "90.00",
    "additionalCharge1": "0.00",
    "additionalCharge2": "0.00",
    "advancePaymentTemplate": 0,
    "noCustomerDiscount": 0,
    "hourlyRateService": 1,
    "serviceTemplateViaApi": 1
  }
}
```


eine Leistungsvorlage erstellen
-------------------------------

```
POST /api/v1/servicetemplates
```


Notwendige und mögliche Parameter im Body:



* Parameter: category
  * Beschreibung: Kategorie der Leistung
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: templateName
  * Beschreibung: Bezeichnung der Leistungsvorlage
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: ja
* Parameter: detail
  * Beschreibung: Beschreibungstext der Vorlage für die Position
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: detail_lang1
  * Beschreibung: Beschreibungstext englisch
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: quantity
  * Beschreibung: Menge
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: unit
  * Beschreibung: Einheit
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: unit_lang1
  * Beschreibung: Einheit englisch
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: netValue
  * Beschreibung: Nettopreis
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: additionalCharge1
  * Beschreibung: Preisaufschlag (%)
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: additionalCharge2
  * Beschreibung: Preisaufschlag (Betrag pro Stück/Menge)
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: noCustomerDiscount
  * Beschreibung: Kundenrabatte nicht berücksichtigen0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: hourlyRateService
  * Beschreibung: Leistung auf Stundensatzbasis0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  


Angabe von Dezimalwerten mit Punkt als Trennzeichen.

Beispiel:

```
{
    "category": 14,
    "templateName": "eine neue Leistungsvorlage",
    "detail": "<p>hier steht eine erweiterte Beschreibung</p>",
    "quantity": 5,
    "unit": "Std.",
    "netValue": 90.00
}
```


eine Leistungsvorlage bearbeiten
--------------------------------

```
PUT /api/v1/servicetemplates/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Es stehen die Parameter zum Erstellen der Ressource zur Verfügung (s.o.).

eine Leistungsvorlage löschen
-----------------------------

```
DELETE /api/v1/servicetemplates/{id}
```


Es müssen keine weiteren Parameter übergeben werden.