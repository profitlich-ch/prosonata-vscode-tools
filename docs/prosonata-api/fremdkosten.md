# API Ressource: Fremdkosten | ProSonata Agentursoftware
alle Fremdkosten auflisten
--------------------------

```
GET /api/v1/externalcosts
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
    "apiLimitRemaining": 428,
    "apiLimitReset": 793
  },
  "data": [
    {
      "documentID": 119,
      "addressID": 43,
      "name1": "Repro Schmidt GbR",
      "type": 1,
      "projectID": 172,
      "projectNo": "17-18-001",
      "projectName": "Käsebroschüre",
      "customerName": "Käserei Gouda",
      "costName": "Broschüre Proofs",
      "documentNo": "R513213",
      "documentDate": "2019-10-23",
      "paymentTarget": 0,
      "paymentType": null,
      "receiptDate": "2019-10-23",
      "recurringDoc": 0,
      "createdByUserID": 2,
      "quantity": null,
      "unitPrice": null,
      "unit": "",
      "netValue": 100,
      "grossValue": 119,
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
GET /api/v1/externalcosts?projectName=Testprojekt
```




* Parameter: addressID
  * Beschreibung: ID der Lieferantenadresse
* Parameter: name1
  * Beschreibung: Firmierung des Lieferanten (Zeile 1 der Adresse)
* Parameter: type
  * Beschreibung: Dokumenttyp0 = Angebot1 = Rechnung
* Parameter: projectID
  * Beschreibung: ID des Projekts
* Parameter: projectNo
  * Beschreibung: Projektnummer
* Parameter: projectName
  * Beschreibung: Bezeichnung des Projekts
* Parameter: customerID
  * Beschreibung: ID des Kunden (Firma/Gruppe)
* Parameter: customerName
  * Beschreibung: Bezeichnung des Kunden (Firma/Gruppe)
* Parameter: costName
  * Beschreibung: Bezeichnung des Fremdkostendokuments
* Parameter: documentNo
  * Beschreibung: Nummer des Dokuments
* Parameter: documentDate
  * Beschreibung: Datum des Dokumentsdurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: receiptDate
  * Beschreibung: Eingangsdatum des Dokumentsdurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: paymentType
  * Beschreibung: Zahlmethode:1 = Banküberweisung2 = Lastschrift3 = Kreditkarte4 = Dauerauftrag5 = Kasse6 = Vorkasse7 = Paypal8 = Scheck9 = Gutschrift10 = Verrechnung11 = EC-Karte
* Parameter: recurringDoc
  * Beschreibung: wiederkehrendes Projekt:0 = nicht wiederkehrend1 = monatlich2 = zweimonatlich3 = quartalsweise4 = halbjährlich5 = jährlich6 = zweijährlich7 = mit Projekt kopieren
* Parameter: createdByUserID
  * Beschreibung: Dokument angelegt von Benutzer ID
* Parameter: currency
  * Beschreibung: Währung:0 = Euro1 = CHF2 = USD3 = GBP4 = CAD
* Parameter: reverseCharge
  * Beschreibung: Reverse Charge (Rechnungsempfänger ist steuerpflichtig):0 = nein1 = ja
* Parameter: paymentDate
  * Beschreibung: Bezahldatum des Dokumentsdurch Angabe von > oder < vor dem Datum kann eine Suche ab dem bzw. bis zum Datum erfolgen
* Parameter: notInvoiceable
  * Beschreibung: nicht weiterberechenbar:0 = nein1 = ja
* Parameter: kskMember
  * Beschreibung: Dokument ist relevant für Künstler Sozialkasse:0 = nein1 = ja
* Parameter: useForCalculation
  * Beschreibung: in Projektkalkulation einbezogen (relevant für Angebote):0 = nein1 = ja
* Parameter: serviceCategory
  * Beschreibung: ID der Leistungskategorie
* Parameter: datevExport
  * Beschreibung: FiBu Export ist erfolgt:0 = nein1 = ja


Sortierung
----------

