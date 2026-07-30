# API Grundlagen | ProSonata Agentursoftware
Die ProSonata API ist ein [RESTful Webservice](https://de.wikipedia.org/wiki/Representational_State_Transfer), bei dem jede Ressource über eine eindeutige URI angesprochen wird.  
Die HTTP-Methoden bestimmen dabei, welche Operationen mit einer Ressource ausgeführt werden:

*   GET: Ressource lesen
*   POST: Ressource erstellen
*   PUT: Ressource bearbeiten
*   DELETE: Ressource löschen (nur für einzelne Ressourcen verfügbar)

Sicherheit
----------

Der Zugriff auf die ProSonata API kann und sollte immer **verschlüsselt** über eine **https-Verbindung** erfolgen. So ist sichergestellt, dass keine Daten und insbesondere der API-Key im Klartext übertragen und mitgelesen werden können.

Zugriff auf die API
-------------------

Der Zugriff auf die ProSonata API erfolgt über die URL

```
https://{subdomain}.prosonata.software/api/v1/{ressource}[/{id}]
```




* Parameter: {subdomain}
  * Bedeutung: die Subdomain des ProSonata Accounts
* Parameter: {ressource}
  * Bedeutung: die Ressource, auf die zugegriffen werden soll (Aufruf ohne /{id} für Listen (GET) und Anlegen einer neuen Ressource (POST))
* Parameter: {id}
  * Bedeutung: optionale ID für Abfrage und Bearbeitung einer konkreten Ressource (für GET, PUT, DELETE)


Datenformat
-----------

Die ProSonata API nutzt als Datenformat für schreibende und lesende Requests das **JSON-Format**. Der **Zeichensatz** ist immer **UTF-8**.

**JSONP** wird ebenfalls unterstützt. Dafür muss der Parameter _jsonp_ angegeben werden, welcher optional den Namen der Callback-Funktion enthält. Die Standard-Callback-Funktion lautet _callback_.

```
https://{subdomain}.prosonata.software/api/v1/{ressource}?jsonp[=callback]
```


Authentifizierung
-----------------

Die Authentifizierung kann auf zwei Wegen geschehen:

**1\. Über den ProSonata Benutzer**  
Benutzer der Rechtestufe »Administrator« können im Bereich > Benutzer einzelnen Mitarbeitern den Zugriff freischalten. Anschließend muss jeweils ein persönlicher API-Key generiert werden. Dieser Key ist für jeden Zugriff auf die API zwingend erforderlich, weil API-Zugriffe zustandslos sind – es werden keine Sitzungen/Sessions gespeichert.

**Bitte kopieren bzw. notiere dir den generierten API-Key** – dieser wird als Hash in der Datenbank gespeichert und kann nachträglich in ProSonata nicht mehr erneut angezeigt werden! Du kannst aber bei Bedarf einen neuen Key generieren. Für den Zugriff auf die einzelnen Ressourcen gelten **die Rechte**, die dem jeweiligen Benutzer über die **Benutzergruppe** zugewiesen wurden. So kann zum Beispiel nur die Benutzergruppe »Administrator« auf die _Benutzer_ des Systems (Ressource _users_) zugreifen.

Der API-Schlüssel kann auf zwei Arten übermittelt werden. Per GET-Parameter

```
https://{subdomain}.prosonata.software/api/v1/{ressource}?apiKey=diesIstDerKey
```


oder im Header der Anfrage

```
curl -H 'X-API-Key: diesIstDerKey' 
https://{subdomain}.prosonata.software/api/v1/{ressource}
```


**2\. Über eine App-Integration**  
Um einen auf einzelne Endpunkte der API steuerbaren Zugriff für einzelne Apps zu erhalten, lassen sich Integrationen unter > System > Integrationen einrichten. Hierbei wird eine App-ID und ein API-Key generiert. Diese sind für den Zugriff auf die API zwingend erforderlich. Der Zugriff der Integrationen/Apps ist unabhängig von den Benutzern.

**Bitte kopiere bzw. notiere dir den generierten API-Key** – dieser wird als Hash in der Datenbank gespeichert und kann nachträglich in ProSonata nicht mehr erneut angezeigt werden! Du kannst aber bei Bedarf einen neuen Key generieren. Für den Zugriff auf die einzelnen Ressourcen gelten die vollen **Rechte**.

Die App-ID und der API-Schlüssel können auf zwei Arten übermittelt werden. Per GET-Parameter

```
https://{subdomain}.prosonata.software/api/v1/{ressource}?appID=12345&apiKey=diesIstDerKey
```


oder im Header der Anfrage

```
curl -H 'X-API-Key: diesIstDerKey' 
-H 'X-APP-ID: 12345'
https://{subdomain}.prosonata.software/api/v1/{ressource}
```


Aufbau der Antworten
--------------------

Die von der API gelieferten Antworten bestehen aus den Bereichen »meta« für die Metadaten und »data« für die eigentlichen angefragten Daten der Ressource.

```
{
  "meta": {
    "status": 200,
    "perPage": 100,
    "page": 1,
    "totalCount": 7,
    "apiLimitRemaining": 498,
    "apiLimitReset": 612
  }
  "data": [
    {
      "userID": 1,
      "username": "Max",
      "userFirstName": "Max",
      "userLastName": "Mustermann",
      "email": "max@mustersite.de",
      "userPhone": "069 12345678"
    },
    …
  ]
}
```


Die **Metadaten** beinhalten immer nochmals den HTTP-Statuscode. Ressourcenlisten bieten weitergehende Informationen, wie die ausgegebenen Ergebnisse pro Seite (_perPage_), die Seitenzahl (_page_) und die Gesamtanzahl der Ergebnisse (_totalCount_) der Anfrage.

Der **Datenteil** listet die Felder mit den jeweiligen Inhalten auf.

Zugriffsbegrenzung
------------------

Die Anzahl der API-Aufrufe ist begrenzt. Die Begrenzung bezieht sich immer auf **Zeitintervalle von 15 Minuten**. Wird ein neues Zeitintervall erreicht, steht ein neues Kontingent zur Verfügung. Nicht verbrauchte Aufrufe können nicht angespart und übertragen werden. Das Kontingent richtet sich nach dem gebuchten ProSonata Paket und ist aktuell wie folgt gesetzt:


|Paket       |Limit pro 15 Min.|
|------------|-----------------|
|ProSonata 1 |50               |
|ProSonata 3 |100              |
|ProSonata 5 |200              |
|ProSonata 10|300              |
|ProSonata 20|500              |


Jeder Aufruf liefert in den Metadaten zwei Felder zum aktuellen Limit mit:

_apiLimitRemaining_: die Anzahl der noch zur Verfügung stehenden Aufrufe im Zeitintervall  
_apiLimitReset_: Zeitpunkt in Sekunden, ab dem ein neues Zeitintervall startet

Wird innerhalb eines Intervalls die maximale Anzahl an Aufrufen überschritten, wird der HTTP-Fehlercode 429 zurückgeliefert. Die Fehlermeldung gibt Auskunft darüber, ab wann (in Sekunden) erneut auf die API zugegriffen werden kann.

Sollten die zur Verfügung stehenden Anfragen pro Zeitintervall nicht ausreichen, [kontaktier uns bitte](https://www.prosonata.de/kontakt.html). Wir finden in diesem Fall sicher eine Lösung.

Paginierung
-----------

Beim **lesenden Zugriff** (GET) kann die Anzahl der Datensätze per Request über den Parameter _perPage_ angegeben werden. Die einzelnen Seiten können mit dem Parameter _page_ abgefragt werden:

```
https://{subdomain}.prosonata.software/api/v1/{ressource}?perPage=100&page=2
```


Standardmäßig werden 100 Datensätze pro Seite (_perPage_) ausgegeben. Maximal können 1000 Datensätze zurückgegeben werden.

Filterung/Suche
---------------

Beim **lesenden Zugriff** (GET) können gezielt einzelne Felder/Parameter für eine Suche bzw. Filterung genutzt werden. Die zur Verfügung stehenden Parameter sind bei den einzelnen Ressourcen aufgelistet.

Beispiel: Suche nach dem Benutzer mit dem Benutzernamen »Max«:

```
https://{subdomain}.prosonata.software/api/v1/users?username=Max
```


Sortierung
----------

Über den optionalen Parameter _orderBy_ kann beim **lesenden Zugriff** (GET) eine Sortierreihenfolge vorgegeben werden. Eine Sortierung besteht aus dem Namen des Feldes und der Sortierrichtung (analog dem SQL Befehl: _ASC_ für aufstiegende bzw. _DESC_ für absteigende Sortierung). Wird keine Sortierrichtung angegeben, wird aufsteigend _ASC_ sortiert.

Es können mehrere Sortierreihenfolgen berücksichtigt werden, indem diese kommasepariert in der Anfrage mitgegeben werden.

Beispiel: Auflistung der Benutzer nach Benutzername in umgekehrter Reihenfolge:

```
https://{subdomain}.prosonata.software/api/v1/users?orderBy=username+DESC
```


Daten schreiben, bearbeiten und löschen
---------------------------------------

Mit den HTTP-Methoden POST, PUT und DELETE werden Daten geschrieben bzw. bearbeitet und gelöscht.

Da für diesen Zugriff auch das JSON-Format gilt, sollte im Header des Requests der Datentyp »Content-Type: application/json« vorhanden sein:

Beispiel: **Erzeugen** eines neuen Projekts per **POST**\-Request (hier ohne Body mit dem JSON Datenteil):

```
curl -v -X POST
-H 'X-API-Key: diesIstDerKey'
-H 'Content-Type: application/json'
https://{subdomain}.prosonata.software/api/v1/projects
```


Der Request erzeugt ein neues Projekt – der Body muss selbstverständlich die je nach Ressource notwendigen Daten im JSON-Format enthalten. Als Antwort kommt der Status _201 Created_ und die Antwort enthält im Body nochmals das komplette neue Objekt.

Eine bereits vorhandene Ressource (hier Projekt mit der ID 12) wird per **PUT**\-Request **bearbeitet** (hier ohne Body mit dem JSON Datenteil):

```
curl -v -X PUT
-H 'X-API-Key: diesIstDerKey'
-H 'Content-Type: application/json'
https://{subdomain}.prosonata.software/api/v1/projects/12
```


Bei erfolgreicher Bearbeitung kommt als Antwort der Status _200 OK_ zurück und die Antwort enthält im Body nochmals das komplette Objekt. Bei einem PUT müssen nicht zwingend alle Parameter im Body übertragen werden – auf diesem Weg können auch nur einzelne Parameter einer Ressource geändert werden.

Eine Ressource (hier Projekzeit mit der ID 16) wird per **DELETE**\-Request **gelöscht**:

```
curl -v -X DELETE
-H 'X-API-Key: diesIstDerKey'
https://{subdomain}.prosonata.software/api/v1/projecttimes/16
```


Weitere Daten sind im Header oder Body beim Löschen nicht notwendig. Bei erfolgreicher Löschung kommt als Antwort der Status _200 OK_ zurück.

Fehler
------

Treten Fehler bei der Bearbeitung eines Requests auf, wird mit einem passenden HTTP-Statuscode geantwortet. Ebenso sind im Body nochmals Metadaten im JSON-Format enthalten, die neben dem Status ggf. auch eine ergänzende _message_ enthalten, die bei der Fehlersuche hilfreich sein sollte.

```
{
  "meta": {
    "status": 404,
    "message": "Data not found.",
    "requestUserID": 1,
    "usergroupName": "Administrator",
    "apiLimitRemaining": 493,
    "apiLimitReset": 583
  },
  "data": [
  ]
}
```
