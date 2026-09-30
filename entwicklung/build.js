// Baut die Website (index.html im Hauptordner) aus entwicklung/src/.
// Aufruf: node entwicklung/build.js
// Nebenbei entsteht entwicklung/dist/artifact.html – dieselbe Seite ohne eigenes
// HTML-Grundgerüst, für die Veröffentlichung als Claude-Artifact.
const fs = require('fs');
const path = require('path');

const dev = __dirname;
const root = path.join(dev, '..');
const body = fs.readFileSync(path.join(dev, 'src/body.html'), 'utf8');
const js = fs.readFileSync(path.join(dev, 'src/app.js'), 'utf8');
if (/<\/script/i.test(js)) throw new Error('app.js darf kein </script enthalten');
const MARK = '/*__APP_JS__*/';
if (!body.includes(MARK)) throw new Error('Platzhalter für das Skript fehlt in body.html');
const page = body.replace(MARK, () => js);

fs.mkdirSync(path.join(dev, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dev, 'dist/artifact.html'), page);

// Website: Kopfteil (title, meta, link, style) in <head>, der Rest in <body>.
const split = page.indexOf('<div class="wrap">');
if (split < 0) throw new Error('<div class="wrap"> fehlt in body.html');
const head = page.slice(0, split).trim();
const rest = page.slice(split).trim();
const favicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 28">'
  + '<rect x="4" y="2" width="14" height="5" fill="#D8DFD6"/><rect x="4" y="7" width="14" height="5" fill="#BFCABC"/>'
  + '<rect x="4" y="12" width="14" height="5" fill="#9FAD99"/><rect x="4" y="17" width="14" height="4.5" fill="#66735F"/>'
  + '<rect x="4" y="21.5" width="14" height="4.5" fill="#46513F"/>'
  + '<rect x="4" y="2" width="14" height="24" rx="2" fill="none" stroke="#16201B" stroke-width="1.2"/></svg>';
const site = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0E6B5E">
<meta property="og:type" content="website">
<meta property="og:title" content="Namensspur">
<meta property="og:description" content="Woher kommt ein Name – und wie weit reicht er zurück? Kostenlose KI-Namens- und Ahnenforschung mit freien Quellen.">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(favicon)}">
${head}
</head>
<body>
${rest}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'index.html'), site);
console.log(`index.html gebaut (${Math.round(site.length / 1024)} KB)`);