Nach folgenden Parametern kann sortiert werden (Sortierrichtung ggf. mit ASC bzw. DESC ergänzen):

documentID, projectID, addressID, documentNo, documentDate, receiptDate, grossValue

ein Fremdkostendokument aufrufen
--------------------------------

```
GET /api/v1/externalcosts/{id}
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
    "documentID": 86,
    "addressID": 41,
    "name1": "Druckerei Schnell GmbH",
    "type": 1,
    "projectID": 172,
    "projectNo": "17-18-001",
    "projectName": "Käsebroschüre",
    "customerID": 18,
    "customerName": "Käserei Gouda",
    "costName": "Druck Broschüre",
    "documentNo": "R23424",
    "documentDate": "2017-02-18",
    "paymentTarget": 14,
    "paymentType": null,
    "receiptDate": "2017-02-18",
    "recurringDoc": 0,
    "createdByUserID": 1,
    "quantity": 1,
    "unitPrice": 1100,
    "unit": "",
    "comments": "erste Position des Dokuments",
    "netValue": 1500,
    "grossValue": 1785,
    "currency": 0,
    "tax": 19,
    "multipleTaxes": 0,
    "reverseCharge": 0,
    "multiplePositions": 1,
    "cashDiscountRate": 0,
    "paymentDate": null,
    "paidCashDiscount": 0,
    "additionalCharge": 0,
    "additionalCharge2": 0,
    "notInvoiceable": 0,
    "kskMember": 0,
    "useForCalculation": 0,
    "serviceCategory": 4,
    "categoryName": "Produktion",
    "fibuExpenseAccount": "",
    "fibuInputTaxAccount": "",
    "datevTaxKey": 9,
    "approvedByUsers": "",
    "datevExport": 0,
    "documentViaApi": 0,
    "additionalPositions": [
      {
        "detailID": 23,
        "position": "2",
        "detail": "zweite Position des Dokuments",
        "quantity": 2,
        "unit": "Stck.",
        "netValue": 200,
        "taxSwitch": 0,
        "tax": 0,
        "fibuInputTaxAccount": "",
        "datevTaxKey": null
      }
    ]
  }
}
```


ein Fremdkostendokument erstellen
---------------------------------

```
POST /api/v1/externalcosts
```


Übergebene Werte (z.B. _netValue, grossValue_ = Gesamtpreis des Dokuments) werden bei der Speicherung nicht auf korrekte Berechnung überprüft! Eine Validierung muss vorab erfolgen.

Im einfachsten Fall kann ein zu erfassendes Dokument einen Gesamtpreis und die Zuordnung zum Projekt und Lieferanten erhalten. Ergänzend können hier die Parameter _quantity_ und _unitPrice_ genutzt werden, um eine Menge und einen Einzelpreis (für die erste Position) zu erfassen. Falls weitere Positionen vorhanden sind, können diese als Array mit dem Parameter _additionalPositions_ übergeben werden.

Optional – und wenn ein FTP Webspace als Dateiablage konfiguriert ist – kann eine Datei hochgeladen werden. Die Datei muss dabei base64 codiert im entsprechenden Feld _file_ übertragen werden.

Falls die _addressID_ und/oder die _projectID_ nicht bekannt sind, kann der Datensatz in die Inbox gespeichert werden (Parameter _useInbox_ = 1). In einem zweiten Schritt kann in ProSonata (Menüpunkt > Faktura > Fremdkosten) der Datensatz nach Zuordnung der fehlenden Parameter als neues Fremdkostendokument übernommen werden.

Notwendige und mögliche Parameter im Body:



* Parameter: projectID
  * Beschreibung: ID des Projekts
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja*
* Parameter: projectNo
  * Beschreibung: Nummer des Projekts (bei Nutzung der Inbox, ansonsten hat die projectID Vorrang)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: addressID
  * Beschreibung: ID der Lieferantenadresse
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld: ja*
* Parameter: supplierName
  * Beschreibung: Firmierung des Lieferanten (bei Nutzung der Inbox, ansonsten hat die addressID Vorrang)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: type
  * Beschreibung: Dokumenttyp0 = Angebot1 = Rechnung
  * Typ: Int
  * Default-Wert: 1
  * Pflichtfeld:  
