const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const code = fs.readFileSync(__dirname + '/../src/app.js', 'utf8');
const ctx = { console, URL, Intl, setTimeout, clearTimeout, AbortController };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx);
const T = ctx.__NS_TEST__;
assert(T, 'exports');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; };

// guessYear / firstYear / eraOf
ok(T.guessYear('12.–13. Jh.') === 1150, 'jh');
ok(T.guessYear('ca. 4000–2500 v. Chr.') === -4000, 'bc');
ok(T.guessYear('heute') === 2000, 'heute');
ok(T.guessYear('um 800') === 800, 'um 800');
ok(T.guessYear('8. Jh. v. Chr.') === -750, 'jh bc');
ok(T.firstYear('1436–1476') === 1436, 'firstYear');
ok(T.eraOf(2000) === 'gegenwart' && T.eraOf(1550) === 'neuzeit' && T.eraOf(800) === 'mittelalter' && T.eraOf(-100) === 'antike' && T.eraOf(-3500) === 'urzeit', 'era');

// wdYear / labels
ok(T.wdYear('1436-02-06T00:00:00Z') === 1436, 'wdYear');
ok(T.wdYear('+1436-02-06T00:00:00Z') === 1436, 'wdYear plus');
ok(T.wdYear('-0099-01-01T00:00:00Z') === -100, 'wdYear bc');
ok(T.wdYearLabel(1500, 7) === '15. Jh.', 'century label');
ok(T.wdYearLabel(1430, '8') === '1430er', 'decade label');
ok(T.wdYearLabel(-100, 9) === '100 v. Chr.', 'bc label');

// parseAIJSON
ok(T.parseAIJSON('```json\n{"a":1}\n```').a === 1, 'fence');
ok(T.parseAIJSON('Hier: {"a":[1,2,],} fertig').a.length === 2, 'trailing commas');
ok(T.parseAIJSON('keine daten') === null, 'null');

// normAI
const ai = T.normAI({
  kurz: 'K', zeitschichten: [
    { zeit: '8.–11. Jh.', jahr: '800', form: 'mulināri', sicherheit: 'Belegt' },
    { zeit: 'heute', form: 'Müller', sicherheit: 'wahrscheinlich' },
    { zeit: 'ca. 3500 v. Chr.', jahr: -3500, form: '*melh₂-', sicherheit: 'unsicher' },
    null, { foo: 1 }
  ],
  varianten: ['Mueller', { name: 'Möller' }, 3], regionen: ['Nord', { region: 'Süd', text: 'x' }],
  fruehePersonen: [{ name: 'A', zeit: '1436' }, { zeit: 'x' }], person: { text: 'P' }, vorfahren: 'x'
});
ok(ai.zeitschichten.length === 3, 'layers kept');
ok(ai.zeitschichten[0].form === 'Müller' && ai.zeitschichten[2].form === '*melh₂-', 'sorted newest→oldest');
ok(ai.zeitschichten[1].sicherheit === 'belegt', 'cert norm');
ok(ai.varianten.join(',') === 'Mueller,Möller', 'variants');
ok(ai.regionen.length === 2 && ai.regionen[0].region === 'Nord', 'regions');
ok(ai.fruehePersonen.length === 1 && ai.fruehePersonen[0].quelle === 'KI-Wissen', 'persons');
ok(ai.person === 'P' && Array.isArray(ai.vorfahren) && ai.vorfahren.length === 0, 'person/vorfahren');

