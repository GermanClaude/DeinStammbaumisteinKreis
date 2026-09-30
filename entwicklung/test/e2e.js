// End-to-End-Test mit nachgebildeten Antworten aller Dienste (kein Internet im Container).
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Testet die fertige Website (index.html im Hauptordner). Aufruf: NODE_PATH=$(npm root -g) node entwicklung/test/e2e.js
const site = path.join(__dirname, '../..');
const shots = path.join(__dirname, '../shots');
fs.mkdirSync(shots, { recursive: true });
const server = http.createServer((req, res) => {
  const f = path.join(site, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});

const E = id => 'http://www.wikidata.org/entity/' + id;
const ent = (id, label, desc, claims = {}, sitelinks = {}) => ({ id, labels: { de: { value: label } }, descriptions: { de: { value: desc } }, claims, sitelinks });
const item = id => [{ mainsnak: { datavalue: { value: { id } } } }];
const time = t => [{ mainsnak: { datavalue: { value: { time: t, precision: 11 } } } }];
const ENTS = {
  Q1: ent('Q1', 'Müller', 'Familienname', { P31: item('Q101352'), P460: item('Q2') }, { dewiki: { title: 'Müller (Familienname)' }, enwiki: { title: 'Müller (surname)' } }),
  Q2: ent('Q2', 'Mueller', 'Familienname'),
  Q3: ent('Q3', 'Bach', 'Familienname', { P31: item('Q101352') }, { dewiki: { title: 'Bach (Familienname)' } }),
  Q1339: ent('Q1339', 'Johann Sebastian Bach', 'deutscher Komponist', { P31: item('Q5'), P569: time('+1685-03-31T00:00:00Z'), P570: time('+1750-07-28T00:00:00Z'), P22: item('Q100') }, { dewiki: { title: 'Johann Sebastian Bach' } }),
  Q77: ent('Q77', 'Johann Christoph Bach', 'Organist', { P31: item('Q5'), P569: time('+1642-12-06T00:00:00Z') })
};
const WP_PAGES = {
  'Müller (Familienname)': 'Müller ist ein deutscher Familienname.\n\n== Herkunft und Bedeutung ==\nBerufsname für den Müller.\n\n== Varianten ==\nMöller, Miller.\n\n== Namensträger ==\n=== A ===\nAnna Müller (1900–1980), Malerin',
  'Müller (surname)': 'Müller is a common German surname.\n\n== Etymology ==\nFrom Middle High German mülnære.',
  'Johann Sebastian Bach': 'Johann Sebastian Bach war ein deutscher Komponist.\n\n== Leben ==\n=== Herkunft ===\nBach stammte aus einer thüringischen Musikerfamilie.',
  'Bach (Familienname)': 'Bach ist ein Familienname.\n\n== Herkunft ==\nWohnstättenname zu mhd. bach.'
};
const WIKT = {
  'de:Müller': `== Müller ({{Sprache|Deutsch}}) ==\n=== {{Wortart|Nachname|Deutsch}}, {{m}} ===\n{{Herkunft}}\n:[[Berufsname]] zu [[Müller]] „Betreiber einer Mühle“\n{{Synonyme}}\n:x`,
  'en:Müller': `==German==\n===Etymology===\nFrom {{inh|de|gmh|mülnære}}.\n===Proper noun===\n# {{surname|de|from=occupations}}`
};
const EARLY = [
  { p: E('Q501'), pLabel: 'Hans Müller', pDescription: 'Ratsherr', b: '1301-01-01T00:00:00Z', prec: '7' },
  { p: E('Q502'), pLabel: 'Johannes Müller', pDescription: 'Astronom', b: '1436-06-06T00:00:00Z', prec: '11', d: '1476-07-06T00:00:00Z', placeLabel: 'Königsberg in Bayern' },
  { p: E('Q503'), pLabel: 'Johannes von Müller', pDescription: 'Historiker', b: '1752-01-03T00:00:00Z', prec: '11', d: '1809-05-29T00:00:00Z', placeLabel: 'Schaffhausen' }
];
const CENTS = [[13, 2], [14, 5], [15, 11], [16, 23], [17, 64], [18, 180], [19, 820], [20, 1450]].map(([c, n]) => ({ c: String(c), n: String(n) }));
const ANC = [
  ['Q1339', 'Johann Sebastian Bach', 'Q100', 'Q101', 1685, 1750],
  ['Q100', 'Johann Ambrosius Bach', 'Q102', 'Q103', 1645, 1695],
  ['Q101', 'Maria Elisabeth Lämmerhirt', 'Q104', null, 1644, 1694],
  ['Q102', 'Christoph Bach', 'Q105', null, 1613, 1661],
  ['Q103', 'Maria Magdalena Grabler', null, null, 1614, 1661],
  ['Q104', 'Valentin Lämmerhirt', null, null, null, 1665],
  ['Q105', 'Johannes Bach', 'Q106', null, 1580, 1626],
  ['Q106', 'Veit Bach', null, null, 1550, 1619]
].map(([a, l, f, m, b, d]) => ({ a: E(a), aLabel: l, ...(f ? { f: E(f) } : {}), ...(m ? { m: E(m) } : {}), ...(b ? { b: `${b}-01-01T00:00:00Z` } : {}), ...(d ? { d: `${d}-01-01T00:00:00Z` } : {}) }));
const AI_NAME = {
  name: 'Müller', kurz: 'TEST-KI: Müller ist ein Berufsname für den Betreiber einer Mühle.', bedeutung: 'Müller', namenstyp: 'Berufsname', sprachraum: 'Deutsch', aeltesteWurzel: '*melh₂- (Indogermanisch)',
  zeitschichten: [
    { zeit: 'heute', jahr: 2024, form: 'Müller', sprache: 'Neuhochdeutsch', text: 'Häufigster Name.', sicherheit: 'belegt', quelle: 'Wikipedia' },
    { zeit: '16. Jh.', jahr: 1550, form: 'Molitor', sprache: 'Humanistenlatein', text: 'Latinisiert.', sicherheit: 'belegt', quelle: 'KI-Wissen' },
    { zeit: '13. Jh.', jahr: 1250, form: 'mülnære', sprache: 'Mittelhochdeutsch', text: 'Beiname.', sicherheit: 'wahrscheinlich', quelle: 'Wiktionary' },
    { zeit: '4. Jh.', jahr: 350, form: 'molinarius', sprache: 'Spätlatein', text: 'Müller.', sicherheit: 'belegt', quelle: 'Wiktionary' },
    { zeit: 'ca. 3500 v. Chr.', jahr: -3500, form: '*melh₂-', sprache: 'Indogermanisch', text: 'Wurzel.', sicherheit: 'unsicher', quelle: 'KI-Wissen' }
  ],
  varianten: ['Mueller', 'Möller'], verwandt: ['Mühlmann'], regionen: [{ region: 'Norddeutschland', text: 'Möller' }],
  fruehePersonen: [{ name: 'Johannes Müller (Regiomontanus)', zeit: '1436–1476', info: 'Astronom', quelle: 'Wikipedia' }],
  person: '', vorfahren: [], wissenswertes: ['Polygenetischer Name.'], forschungstipps: ['Mit Ort suchen.'], hinweis: 'Test.'
};
const AI_PERSON = { ...AI_NAME, name: 'Bach', kurz: 'TEST-KI: Bach ist ein Wohnstättenname.', person: 'Die Bachs waren eine thüringische Musikerfamilie.', zeitschichten: AI_NAME.zeitschichten.slice(0, 3).map(z => ({ ...z, form: z.form.replace(/Müller|Molitor|mülnære/, 'Bach') })) };

let aiCalls = 0, lastPrompt = '';
function handle(url, req) {
  const h = url.hostname, p = url.searchParams;
  if (h === 'www.wikidata.org') {
    if (p.get('list') === 'search') {
      const s = p.get('srsearch') || '';
      if (s.startsWith('Müller haswbstatement')) return { query: { search: [{ title: 'Q1' }] } };
      if (s.startsWith('Bach haswbstatement')) return { query: { search: [{ title: 'Q3' }] } };
      return { query: { search: [] } };
    }
    if (p.get('action') === 'wbgetentities') { const out = {}; for (const id of p.get('ids').split('|')) if (ENTS[id]) out[id] = ENTS[id]; return { entities: out }; }
    if (p.get('action') === 'wbsearchentities') return { search: p.get('search') === 'Johann Sebastian Bach' ? [{ id: 'Q1339' }, { id: 'Q77' }] : [] };
  }
  if (h === 'query.wikidata.org') {
    const q = p.get('query') || '';
    if (q.includes('(wdt:P22|wdt:P25)*')) return { results: { bindings: ANC.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { value: v }]))) } };
    const wrap = rows => ({ results: { bindings: rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { value: v }]))) } });
    if (q.includes('MIN(?bt)')) return wrap(EARLY);
    if (q.includes('FLOOR')) return wrap(CENTS);
    if (q.includes('?place ?placeLabel')) return wrap([{ place: E('Q64'), placeLabel: 'Berlin', n: '41' }, { place: E('Q1055'), placeLabel: 'Hamburg', n: '22' }]);
    if (q.includes('COUNT(DISTINCT ?p)')) return wrap([{ n: '2911' }]);
  }
  if (/wikipedia\.org$/.test(h)) {
    const titles = (p.get('titles') || '').split('|');
    if (p.get('prop') === 'extracts') return { query: { pages: [{ title: titles[0], extract: WP_PAGES[titles[0]] || '' }] } };
    return { query: { pages: titles.map(t => WP_PAGES[t] ? { title: t, fullurl: `https://${h}/wiki/${encodeURIComponent(t)}` } : (t === 'Müller' ? { title: t, fullurl: 'x', pageprops: { disambiguation: '' } } : { title: t, missing: true })) } };
  }
  if (/wiktionary\.org$/.test(h)) {
    const key = `${h.split('.')[0]}:${p.get('page')}`;
    return WIKT[key] ? { parse: { title: p.get('page'), wikitext: WIKT[key] } } : { error: { code: 'missingtitle', info: 'missing' } };
  }
  if (h === 'api.wikitree.com') {
    if (p.get('action') === 'searchPerson') {
      if (p.get('FirstName')) return [{ status: 0, total: 1, matches: [{ Id: 123, Name: 'Bach-1', FirstName: 'Johann', MiddleName: 'Sebastian', LastNameAtBirth: 'Bach', BirthDate: '1685-03-31', DeathDate: '1750-07-28', BirthLocation: 'Eisenach' }] }];
      return [{ status: 0, total: 250, matches: [{ Id: 9, Name: 'Moller-9', FirstName: 'Peter', LastNameAtBirth: 'Möller', BirthDate: '1289-00-00', BirthLocation: 'Lübeck' }, { Id: 10, Name: 'Müller-1', FirstName: 'Anna', LastNameAtBirth: 'Müller', BirthDate: '1610-00-00', DeathDate: '1670-00-00' }] }];
    }
  }
  if (h === 'lobid.org') return { totalItems: 5400, member: [{ gndIdentifier: '1', preferredName: 'Müller, Konrad', dateOfBirth: ['1350'], placeOfBirth: [{ label: 'Nürnberg' }], professionOrOccupation: [{ label: 'Kaufmann' }], id: 'https://d-nb.info/gnd/1' }] };
  if (h === 'api.nationalize.io') return { count: 5000, name: p.get('name'), country: [{ country_id: 'DE', probability: 0.62 }, { country_id: 'CH', probability: 0.12 }, { country_id: 'AT', probability: 0.07 }] };
  if (h === 'generativelanguage.googleapis.com') {
    if (req.method() === 'GET') return { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] }] };
    aiCalls++;
    const body = JSON.parse(req.postData() || '{}');
    lastPrompt = body.contents[0].parts[0].text;
    const isPerson = lastPrompt.includes('Person „Johann Sebastian Bach“');
    return { candidates: [{ content: { parts: [{ text: JSON.stringify(isPerson ? AI_PERSON : AI_NAME) }] }, finishReason: 'STOP' }] };
  }
  return null;
}

