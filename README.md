# Namensspur

**Woher kommt ein Name – und wie weit reicht er zurück?**

Namensspur ist eine kostenlose, KI-gestützte Website für Namens- und Ahnenforschung. Du gibst einen Nachnamen, einen Vornamen oder eine Person ein, und die Seite verfolgt den Namen so weit wie möglich in der Zeit zurück.

**Adresse nach dem Einschalten von GitHub Pages:** https://germanclaude.github.io/DeinStammbaumisteinKreis/

## Was die Seite zeigt

- **Zeitschichten:** die Form des Namens von heute zurück bis zur ältesten sprachlichen Wurzel, zum Beispiel Mittelhochdeutsch, Latein oder die indogermanische Grundform. Jede Aussage ist als *belegt*, *wahrscheinlich* oder *unsicher* markiert und nennt ihre Quelle.
- **Früheste Belege:** die ältesten dokumentierten Namensträger aus Wikidata, WikiTree und der Deutschen Nationalbibliothek, dazu ein Diagramm nach Jahrhundert.
- **Stammbaum** (bei Personen): öffentlich dokumentierte Vorfahren mit Ahnentafel, väterlicher Linie und Ahnenliste nach Kekulé. Per Klick auf eine Person geht es weiter zurück.
- **Varianten, Verbreitung und Forschungstipps**, außerdem direkte Suchlinks zu FamilySearch, GEDBAS, CompGen, Geneanet, Kirchenbuch-Portalen und Archiven.

## GitHub Pages einschalten (einmalig)

1. Im Repository oben auf **Settings** klicken, links **Pages** wählen.
2. Unter **Build and deployment** bei **Source** die Option **Deploy from a branch** wählen.
3. Bei **Branch** `main` und den Ordner `/ (root)` auswählen, dann **Save** klicken.
4. Nach ein bis zwei Minuten ist die Seite unter der Adresse oben erreichbar. Den Link zeigt GitHub auch oben auf der Pages-Einstellungsseite an.

Die Website besteht nur aus der Datei `index.html`. Sie braucht keinen Server, keine Datenbank und keinen Build-Schritt.

## Kostenlose KI einrichten

Auf der Website oben rechts **KI & Quellen** öffnen und einen Dienst wählen:

| Dienst | Kosten | So geht's |
|---|---|---|
| **Puter** | kostenlos, ohne Schlüssel | Einfach suchen. Beim ersten Mal öffnet sich ein Fenster zur kostenlosen Puter-Anmeldung. |
| **Google Gemini** (beste Qualität) | kostenloser Schlüssel | Schlüssel unter [aistudio.google.com/apikey](https://aistudio.google.com/apikey) erstellen und einfügen. |
| **Groq** | kostenloser Schlüssel | Schlüssel unter [console.groq.com/keys](https://console.groq.com/keys) erstellen. |
| **OpenRouter** | kostenlose Modelle, rund 50 Anfragen pro Tag | Schlüssel unter [openrouter.ai/keys](https://openrouter.ai/keys) erstellen. |
| **Ollama** | kostenlos, läuft auf dem eigenen Rechner | [Ollama](https://ollama.com) installieren, ein Modell laden (z. B. `ollama pull qwen3`) und `OLLAMA_ORIGINS=https://germanclaude.github.io` setzen. |

Ist kein Schlüssel eingetragen, nutzt die Seite automatisch Puter. Schlüssel werden nur im Browser der jeweiligen Person gespeichert und direkt an den gewählten Dienst geschickt. Jede Person nutzt ihren eigenen Zugang, dir als Betreiber entstehen keine Kosten.

## Datenquellen

Alle Quellen sind frei zugänglich und werden direkt aus dem Browser abgefragt:

- [Wikipedia](https://www.wikipedia.org) und [Wiktionary](https://www.wiktionary.org): Namensartikel und Herkunftsangaben
- [Wikidata](https://www.wikidata.org): Namensträger mit Lebensdaten und öffentliche Stammbäume
- [WikiTree](https://www.wikitree.com): gemeinsamer Welt-Stammbaum
- [GND über lobid.org](https://lobid.org/gnd): Personendaten der Deutschen Nationalbibliothek
- [nationalize.io](https://nationalize.io): statistische Schätzung, in welchen Ländern ein Name heute verbreitet ist

Sollte ein Dienst Anfragen aus dem Browser blockieren, zeigt die Seite das im Abschnitt „Quellen“ an und arbeitet mit den übrigen weiter.

## Gut zu wissen

- **Privatpersonen:** Für lebende oder wenig bekannte Menschen gibt es in offenen Datenbanken in der Regel keinen Stammbaum. Die Seite erklärt dann die Namen und verlinkt auf Kirchenbücher, Archive und Stammbaum-Datenbanken für die eigene Suche.
- **KI-Texte können Fehler enthalten.** Deshalb ist jede Aussage nach ihrer Sicherheit markiert. Prüfe Details in den verlinkten Quellen.
- **Datenschutz:** Die Seite hat keinen eigenen Server, setzt keine Cookies und enthält kein Tracking. Gespeichert werden nur Einstellungen und die letzten Suchen im Browser.

## Weiterentwickeln

`index.html` ist die fertige Website. Der Quellcode liegt im Ordner `entwicklung/`:

- `entwicklung/src/body.html` – Aufbau und Gestaltung
- `entwicklung/src/app.js` – Programmlogik (Quellen, KI, Darstellung)
- `entwicklung/build.js` – baut daraus `index.html`: `node entwicklung/build.js`
- `entwicklung/test/unit.js` – Tests der Auswertungsfunktionen: `node entwicklung/test/unit.js`
- `entwicklung/test/e2e.js` – Browsertest mit nachgebildeten Diensten (braucht [Playwright](https://playwright.dev)): `node entwicklung/test/e2e.js`