// Wiktionary (de)
const wtDe = `== Müller ({{Sprache|Deutsch}}) ==
=== {{Wortart|Nachname|Deutsch}}, {{m}}, {{f}} ===
{{Deutsch Nachname Übersicht}}
{{Worttrennung}}
:Mül·ler
{{Bedeutungen}}
:[1] deutscher [[Familienname]]
{{Herkunft}}
:[[Berufsname]] zu [[Müller]] „Betreiber einer [[Mühle]]“<ref>{{Ref-DFD|Müller}}</ref>
{{Bekannte Namensträger}}
:[[w:Wilhelm Müller|Wilhelm Müller]], deutscher Dichter
=== {{Wortart|Substantiv|Deutsch}}, {{m}} ===
{{Herkunft}}
:{{mhd.}} ''mülnære, müllære,'' {{ahd.}} ''mulināri,'' aus spätlateinisch ''molinarius''
{{Synonyme}}
:[1] Möller
`;
const de = T.wiktDeExtract(wtDe);
ok(/Nachname · Herkunft\] Berufsname zu Müller „Betreiber einer Mühle“/.test(de), 'de herkunft name: ' + de);
ok(/mittelhochdeutsch mülnære, müllære, althochdeutsch mulināri, aus spätlateinisch molinarius/.test(de), 'de herkunft noun: ' + de);
ok(!/Möller/.test(de), 'synonyms not grabbed');

// Wiktionary (en)
const wtEn = `==German==
===Etymology===
From {{inh|de|gmh|mülnære}}, from {{inh|de|goh|mulināri}}, from {{der|de|LL.|molīnārius}}.
===Proper noun===
{{de-proper noun}}
# {{surname|de|from=occupations}}
==Swedish==
===Noun===
# something
`;
const en = T.wiktEnExtract(wtEn);
ok(/^\[German\] From mittelhochdeutsch mülnære, from althochdeutsch mulināri, from spätlateinisch molīnārius\. — \(Familienname, aus: occupations\)$/.test(en), 'en: ' + en);

// Wikipedia sections
const wp = 'Müller ist ein Familienname.\n\n== Herkunft und Bedeutung ==\nBerufsname.\n\n== Namensträger ==\n=== A ===\nAnna Müller\n\n== Weblinks ==\nx';
const pick = T.wpPick(wp, false);
ok(/Herkunft und Bedeutung\]\nBerufsname/.test(pick) && /\[A\]/.test(pick) === false, 'wpPick: ' + pick);

// SPARQL-Auswertung
const rows = [
  { p: 'http://www.wikidata.org/entity/Q1', pLabel: 'Johannes Müller', pDescription: 'Astronom', b: '1436-06-06T00:00:00Z', prec: '11', d: '1476-07-06T00:00:00Z', placeLabel: 'Königsberg in Bayern' },
  { p: 'http://www.wikidata.org/entity/Q1', pLabel: 'Johannes Müller', pDescription: 'Astronom', b: '1436-06-06T00:00:00Z', prec: '11', d: '1476-07-08T00:00:00Z', placeLabel: 'Q999' },
  { p: 'http://www.wikidata.org/entity/Q2', pLabel: 'Hans Müller', b: '1300-01-01T00:00:00Z', prec: '7' }
];
const early = T.parseEarliest(rows);
ok(early.length === 2 && early[0].id === 'Q2' && early[0].byLabel === '13. Jh.', 'earliest sort');
ok(early[1].places.length === 1 && early[1].dy === 1476, 'dedupe places');
const cents = T.parseCenturies([{ c: '14', n: '3' }, { c: '-1', n: '1' }, { n: '2' }]);
ok(cents.length === 2 && cents[0].c === -1, 'centuries');
ok(T.centLabel(14) === '15. Jh.' && T.centLabel(-1) === '1. Jh. v. Chr.', 'cent labels');