(async () => {
  await new Promise(r => server.listen(8765, r));
  const browser = await chromium.launch();
  const errors = [];
  const run = async (opts, fn) => {
    const context = await browser.newContext(opts);
    await context.addInitScript(() => localStorage.setItem('namensspur.cfg.v1', JSON.stringify({ provider: 'auto', keys: { gemini: 'TESTKEY' } })));
    await context.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.hostname === 'localhost') return route.continue();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/css' }, body: '' });
      const body = handle(url, req);
      if (body === null) return route.fulfill({ status: 404, headers: cors, body: 'nicht gefunden' });
      await new Promise(r => setTimeout(r, 40));
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('http://localhost:8765/index.html');
    try { await fn(page); } finally { await context.close(); }
  };

  // 1) Desktop hell: Beispiel, dann Nachnamen-Suche
  await run({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' }, async page => {
    const layers = await page.locator('#strata .layer').count();
    if (layers !== 7) throw new Error('Beispiel-Schichten: ' + layers);
    await page.screenshot({ path: `${shots}/1-beispiel-desktop.png`, fullPage: false });
    await page.click('#btnGo');
    await page.waitForSelector('text=TEST-KI: Müller ist ein Berufsname', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('#btnGo').disabled, null, { timeout: 20000 });
    const checks = await page.evaluate(() => ({
      layers: document.querySelectorAll('#strata .layer').length,
      eras: [...document.querySelectorAll('#strata .layer')].map(l => l.className.replace('layer ', '')),
      bars: document.querySelectorAll('#centChart .bar').length,
      rows: document.querySelectorAll('#recTable tbody tr').length,
      firstRow: document.querySelector('#recTable tbody tr')?.innerText,
      facts: document.querySelector('#resFacts')?.innerText,
      sources: document.querySelectorAll('#sources .srclist li').length,
      failed: [...document.querySelectorAll('#sources .state.fail')].map(x => x.closest('li').innerText),
      variants: document.querySelector('#variants')?.innerText,
      spread: document.querySelector('#spread')?.innerText,
      log: document.querySelector('#log')?.innerText,
      badge: !document.querySelector('#resBadge').hidden
    }));
    console.log(JSON.stringify(checks, null, 1));
    if (checks.layers !== 5 || checks.bars !== 8 || checks.rows < 5 || checks.sources !== 8 || checks.failed.length || checks.badge) throw new Error('Nachname-Prüfung fehlgeschlagen');
    if (!/Peter Möller/.test(checks.firstRow)) throw new Error('Sortierung der Belege');
    await page.screenshot({ path: `${shots}/2-ergebnis-desktop.png`, fullPage: true });
  });

  // 2) Handy dunkel: Personensuche mit Stammbaum
  await run({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 }, async page => {
    await page.check('#modePerson', { force: true });
    await page.fill('#nameInput', 'johann sebastian bach');
    await page.click('#btnGo');
    await page.waitForSelector('text=TEST-KI: Bach ist ein Wohnstättenname', { timeout: 20000 });
    await page.waitForSelector('.pedigree', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('#btnGo').disabled, null, { timeout: 20000 });
    const t = await page.evaluate(() => ({
      name: document.querySelector('#resName').innerText,
      cards: document.querySelectorAll('.pedigree .pcard').length,
      filled: document.querySelectorAll('.pedigree .pcard:not(.empty)').length,
      line: [...document.querySelectorAll('.line li b')].map(b => b.innerText),
      facts: document.querySelector('#treeBody .facts')?.innerText,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      know: document.querySelector('#know')?.innerText
    }));
    console.log(JSON.stringify(t, null, 1));
    if (t.name !== 'Johann Sebastian Bach' || t.cards !== 15 || t.line.length !== 5 || t.overflow) throw new Error('Personen-Prüfung fehlgeschlagen');
    if (!lastPrompt.includes('Väterliche Linie: Johann Sebastian Bach')) throw new Error('Stammbaum fehlt im Prompt');
    await page.screenshot({ path: `${shots}/3-person-handy-dunkel.png`, fullPage: true });
    await page.click('.pedigree button.pcard >> text=Christoph Bach');
    const re = await page.evaluate(() => ({ root: document.querySelector('.pcard.root .n').innerText, back: !!document.querySelector('[data-act="treeRoot"].linkbtn') }));
    if (re.root !== 'Christoph Bach' || !re.back) throw new Error('Neu-Verwurzeln');
    console.log('reroot ok', JSON.stringify(re));
  });

  // 3) Claude-Ansicht nachgebildet: KI über sample, keine externen Datenabfragen
  {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    const external = [];
    await context.addInitScript(json => {
      const sample = async (prompt, opts) => { opts.onText && opts.onText({ text: json.slice(0, 20), delta: json.slice(0, 20) }); return { text: json, truncated: false, modelTierApplied: opts.modelTier || 'default' }; };
      window.claude = { use: async name => name === 'sample' ? sample : name === 'downloads' ? { save: async () => ({ status: 'saved' }) } : null };
    }, JSON.stringify({ ...AI_NAME, kurz: 'CLAUDE-TEST: Nowak ist polnisch.', name: 'Nowak' }));
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname !== 'localhost' && !/fonts\./.test(u.hostname)) external.push(u.hostname);
      if (u.hostname === 'localhost') return route.continue();
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/css' }, body: '' });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push('pageerror(claude): ' + e.message));
    await page.goto('http://localhost:8765/index.html');
    await page.fill('#nameInput', 'Nowak');
    await page.click('#btnGo');
    await page.waitForSelector('text=CLAUDE-TEST: Nowak ist polnisch.', { timeout: 15000 });
    await page.click('#btnSettings');
    const c = await page.evaluate(() => ({ env: !document.querySelector('#envNote').hidden, dl: !document.querySelector('#btnDownload').hidden, status: document.querySelector('#aiStatus').innerText, layers: document.querySelectorAll('#strata .layer').length, prov: document.querySelector('#provSel').value }));
    console.log('claude', JSON.stringify(c), 'extern:', external.length);
    if (!c.env || !c.dl || c.layers !== 5 || c.prov !== 'claude' || external.length) throw new Error('Claude-Ansicht fehlgeschlagen');
    await context.close();
  }

  console.log('KI-Aufrufe:', aiCalls, '| Fehler:', errors.length ? errors : 'keine');
  await browser.close();
  server.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.error('FEHLER', e); server.close(); process.exit(1); });