* Parameter: costName
  * Beschreibung: Bezeichnung des Fremdkostendokuments
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: documentNo
  * Beschreibung: Nummer des Dokuments
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: documentDate
  * Beschreibung: Datum des Dokuments
  * Typ: Date
  * Default-Wert: aktueller Tag
  * Pflichtfeld:  
* Parameter: paymentTarget
  * Beschreibung: Zahlungsziel (in Tagen)
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: paymentType
  * Beschreibung: Zahlmethode:1 = Banküberweisung2 = Lastschrift3 = Kreditkarte4 = Dauerauftrag5 = Kasse6 = Vorkasse7 = Paypal8 = Scheck9 = Gutschrift10 = Verrechnung11 = EC-Karte
  * Typ:  
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: receiptDate
  * Beschreibung: Eingangsdatum des Dokuments
  * Typ: Date
  * Default-Wert: aktueller Tag
  * Pflichtfeld:  
* Parameter: recurringDoc
  * Beschreibung: wiederkehrendes Projekt:0 = nicht wiederkehrend1 = monatlich2 = zweimonatlich3 = quartalsweise4 = halbjährlich5 = jährlich6 = zweijährlich7 = mit Projekt kopieren
  * Typ:  
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: quantity
  * Beschreibung: Menge (Position 1)
  * Typ: Dec
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: unitPrice
  * Beschreibung: Einzelpreis (Position 1)
  * Typ: Dec
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: unit
  * Beschreibung: Einheit (Position 1)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: comments
  * Beschreibung: Beschreibungstext (Position 1 oder allgemein zum Dokument)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: netValue
  * Beschreibung: Gesamtpreis netto
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld: ja
* Parameter: grossValue
  * Beschreibung: Gesamtpreis brutto
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld: ja
* Parameter: currency
  * Beschreibung: Währung:0 = Euro1 = CHF (SFr)2 = US$3 = GBP4 = CAD
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: tax
  * Beschreibung: Steuersatz
  * Typ: Dec
  * Default-Wert: 0.0
  * Pflichtfeld: ja
* Parameter: multipleTaxes
  * Beschreibung: mehrere Steuersätze im Dokument vorhanden0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: reverseCharge
  * Beschreibung: Dokument unterliegt dem Reverse Charge Verfahren0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: multiplePositions
  * Beschreibung: mehrere Positionen im Dokument vorhanden0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: cashDiscountRate
  * Beschreibung: gewährter Skontosatz
  * Typ: Dec
  * Default-Wert: 0.0
  * Pflichtfeld:  
* Parameter: paymentDate
  * Beschreibung: Dokument ist bezahlt (Eingabe Zahldatum)
  * Typ: Date
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: paidCashDiscount
  * Beschreibung: Skonto wurde genutzt0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: additionalCharge
  * Beschreibung: geplanter prozentualer Aufschlag
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: additionalCharge2
  * Beschreibung: geplanter Aufschlag als Festbetrag– die Eingabe hat Vorrang vor einem prozentualen Aufschlag– bei mehreren erfassten Positionen erfolgt der Aufschlag nur prozentual
  * Typ: Dec
  * Default-Wert: 0.00
  * Pflichtfeld:  
* Parameter: notInvoiceable
  * Beschreibung: nicht weiterberechenbare Rechnung0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: kskMember
  * Beschreibung: Rechnung ist relevant für Künstler Sozialkasse0 = nein1 = ja
  * Typ: Int
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: useForCalculation
  * Beschreibung: Angebot wird in der Projektauswertung berücksichtigt0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 1
  * Pflichtfeld:  
