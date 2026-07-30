# API Ressource: Projektzeitkategorien | ProSonata Agentursoftware
Folgende HTTP-Methoden stehen für Projektzeitkategorien zur Verfügung:

*   GET: Ressource lesen

Zugriff für **alle Benutzergruppen**.

alle Projektzeitkategorien auflisten
------------------------------------

```
GET /api/v1/projecttimecategories
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 36,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 484,
    "apiLimitReset": 466
  },
  "data": [
    {
      "category": 5,
      "categoryOrder": 1,
      "categoryName": "Daten Dearchivierung",
      "active": 1,
      "categoryCostRate": null,
      "group": 10,
      "groupName": "Projekt Vorbereitung",
      "linkedCustomerID": null,
      "priceGroup": null
    },
    ...
  ]
}
```


Filterung/Suche
---------------

Über Parameter kann gefiltert werden:

```
GET /api/v1/projecttimecategories?categoryName=Gestaltung
```



|Parameter       |Beschreibung                 |
|----------------|-----------------------------|
|category        |ID der Zeitkategorie         |
|categoryName    |Bezeichnung der Kategorie    |
|active          |Kategorie aktiv0 = nein1 = ja|
|linkedCustomerID|ID der Firma/Gruppe          |
|priceGroup      |Preisgruppe der Kategorie    |


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

category, categoryOrder, group, categoryName, active, priceGroup

eine Projektzeitkategorie aufrufen
----------------------------------

```
GET /api/v1/projecttimecategories/{id}
```


Antwort:

```
{
  "meta": {
    "status": 200,
    "requestUserID": 1,
    "requestUsername": "Admin1",
    "usergroupName": "Administrator",
    "apiLimitRemaining": 462,
    "apiLimitReset": 556
  },
  "data": {
    "category": 30,
    "categoryOrder": 5,
    "categoryName": "Gestaltung",
    "active": 1,
    "categoryCostRate": null,
    "group": 30,
    "groupName": "Layout",
    "linkedCustomerID": null,
    "priceGroup": null
  }
}
```