// Stammbaum
const E = id => 'http://www.wikidata.org/entity/' + id;
const trows = [
  { a: E('Q10'), aLabel: 'Kind', f: E('Q11'), m: E('Q12'), b: '1700-01-01T00:00:00Z' },
  { a: E('Q11'), aLabel: 'Vater', f: E('Q13'), m: E('Q14'), b: '1670-01-01T00:00:00Z' },
  { a: E('Q12'), aLabel: 'Mutter', f: E('Q13'), m: E('Q15'), b: '1672-01-01T00:00:00Z' },
  { a: E('Q13'), aLabel: 'Großvater', f: E('Q16'), b: '1640-01-01T00:00:00Z' },
  { a: E('Q14'), aLabel: 'Großmutter 1' },
  { a: E('Q15'), aLabel: 'Großmutter 2' },
  { a: E('Q16'), aLabel: 'Urgroßvater', b: '1600-01-01T00:00:00Z' },
  { a: E('Q16'), aLabel: 'Urgroßvater', b: '1601-01-01T00:00:00Z' }
];
const tree = T.buildWdTree(trows, 'Q10');
const st = T.treeStats(tree, 'Q10');
ok(st.count === 6, 'ancestor count ' + st.count);
ok(st.maxGen === 3, 'max gen ' + st.maxGen);
ok(st.oldest.name === 'Urgroßvater' && st.oldest.by === 1600, 'oldest');
ok(st.line.map(p => p.name).join('>') === 'Kind>Vater>Großvater>Urgroßvater', 'paternal line');
ok(st.implex === 1, 'implex ' + st.implex);
ok(st.num.get('Q16') === 8n, 'kekule');

// Namen
ok(JSON.stringify(T.splitName('Johann Sebastian Bach', 'person')) === JSON.stringify({ first: 'Johann Sebastian', last: 'Bach' }), 'split');
ok(T.splitName('Ludwig van Beethoven', 'person').first === 'Ludwig', 'particles');
ok(T.splitName('Bach, Johann', 'person').last === 'Bach', 'comma');
ok(T.capName('johann sebastian bach') === 'Johann Sebastian Bach', 'cap');
ok(T.capName('ludwig van beethoven') === 'Ludwig van Beethoven', 'cap particle');
ok(T.capName('MÜLLER') === 'Müller', 'caps');
ok(T.capName('McDonald') === 'McDonald', 'keep mixed');

// Modelle
const g = T.rankGemini(['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3.8-flash-tts', 'gemini-3-flash-preview', 'gemini-flash-latest']);
ok(g[0] === 'gemini-3.8-flash' && !g.includes('gemini-3.1-pro-preview') && !g.includes('gemini-3.8-flash-tts'), 'gemini rank ' + g.join());
const ds = T.rankDeepSeek(['deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-chat', 'deepseek-reasoner']);
ok(ds.join() === 'deepseek-flash,deepseek-chat,deepseek-v4-pro,deepseek-reasoner', 'deepseek rank ' + ds.join());
const q = T.rankGroq(['whisper-large-v3', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'groq/compound']);
ok(q[0] === 'openai/gpt-oss-120b' && q.length === 2, 'groq rank');

// Belege zusammenführen
const R = { src: { wd: { status: 'ok', bearers: early }, wt: { status: 'ok', people: [{ name: 'Hans Müller', by: 1300, url: 'https://x' }, { name: 'Peter Möller', by: 1250 }] } }, ai: { data: { fruehePersonen: [{ name: 'Johannes Müller (Regiomontanus)', zeit: '1436–1476', quelle: 'Wikipedia' }] } } };
const recs = T.collectRecords(R, true);
ok(recs.length === 3 && recs[0].name === 'Peter Möller' && recs[2].source === 'Wikidata', 'records ' + recs.map(r => r.name + r.year).join());

// Prompt & Links
const ex = JSON.parse(JSON.stringify(T.EXAMPLE));
const prompt = T.buildPrompt(ex);
ok(prompt.includes('„Müller“') && prompt.includes('Keine Live-Quellen'), 'prompt');
const links = T.linkGroups({ mode: 'person', name: 'Johann Sebastian Bach', first: 'Johann Sebastian', last: 'Bach' });
const all = links.flatMap(x => x.links.map(l => l.url));
ok(all.some(u => u === 'https://www.familysearch.org/search/record/results?q.surname=Bach&q.givenName=Johann'), 'familysearch url');
ok(all.some(u => u === 'https://www.ancestry.de/search/?name=Johann_Bach'), 'ancestry url');
ok(all.every(u => /^https:\/\//.test(u)), 'https only');
ok(T.slug('Müller-Lüdenscheidt') === 'muller-ludenscheidt', 'slug');

console.log(`${n} Prüfungen bestanden`);