* Parameter: serviceCategory
  * Beschreibung: ID der Leistungskategorie
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: fibuExpenseAccount
  * Beschreibung: FiBu Aufwandskonto
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: fibuInputTaxAccount
  * Beschreibung: FiBu Vorsteuerkonto
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: datevTaxKey
  * Beschreibung: Vorsteuerschlüssel nach Datev
  * Typ: Int
  * Default-Wert: null
  * Pflichtfeld:  
* Parameter: approvedByUsers
  * Beschreibung: Freigabetext (interne Freigabe)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld:  
* Parameter: datevExport
  * Beschreibung: FiBu Export ist erfolgt0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  
* Parameter: additionalPositions
  * Beschreibung: weitere Positionen des Dokuments speichern;ein Array der Positionen kann übergeben werden:detail: Beschreibung der Positionquantity: Mengeunit: EinheitnetValue: EinzelpreistaxSwitch: Pos. hat einen eigenen Steuersatz0 = nein (default)1 = jatax: SteuersatzfibuInputTaxAccount: FiBu VorsteuerkontodatevTaxKey: Vorsteuerschlüssel nach Datev
  * Typ: Array
  * Default-Wert: []leeres Array
  * Pflichtfeld:  
* Parameter: file
  * Beschreibung: base64 encodierte Daten der Datei (ein MIME-Type o.ä. darf nicht enthalten sein)maximale Dateigröße ca. 5 MB
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: **
* Parameter: fileName
  * Beschreibung: Dateiname inkl. Dateiendung (.pdf, .jpg etc.)
  * Typ: String
  * Default-Wert:  
  * Pflichtfeld: **
* Parameter: useInbox
  * Beschreibung: Nutzung der Inbox für die Dokumenterstellung0 = nein1 = ja
  * Typ: Int
  * Default-Wert: 0
  * Pflichtfeld:  


\* Wird die Inbox genutzt, sind die Felder keine Pflichtfelder.

\*\* Wird eine Datei im Feld _file_ übertragen muss auch ein Dateiname übergeben werden.

Angabe von Dezimalwerten mit Punkt als Trennzeichen.

Beispiel:

```
{
    "addressID": 41,
    "type": 1,
    "projectID": 45,
    "costName": "eine kurze Bezeichnung",
    "documentNo": "R1234567-123",
    "documentDate": "2019-09-08",
    "paymentTarget": 14,
    "receiptDate": "2019-09-10",
    "quantity": 2,
    "unitPrice": 100.00,
    "unit": "Std.",
    "comments": "Beschreibung zur ersten Position",
    "netValue": 1320.00,
    "grossValue": 1496.40,
    "currency": 0,
    "tax": 19,
    "multipleTaxes": 0,
    "multiplePositions": 1,
    "cashDiscountRate": 2.0,
    "additionalPositions": [
      {
        "detail": "<p>Beschreibung der zweiten Position, mit Dokument Steuersatz 19 %</p>",
        "quantity": 5,
        "unit": "Std.",
        "netValue": 100
      },
      {
        "detail": "<p>Beschreibung der dritten Position, mit Steuersatz 7 %</p>",
        "quantity": 1,
        "unit": "Stck.",
        "netValue": 620,
        "taxSwitch": 1,
        "tax": 7
      }
    ]
}
```


ein Fremdkostendokument bearbeiten
----------------------------------

```
PUT /api/v1/externalcosts/{id}
```


Es müssen nicht alle Parameter für eine Bearbeitung übergeben werden.

Es stehen die Parameter zum Erstellen der Ressource zur Verfügung (s.o.).

Ausnahmen:

*   Der Typ des Dokuments (type) kann nachträglich nicht verändert werden.
*   Es kann kein Dateiupload erfolgen.

*   [ProSonata](https://www.prosonata.de/ "ProSonata Agentursoftware")
*   [Infos & Hilfen](https://www.prosonata.de/infos-und-hilfen/das-team-und-die-entwicklung-einer-agentursoftware.html "Infos & Hilfen")
*   [API Beschreibung](https://www.prosonata.de/infos-und-hilfen/prosonata-api-beschreibung.html "Beschreibung der ProSonata API")
*   Fremdkosten