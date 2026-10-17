# Conduit Workflows

Echte App-Aufnahmen auf dem eigenen Rechner zu prüfbaren Erklärvideos und Kurzfassungen verarbeiten.

Der erste Ablauf verbindet eine lokale Videospezifikation mit einem Remotion-Renderer. Er richtet sich an Produktentwickler, die einen echten App-Ablauf als Video im Querformat, eigenständig geschnittene Kurzfassung im Hochformat und Untertitel ausgeben möchten.

Du kannst die Werkzeuge im Terminal ausführen oder deinen Coding-Agenten über [Conduit](https://tryconduit.de) damit beauftragen. Conduit verbindet dich mit dem Agenten auf deinem eigenen Rechner. Die [Conduit-Bridge](https://github.com/CommsConnectgmbh/conduit-bridge) ist ein separates Projekt.

## Produktionsablauf

Nimm die echte Anwendung auf, wähle passende Ausschnitte und formuliere Einblendungen, die zu den sichtbaren Aktionen passen. Private Aufnahmen und Ergebnisse bleiben außerhalb des Git-Arbeitsbaums. Prüfe beide Formate vor einer Veröffentlichung.

Der erste Pilot arbeitet mit Texteinblendungen ohne Sprecher. Die Videopipeline benötigt keinen Modell-API-Key. Für einen KI-Agenten, der den Ablauf vorbereitet oder ausführt, gelten die Voraussetzungen und Nutzungsbedingungen seines Anbieters.

[WORKFLOW.md](WORKFLOW.md) enthält einen Auftrag für den Agenten und die Prüfkriterien für einen vollständigen Durchlauf.

## Lizenzen

Für Remotion gelten eigene [Lizenzbedingungen](https://www.remotion.dev/docs/license/pricing). Die kostenlose Lizenz gilt für berechtigte Einzelpersonen und Organisationen; bei anderen Nutzern kann eine Firmenlizenz erforderlich sein. Dieses Repository erteilt keine Rechte an fremden Abhängigkeiten oder beigesteuerten Aufnahmen.

## Lokal ausführen

Voraussetzungen: Node.js 26.11.0 (in `.node-version` festgelegt) sowie `ffmpeg` und `ffprobe` im PATH. Im Projektordner:

```sh
npm ci
npx playwright install chromium
npm test
npm run typecheck
npm run test:e2e
npm run example -- --out ../conduit-video-example
```

Verwende für jede Aufnahme einen neuen Ausgabeordner. Das neutrale Beispiel nimmt die kleinen lokalen Seiten in `examples/neutral` auf. Der daraus erzeugte Film ist ein technisches Beispiel und zeigt kein echtes Produkt.

## Eigene Anwendung aufnehmen

Kopiere [examples/record-plan.json](examples/record-plan.json) und passe erlaubte Hosts, Bildgröße, Navigationsschritte und Maskierungen an. Die mitgelieferte Datei besucht `example.com` und benötigt kein Konto. Starte zuerst einen Probelauf und prüfe die Bilder im Unterordner `probe/`. Danach folgt die Aufnahme:

```sh
npm run record -- --plan examples/record-plan.json --out ../my-recording --probe
npm run record -- --plan examples/record-plan.json --out ../my-recording
```

Unterstützte Schritte sind `goto`, `wait`, `waitFor`, `scroll`, `followLink` und `mark`. `waitFor` und `followLink` verwenden einen Selektor oder Text; `scroll` verwendet einen Selektor oder eine vertikale Position sowie `durationMs`. Markierungen kennzeichnen Zeitpunkte in der Aufnahme. Für ein angemeldetes Demo-Konto kann `storageState` auf eine vorhandene Playwright-Sitzungsdatei außerhalb des Repos zeigen. Der Recorder liest sie und schreibt sie nicht zurück. Kontospezifische Pläne bleiben ebenfalls außerhalb von Git.

Die Aufnahme liefert `recording.mp4`, einen Kontaktbogen und `guard.json` mit Zeitmarken und blockierten Anfragen. Browseranfragen sind auf konfigurierte Hosts und GET/HEAD beschränkt. Die verfügbaren Aktionen navigieren und scrollen durch bestehende Inhalte.

## Schnitte rendern

Die eigene Spezifikation und die Aufnahmen gehören in einen separaten privaten Ordner. Das Datenformat ist in `examples/neutral/spec.json` zu sehen:

```sh
npm run render -- --spec ../private-video/spec.json --check
npm run render -- --spec ../private-video/spec.json --out ../private-video/render
```

Zeitbereiche werden in Sekunden angegeben. `long` und `short` haben getrennte Szenenlisten. Medienpfade sind relativ zum Ordner der Spezifikation; mit `--media-dir` lässt sich ein anderer Medienordner angeben.

Ein vorhandenes Browser-WebM ohne Dauer-Metadaten lässt sich vorher mit `node scripts/prepare.ts ../input.webm ../prepared.mp4` konvertieren.

## Ergebnisse und Umfang

Jeder Schnitt liefert ein H.264-MP4, SRT- und VTT-Untertitel, ein Vorschaubild, einen Kontaktbogen, Szenenbilder und einen Sprechertext. Der JSON-Bericht dokumentiert Bildgröße, Bildzahl, Bildrate, Dauer, Untertitelgrenzen und die gemessenen Laufzeiten der Verarbeitungsschritte.

Aufnahmeplan, Schnittplan und Texte sind ausdrückliche Eingaben. Der erste Pilot beginnt mit vorbereiteten Aufnahmen und einer geschriebenen Spezifikation. Conduit stellt die Verbindung zum Coding-Agenten her, der die lokalen Befehle ausführt. Der Ablauf lässt sich auch direkt im Terminal starten.

Die Integrationstests prüfen mit echtem Chromium und FFmpeg die Aufnahmegeometrie, das blickdichte Ausblenden von DOM-Inhalten, Schnittgrenzen, Untertitelzeiten und den Erhalt vorhandener Ergebnisse. Die DOM-Maskierung erfasst konfigurierte Elemente und passende Texte. Bildpixel und Canvas-Inhalte brauchen eine gesonderte Sichtprüfung.
