(() => {
'use strict';

/* ================================================================
   Grundlagen
   ================================================================ */
const HAS_WINDOW = typeof window !== 'undefined';
const IS_CLAUDE = HAS_WINDOW && !!(window.claude && typeof window.claude.use === 'function');
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const clip = (s, n) => {
  s = String(s ?? '').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const i = cut.lastIndexOf(' ');
  return (i > n * 0.6 ? cut.slice(0, i) : cut) + ' …';
};
const qs = o => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase().replace(/\s+/g, ' ').trim();
const slug = s => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const uniqBy = (arr, key = x => fold(x)) => {
  const seen = new Set();
  return arr.filter(x => { const k = key(x); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};
const nf = n => Number(n).toLocaleString('de-DE');
const PARTICLES = /^(von|van|de|der|den|zu|vom|zum|ter|ten|du|da|di|le|la|del|dos|das|y)$/;
const capName = s => (s && (s === s.toLowerCase() || (s === s.toUpperCase() && s.length > 3)))
  ? s.toLowerCase().split(/(\s+|-)/).map((w, i) => (i > 0 && PARTICLES.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('')
  : s;
const toNum = v => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? Math.round(n) : null; };

/* Jahreszahlen */
function fmtYear(y) {
  if (y == null || !Number.isFinite(y)) return '';
  return y < 0 ? `${-y} v. Chr.` : String(y);
}
const lifespan = (b, d) => (b != null || d != null) ? `${b != null ? fmtYear(b) : '?'}–${d != null ? fmtYear(d) : ''}` : '';
/* Wikidata liefert astronomische Jahre (0 = 1 v. Chr.) */
function wdYear(v) {
  if (!v) return null;
  const m = String(v).match(/^([+-]?)(\d{1,6})-/);
  if (!m) return null;
  let y = parseInt(m[2], 10) * (m[1] === '-' ? -1 : 1);
  if (!Number.isFinite(y)) return null;
  if (y <= 0) y = y - 1;
  return y;
}
function wdYearLabel(y, prec) {
  if (y == null) return '';
  const p = prec == null ? 9 : Number(prec);
  if (p <= 6) return `ca. ${fmtYear(y)}`;
  if (p === 7) { const c = y > 0 ? Math.floor((y - 1) / 100) + 1 : Math.floor((-y - 1) / 100) + 1; return `${c}. Jh.${y < 0 ? ' v. Chr.' : ''}`; }
  if (p === 8) return `${fmtYear(y)}er`;
  return fmtYear(y);
}
function guessYear(z) {
  if (!z) return null;
  const s = String(z).toLowerCase();
  const bc = /v\.\s*chr|v\.\s*u\.\s*z|\bbc\b|\bbce\b|vor christus/.test(s);
  if (/heute|gegenwart|modern|aktuell/.test(s)) return 2000;
  let m = s.match(/(\d{1,2})\.\s*(?:[–-]\s*\d{1,2}\.\s*)?(?:jh|jahrh)/);
  if (m) { const c = parseInt(m[1], 10); return bc ? -(c * 100) + 50 : (c - 1) * 100 + 50; }
  m = s.match(/(\d{3,4})/);
  if (m) { const y = parseInt(m[1], 10); return bc ? -y : y; }
  return null;
}
const firstYear = z => {
  const s = String(z || '');
  const m = s.match(/(\d{3,4})/);
  if (!m) return guessYear(s);
  const y = parseInt(m[1], 10);
  return /v\.\s*chr/i.test(s) ? -y : y;
};
const ERA = { gegenwart: 'Gegenwart', neuzeit: 'Neuzeit', mittelalter: 'Mittelalter', antike: 'Antike', urzeit: 'Vorgeschichte' };
function eraOf(y) {
  if (y == null) return 'neuzeit';
  if (y >= 1900) return 'gegenwart';
  if (y >= 1500) return 'neuzeit';
  if (y >= 500) return 'mittelalter';
  if (y >= -800) return 'antike';
  return 'urzeit';
}
function coreYearHTML(y) {
  if (y == null) return '';
  if (y >= 1950) return 'heute';
  if (y < 0) return `${-y}<small>v. Chr.</small>`;
  return String(y);
}

/* ================================================================
   Netzwerk
   ================================================================ */
let runCtl = null;
let runId = 0;
class Cancelled extends Error { constructor() { super('Abgebrochen'); this.cancelled = true; } }
const httpHint = s => ({ 400: ' – Anfrage abgelehnt', 401: ' – Schlüssel ungültig', 402: ' – Guthaben nötig', 403: ' – kein Zugriff', 404: ' – nicht gefunden', 413: ' – Anfrage zu groß', 429: ' – Limit erreicht, später erneut versuchen', 500: ' – Serverfehler', 502: ' – Server nicht erreichbar', 503: ' – Dienst überlastet' })[s] || '';

async function fetchJSON(url, { timeout = 25000, method = 'GET', headers, body } = {}) {
  const ctl = new AbortController();
  const outer = runCtl ? runCtl.signal : null;
  if (outer && outer.aborted) throw new Cancelled();
  const onAbort = () => ctl.abort();
  if (outer) outer.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  try {
    let r, txt;
    try {
      r = await fetch(url, { method, headers, body, signal: ctl.signal, credentials: 'omit' });
      txt = await r.text();
    } catch (e) {
      if (outer && outer.aborted) throw new Cancelled();
      if (timedOut) throw new Error('Zeitüberschreitung');
      throw new Error('nicht erreichbar (Netzwerk oder Browser-Sperre)');
    }
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}${httpHint(r.status)}`);
      e.status = r.status; e.body = txt.slice(0, 800);
      throw e;
    }
    try { return JSON.parse(txt); }
    catch { const e = new Error('Antwort war kein JSON'); e.body = txt.slice(0, 300); throw e; }
  } finally {
    clearTimeout(t);
    if (outer) outer.removeEventListener('abort', onAbort);
  }
}
function withAbort(promise) {
  const outer = runCtl ? runCtl.signal : null;
  if (!outer) return promise;
  return new Promise((res, rej) => {
    if (outer.aborted) return rej(new Cancelled());
    const on = () => rej(new Cancelled());
    outer.addEventListener('abort', on, { once: true });
    promise.then(v => { outer.removeEventListener('abort', on); res(v); }, e => { outer.removeEventListener('abort', on); rej(e); });
  });
}
function loadScript(src, timeout = 20000) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    const t = setTimeout(() => rej(new Error('Skript lädt nicht')), timeout);
    s.src = src; s.async = true;
    s.onload = () => { clearTimeout(t); res(); };
    s.onerror = () => { clearTimeout(t); rej(new Error('Skript nicht erreichbar')); };
    document.head.appendChild(s);
  });
}

/* ================================================================
   Einstellungen
   ================================================================ */
const CFG_KEY = 'namensspur.cfg.v1';
const RECENT_KEY = 'namensspur.recent.v1';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* Speicher gesperrt – ohne Speichern weiter */ } }
};
const DEFAULT_CFG = {
  provider: 'auto',
  keys: { gemini: '', groq: '', openrouter: '', deepseek: '', custom: '' },
  models: { gemini: '', groq: '', openrouter: '', deepseek: '', puter: '', ollama: '', custom: '' },
  bases: { ollama: 'http://localhost:11434/v1', custom: '' },
  tier: 'default',
  sources: { wikipedia: true, wiktionary: true, wikidata: true, wikitree: true, gnd: true, nationalize: true }
};
const merge = (a, b) => {
  const o = { ...a };
  for (const k in (b || {})) {
    o[k] = (a && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && b[k] && typeof b[k] === 'object') ? merge(a[k], b[k]) : b[k];
  }
  return o;
};
let cfg = merge(DEFAULT_CFG, HAS_WINDOW ? store.get(CFG_KEY, {}) : {});
const saveCfg = () => store.set(CFG_KEY, cfg);

const PROV = {
  claude: { name: 'Claude', label: 'Claude – über dein Claude-Konto', note: 'Läuft über dein Claude-Konto, ohne zusätzliche Kosten und ohne Schlüssel. Beim ersten Mal fragt Claude, ob die Seite Claude nutzen darf.' },
  gemini: { name: 'Google Gemini', label: 'Google Gemini – kostenloser Schlüssel', key: true, keyUrl: 'https://aistudio.google.com/apikey', keyHost: 'aistudio.google.com', note: 'Beste Qualität unter den Gratis-Diensten. Schlüssel in Google AI Studio erstellen (kostenlos, Google-Konto nötig).' },
  groq: { name: 'Groq', label: 'Groq – kostenloser Schlüssel', key: true, keyUrl: 'https://console.groq.com/keys', keyHost: 'console.groq.com', base: 'https://api.groq.com/openai/v1', note: 'Sehr schnell, offene Modelle wie Llama und GPT-OSS. Ein kostenloses Konto genügt.' },
  openrouter: { name: 'OpenRouter', label: 'OpenRouter – kostenlose Modelle', key: true, keyUrl: 'https://openrouter.ai/keys', keyHost: 'openrouter.ai', base: 'https://openrouter.ai/api/v1', note: 'Wählt automatisch ein kostenloses Modell (Kennung „:free“, rund 50 Anfragen pro Tag).' },
  deepseek: { name: 'DeepSeek', label: 'DeepSeek – API-Schlüssel (sehr günstig)', key: true, keyUrl: 'https://platform.deepseek.com/api_keys', keyHost: 'platform.deepseek.com', base: 'https://api.deepseek.com', note: 'Sehr günstig, aber nicht kostenlos: Eine Suche kostet meist weniger als einen Cent. Guthaben auf platform.deepseek.com aufladen und dort einen Schlüssel erstellen.' },
  puter: { name: 'Puter', label: 'Puter – ohne Schlüssel', note: 'Kein Schlüssel nötig. Beim ersten Mal öffnet Puter ein Fenster zur kostenlosen Anmeldung; die Nutzung läuft über dein Puter-Kontingent.' },
  ollama: { name: 'Ollama', label: 'Ollama – lokal auf deinem Rechner', base: true, note: 'Komplett kostenlos und privat. Ollama installieren, ein Modell laden (z. B. „ollama pull qwen3“) und diese Seite als Datei öffnen. Für gehostete Seiten OLLAMA_ORIGINS setzen.' },
  custom: { name: 'Eigener Dienst', label: 'Eigener Dienst (OpenAI-kompatibel)', key: 'optional', base: true, note: 'Für jeden Dienst mit /chat/completions-Schnittstelle, z. B. Mistral, Cerebras oder LM Studio.' },
  none: { name: 'Ohne KI', label: 'Ohne KI – nur Quellen', note: 'Zeigt nur die Daten aus den Live-Quellen, ohne Zeitschichten.' }
};
function effProvider() {
  if (IS_CLAUDE) return 'claude';
  if (cfg.provider && cfg.provider !== 'auto' && PROV[cfg.provider]) return cfg.provider;
  if (cfg.keys.gemini) return 'gemini';
  if (cfg.keys.groq) return 'groq';
  if (cfg.keys.openrouter) return 'openrouter';
  if (cfg.keys.deepseek) return 'deepseek';
  return 'puter';
}
const SOURCE_NAMES = { wikipedia: 'Wikipedia', wiktionary: 'Wiktionary', wikidata: 'Wikidata', wikitree: 'WikiTree', gnd: 'GND', nationalize: 'nationalize.io' };

/* ================================================================
   Quellen: Wikipedia
   ================================================================ */
const WP = lang => `https://${lang}.wikipedia.org/w/api.php`;
async function wpResolve(lang, titles) {
  const j = await fetchJSON(`${WP(lang)}?${qs({ action: 'query', format: 'json', formatversion: 2, origin: '*', redirects: 1, prop: 'pageprops|info', ppprop: 'disambiguation', inprop: 'url', titles: titles.join('|') })}`);
  const q = j.query || {};
  const norm = new Map((q.normalized || []).map(n => [n.from, n.to]));
  const redir = new Map((q.redirects || []).map(r => [r.from, r.to]));
  const pages = new Map((q.pages || []).map(p => [p.title, p]));
  return titles.map(t => {
    let x = norm.get(t) || t;
    x = redir.get(x) || x;
    const p = pages.get(x);
    return p && !p.missing && !p.invalid ? { title: p.title, url: p.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`, disamb: !!(p.pageprops && 'disambiguation' in p.pageprops) } : null;
  });
}
async function wpExtract(lang, title) {
  const j = await fetchJSON(`${WP(lang)}?${qs({ action: 'query', format: 'json', formatversion: 2, origin: '*', redirects: 1, prop: 'extracts', explaintext: 1, exsectionformat: 'wiki', titles: title })}`);
  return (j.query && j.query.pages && j.query.pages[0] && j.query.pages[0].extract) || '';
}
function wpSections(text) {
  const out = [{ h: '', level: 0, body: [] }];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if (m) out.push({ h: m[2], level: m[1].length, body: [] });
    else out[out.length - 1].body.push(line);
  }
  return out.map(s => ({ h: s.h, level: s.level, body: s.body.join('\n').replace(/\n{3,}/g, '\n\n').trim() }));
}
function wpPick(text, person) {
  const keep = person
    ? /herkunft|familie|leben|abstammung|jugend|kindheit|early life|family|background|biograph/i
    : /herkunft|bedeutung|etymolog|namens(?!träger)|variant|verbreitung|geschichte|origin|etymology|history|meaning|distribution|varia/i;
  const bearers = /namensträger|bekannte|personen|people|notable|bearers|list of/i;
  const out = [];
  for (const s of wpSections(text)) {
    if (!s.body) continue;
    if (s.level === 0) out.push(clip(s.body, 1500));
    else if (!person && bearers.test(s.h)) out.push(`[${s.h}]\n${clip(s.body, 900)}`);
    else if (keep.test(s.h)) out.push(`[${s.h}]\n${clip(s.body, 1600)}`);
  }
  return out.join('\n\n');
}
async function srcWikipediaName(lang, name, kind, itemP) {
  let title = null;
  const it = itemP ? await itemP : null;
  if (it && it.sitelinks) title = it.sitelinks[lang + 'wiki'] || null;
  let pick = null;
  if (title) {
    const r = await wpResolve(lang, [title]);
    pick = r[0];
  }
  if (!pick) {
    const suffix = { de: { nachname: ['(Familienname)', '(Name)'], vorname: ['(Vorname)', '(Name)'] }, en: { nachname: ['(surname)', '(name)'], vorname: ['(given name)', '(name)'] } }[lang][kind];
    const titles = [...suffix.map(s => `${name} ${s}`), name];
    const res = await wpResolve(lang, titles);
    pick = res.find(r => r && !r.disamb) || res.find(Boolean) || null;
  }
  if (!pick) return { empty: true, summary: 'kein passender Artikel' };
  const text = wpPick(await wpExtract(lang, pick.title), false);
  return { title: pick.title, url: pick.url, text, empty: !text, summary: pick.title + (pick.disamb ? ' (Begriffsklärung)' : '') };
}
async function srcWikipediaPerson(full, personP) {
  const pp = personP ? await personP : null;
  const best = pp && pp.best;
  for (const lang of ['de', 'en']) {
    let pick = null;
    const linked = best && (lang === 'de' ? best.dewiki : best.enwiki);
    if (linked) pick = (await wpResolve(lang, [linked]))[0];
    if (!pick) { const r = (await wpResolve(lang, [full]))[0]; if (r && !r.disamb) pick = r; }
    if (pick && !pick.disamb) {
      const text = wpPick(await wpExtract(lang, pick.title), true);
      if (text) return { title: pick.title, url: pick.url, text, summary: `${pick.title} (${lang})` };
    }
  }
  return { empty: true, summary: 'kein Artikel zur Person' };
}

/* ================================================================
   Quellen: Wiktionary
   ================================================================ */
const LANGN = { 'gem-pro': 'urgermanisch', 'gmw-pro': 'urwestgermanisch', 'ine-pro': 'indogermanisch', 'sla-pro': 'urslawisch', 'cel-pro': 'urkeltisch', 'itc-pro': 'uritalisch', 'la': 'lateinisch', 'la-lat': 'spätlateinisch', 'la-vul': 'vulgärlateinisch', 'la-med': 'mittellateinisch', 'LL.': 'spätlateinisch', 'ML.': 'mittellateinisch', 'VL.': 'vulgärlateinisch', 'grc': 'altgriechisch', 'el': 'griechisch', 'goh': 'althochdeutsch', 'gmh': 'mittelhochdeutsch', 'gml': 'mittelniederdeutsch', 'osx': 'altsächsisch', 'odt': 'altniederländisch', 'dum': 'mittelniederländisch', 'ang': 'altenglisch', 'enm': 'mittelenglisch', 'non': 'altnordisch', 'got': 'gotisch', 'frk': 'fränkisch', 'de': 'deutsch', 'nds': 'niederdeutsch', 'en': 'englisch', 'pl': 'polnisch', 'cs': 'tschechisch', 'sk': 'slowakisch', 'fr': 'französisch', 'fro': 'altfranzösisch', 'it': 'italienisch', 'es': 'spanisch', 'pt': 'portugiesisch', 'nl': 'niederländisch', 'he': 'hebräisch', 'hbo': 'althebräisch', 'ar': 'arabisch', 'tr': 'türkisch', 'ota': 'osmanisch', 'ru': 'russisch', 'uk': 'ukrainisch', 'orv': 'altostslawisch', 'cu': 'altkirchenslawisch', 'sga': 'altirisch', 'ga': 'irisch', 'sco': 'schottisch', 'da': 'dänisch', 'sv': 'schwedisch', 'no': 'norwegisch', 'hu': 'ungarisch', 'fi': 'finnisch', 'lt': 'litauisch', 'lv': 'lettisch', 'vi': 'vietnamesisch', 'zh': 'chinesisch', 'ltc': 'mittelchinesisch', 'ja': 'japanisch', 'ko': 'koreanisch', 'fa': 'persisch', 'sa': 'Sanskrit', 'hy': 'armenisch', 'ka': 'georgisch', 'sq': 'albanisch', 'ro': 'rumänisch', 'hr': 'kroatisch', 'sr': 'serbisch', 'sl': 'slowenisch', 'bg': 'bulgarisch', 'yi': 'jiddisch', 'eu': 'baskisch' };
const ABBR = { 'mhd.': 'mittelhochdeutsch', 'ahd.': 'althochdeutsch', 'mnd.': 'mittelniederdeutsch', 'nhd.': 'neuhochdeutsch', 'fnhd.': 'frühneuhochdeutsch', 'lat.': 'lateinisch', 'mlat.': 'mittellateinisch', 'spätlat.': 'spätlateinisch', 'gr.': 'griechisch', 'griech.': 'griechisch', 'altgr.': 'altgriechisch', 'idg.': 'indogermanisch', 'ie.': 'indoeuropäisch', 'germ.': 'germanisch', 'vgl.': 'vergleiche', 'hebr.': 'hebräisch', 'poln.': 'polnisch', 'tschech.': 'tschechisch', 'frz.': 'französisch', 'ital.': 'italienisch', 'nl.': 'niederländisch', 'engl.': 'englisch', 'as.': 'altsächsisch', 'got.': 'gotisch', 'Pl.': 'Plural', 'Gen.': 'Genitiv', 'Nom.': 'Nominativ', 'f': 'feminin', 'm': 'maskulin', 'n': 'neutrum', 'ugs.': 'umgangssprachlich', 'übertr.': 'übertragen', 'Dim.': 'Diminutiv' };
function simplifyTemplate(inner) {
  const parts = inner.split('|').map(p => p.trim());
  const name = (parts.shift() || '').trim();
  const pos = parts.filter(p => !/^[A-Za-z0-9_-]+\s*=/.test(p));
  const named = {};
  for (const p of parts) { const m = p.match(/^([A-Za-z0-9_-]+)\s*=\s*([\s\S]*)$/); if (m) named[m[1]] = m[2]; }
  const L = c => LANGN[c] || c;
  const gloss = g => g ? `„${g}“` : '';
  switch (name) {
    case 'der': case 'inh': case 'bor': case 'lbor': case 'der+': case 'inh+': case 'bor+': case 'uder': case 'slbor': case 'calque': case 'clq': case 'learned borrowing': case 'obor':
      return [L(pos[1] || ''), pos[2] || '', gloss(pos[4] || named.t || named.gloss)].filter(Boolean).join(' ');
    case 'cog': case 'ncog': case 'noncog':
      return [L(pos[0] || ''), pos[1] || '', gloss(named.t)].filter(Boolean).join(' ');
    case 'm': case 'l': case 'mention': case 'll': case 'm+':
      return [pos[1] || '', gloss(pos[3] || named.t || named.gloss)].filter(Boolean).join(' ');
    case 'surname': return `(Familienname${named.from ? ', aus: ' + named.from : ''})`;
    case 'given name': return `(Vorname${pos[1] ? ', ' + pos[1] : ''})`;
    case 'af': case 'affix': case 'compound': case 'com': case 'suffix': case 'prefix': case 'surf': case 'confix':
      return pos.slice(1).filter(Boolean).join(' + ');
    case 'root': return pos.slice(2).join(', ');
    case 'etydate': case 'etyl': case 'rfe': case 'wikipedia': case 'wp': case 'slim-wikipedia': return '';
    default: break;
  }
  if (ABBR[name] !== undefined) return ABBR[name];
  if (/^Üt?$/.test(name)) return pos[1] || '';
  if (/^(Lit-|Ref-|Wikipedia|Beispiele|Referenz|Quelle|Internetquelle|Literatur|Audio|Lautschrift|IPA|Hörbeispiele|Worttrennung|Aussprache|Reime|Sg\.|Pl\.|Nachname|Vorname|QS|Ähnlichkeiten)/.test(name)) return '';
  if (!pos.length) return name.length <= 8 ? name : '';
  return pos[pos.length - 1];
}
function cleanWiki(s) {
  let t = String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:Datei|File|Bild|Image|Kategorie|Category):[^\]]*\]\]/gi, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '');
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{([^{}]*)\}\}/g, (m, inner) => simplifyTemplate(inner));
  return t.replace(/^[:*#]+\s*/gm, '').replace(/[ \t]+/g, ' ').replace(/ ([,.;:])/g, '$1').replace(/\n{2,}/g, '\n').trim();
}
function wiktDeExtract(wt) {
  const out = [];
  let lang = '', posName = '', grab = null, buf = [];
  const flush = () => {
    if (grab && buf.length) { const t = cleanWiki(buf.join('\n')); if (t) out.push(`[${grab}] ${t}`); }
    grab = null; buf = [];
  };
  for (const line of String(wt || '').split('\n')) {
    let m;
    if ((m = line.match(/^==\s*[^=].*?\(\{\{Sprache\|([^}]+)\}\}\)\s*==\s*$/))) { flush(); lang = m[1]; posName = ''; continue; }
    if ((m = line.match(/^===\s*\{\{Wortart\|([^|}]+)/))) { flush(); posName = m[1]; continue; }
    const tl = line.trim();
    if (/^\{\{[^{}|]+\}\}$/.test(tl)) {
      flush();
      const sec = tl.slice(2, -2).trim();
      if (/^(Herkunft|Namensvarianten|Männliche Namensvarianten|Weibliche Namensvarianten|Verkleinerungsformen|Koseformen|Bekannte Namensträger)$/.test(sec)) {
        grab = [lang, posName, sec].filter(Boolean).join(' · ');
      }
      continue;
    }
    if (/^={2,}/.test(tl)) { flush(); continue; }
    if (grab) buf.push(line);
  }
  flush();
  const prio = out.filter(x => /Nachname|Vorname|Familienname/.test(x.slice(0, 80)));
  const rest = out.filter(x => !prio.includes(x));
  return clip([...prio, ...rest].join('\n'), 2600);
}
function wiktEnExtract(wt) {
  const langs = [];
  let cur = null, mode = null;
  for (const line of String(wt || '').split('\n')) {
    let m;
    if ((m = line.match(/^==\s*([^=].*?)\s*==\s*$/))) { cur = { lang: m[1], ety: [], pn: [] }; langs.push(cur); mode = null; continue; }
    if ((m = line.match(/^={3,5}\s*(.*?)\s*={3,5}\s*$/))) { mode = /^Etymology/i.test(m[1]) ? 'ety' : /^Proper noun/i.test(m[1]) ? 'pn' : null; continue; }
    if (!cur || !mode) continue;
    if (mode === 'ety' && line.trim()) cur.ety.push(line);
    if (mode === 'pn' && /^#[^:*]/.test(line)) cur.pn.push(line.replace(/^#\s*/, ''));
  }
  const out = langs.filter(l => l.pn.length).map(l => {
    const ety = cleanWiki(l.ety.join(' '));
    const pn = cleanWiki(l.pn.slice(0, 3).join('; '));
    return `[${l.lang}] ${ety ? ety + ' — ' : ''}${pn}`;
  });
  return clip(out.join('\n'), 2000);
}
async function srcWiktionary(lang, word) {
  const j = await fetchJSON(`https://${lang}.wiktionary.org/w/api.php?${qs({ action: 'parse', format: 'json', formatversion: 2, origin: '*', prop: 'wikitext', redirects: 1, page: word })}`);
  if (j.error) {
    if (j.error.code === 'missingtitle') return { empty: true, summary: 'kein Eintrag' };
    throw new Error(j.error.info || j.error.code);
  }
  const title = (j.parse && j.parse.title) || word;
  const text = lang === 'de' ? wiktDeExtract(j.parse && j.parse.wikitext) : wiktEnExtract(j.parse && j.parse.wikitext);
  return { title, url: `https://${lang}.wiktionary.org/wiki/${encodeURIComponent(title)}`, text, empty: !text, summary: text ? 'Herkunftsangaben gefunden' : 'Eintrag ohne Namensherkunft' };
}

/* ================================================================
   Quellen: Wikidata
   ================================================================ */
const WD = 'https://www.wikidata.org/w/api.php';
const FAM = ['Q101352', 'Q29042997'];
const GIV = ['Q202444', 'Q12308941', 'Q11879590', 'Q3409032'];
async function sparql(q, timeout = 45000) {
  const j = await fetchJSON(`https://query.wikidata.org/sparql?${qs({ format: 'json', query: q })}`, { timeout });
  return ((j.results && j.results.bindings) || []).map(b => { const o = {}; for (const k in b) o[k] = b[k].value; return o; });
}
async function wdEntities(ids, props = 'labels|descriptions|claims|sitelinks') {
  if (!ids.length) return {};
  const j = await fetchJSON(`${WD}?${qs({ action: 'wbgetentities', ids: ids.slice(0, 50).join('|'), props, languages: 'de|en|mul', languagefallback: 1, sitefilter: 'dewiki|enwiki', format: 'json', origin: '*' })}`);
  return j.entities || {};
}
const lbl = e => (e && e.labels && ((e.labels.de && e.labels.de.value) || (e.labels.mul && e.labels.mul.value) || (e.labels.en && e.labels.en.value) || (Object.values(e.labels)[0] || {}).value)) || '';
const dsc = e => (e && e.descriptions && ((e.descriptions.de && e.descriptions.de.value) || (e.descriptions.en && e.descriptions.en.value))) || '';
const claimIds = (e, p) => ((e && e.claims && e.claims[p]) || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean);
const claimTime = (e, p) => {
  const v = ((e && e.claims && e.claims[p]) || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).find(Boolean);
  return v && v.time ? { y: wdYear(v.time), prec: v.precision } : null;
};
const entityId = u => u ? String(u).replace(/^.*\/entity\//, '') : null;

async function wdFindNameItem(name, kind) {
  const classes = kind === 'vorname' ? GIV : FAM;
  const j = await fetchJSON(`${WD}?${qs({ action: 'query', list: 'search', srsearch: `${name} haswbstatement:${classes.map(c => 'P31=' + c).join('|')}`, srlimit: 10, srnamespace: 0, format: 'json', formatversion: 2, origin: '*' })}`);
  const ids = ((j.query && j.query.search) || []).map(s => s.title).filter(t => /^Q\d+$/.test(t));
  if (!ids.length) return null;
  const ents = await wdEntities(ids);
  const target = fold(name);
  const cands = ids.map(id => ents[id]).filter(Boolean);
  const item = cands.find(e => Object.values(e.labels || {}).some(l => fold(l.value) === target));
  if (!item) return null;
  const sitelinks = {};
  for (const k of ['dewiki', 'enwiki']) if (item.sitelinks && item.sitelinks[k]) sitelinks[k] = item.sitelinks[k].title;
  return { id: item.id, label: lbl(item), desc: dsc(item), sitelinks, variantIds: claimIds(item, 'P460'), langIds: claimIds(item, 'P407') };
}
const qEarliest = (prop, qid) => `SELECT ?p ?pLabel ?pDescription ?b ?prec ?d ?placeLabel WHERE {
  { SELECT ?p (MIN(?bt) AS ?b) (MAX(?pr) AS ?prec) WHERE {
      ?p wdt:${prop} wd:${qid} ; p:P569/psv:P569 ?bv .
      ?bv wikibase:timeValue ?bt ; wikibase:timePrecision ?pr .
    } GROUP BY ?p ORDER BY ASC(?b) LIMIT 60 }
  OPTIONAL { ?p wdt:P570 ?d . }
  OPTIONAL { ?p wdt:P19 ?place . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en,mul". }
}`;
const qCenturies = (prop, qid) => `SELECT ?c (COUNT(?p) AS ?n) WHERE {
  { SELECT ?p (MIN(YEAR(?b)) AS ?yr) WHERE { ?p wdt:${prop} wd:${qid} ; wdt:P569 ?b . } GROUP BY ?p }
  BIND(FLOOR(?yr / 100) AS ?c)
} GROUP BY ?c ORDER BY ?c`;
const qTotal = (prop, qid) => `SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p wdt:${prop} wd:${qid} . }`;
const qPlaces = (prop, qid) => `SELECT ?place ?placeLabel ?n WHERE {
  { SELECT ?place (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p wdt:${prop} wd:${qid} ; wdt:P19 ?place . } GROUP BY ?place ORDER BY DESC(?n) LIMIT 10 }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en,mul". }
} ORDER BY DESC(?n)`;

function parseEarliest(rows) {
  const map = new Map();
  for (const r of rows) {
    const id = entityId(r.p);
    if (!id) continue;
    let p = map.get(id);
    if (!p) {
      const by = wdYear(r.b);
      p = { id, name: r.pLabel || id, info: r.pDescription || '', by, byLabel: wdYearLabel(by, r.prec), dy: null, places: [], url: `https://www.wikidata.org/wiki/${id}` };
      map.set(id, p);
    }
    const dy = wdYear(r.d);
    if (dy != null && (p.dy == null || dy < p.dy)) p.dy = dy;
    if (r.placeLabel && !/^Q\d+$/.test(r.placeLabel) && !p.places.includes(r.placeLabel)) p.places.push(r.placeLabel);
  }
  return [...map.values()].filter(p => p.by != null).sort((a, b) => a.by - b.by);
}
function parseCenturies(rows) {
  return rows.map(r => ({ c: parseInt(r.c, 10), n: parseInt(r.n, 10) })).filter(x => Number.isFinite(x.c) && Number.isFinite(x.n) && x.n > 0).sort((a, b) => a.c - b.c);
}
async function wdHumansByLabel(name) {
  const j = await fetchJSON(`${WD}?${qs({ action: 'query', list: 'search', srsearch: `inlabel:"${name.replace(/"/g, '')}" haswbstatement:P31=Q5`, srlimit: 40, srnamespace: 0, format: 'json', formatversion: 2, origin: '*' })}`);
  const ids = ((j.query && j.query.search) || []).map(s => s.title).filter(t => /^Q\d+$/.test(t)).slice(0, 40);
  if (!ids.length) return [];
  const ents = await wdEntities(ids, 'labels|descriptions|claims');
  const target = fold(name);
  return ids.map(id => ents[id]).filter(Boolean).map(e => {
    const b = claimTime(e, 'P569'), d = claimTime(e, 'P570');
    return { id: e.id, name: lbl(e), info: dsc(e), by: b ? b.y : null, byLabel: b ? wdYearLabel(b.y, b.prec) : '', dy: d ? d.y : null, places: [], url: `https://www.wikidata.org/wiki/${e.id}` };
  }).filter(p => fold(p.name).split(/[\s-]+/).includes(target) && p.by != null).sort((a, b) => a.by - b.by);
}
async function srcWikidataName(name, kind, itemP, prog) {
  const item = await itemP;
  if (!item) {
    prog('kein Namens-Datensatz – suche Personen …');
    const hum = await wdHumansByLabel(name);
    return { item: null, bearers: hum, total: 0, fallback: true, centuries: [], places: [], variants: [], empty: !hum.length, summary: hum.length ? `kein Namens-Datensatz, ${hum.length} Personen gefunden` : 'nichts gefunden' };
  }
  const prop = kind === 'vorname' ? 'P735' : 'P734';
  prog('Namensträger werden gezählt …');
  const [early, cents, total, places, vEnts] = await Promise.allSettled([
    sparql(qEarliest(prop, item.id)),
    sparql(qCenturies(prop, item.id)),
    sparql(qTotal(prop, item.id), 30000),
    sparql(qPlaces(prop, item.id)),
    wdEntities(item.variantIds.slice(0, 30), 'labels')
  ]);
  for (const r of [early, cents, total, places, vEnts]) if (r.status === 'rejected' && r.reason && r.reason.cancelled) throw r.reason;
  const bearers = early.status === 'fulfilled' ? parseEarliest(early.value) : [];
  const centuries = cents.status === 'fulfilled' ? parseCenturies(cents.value) : [];
  const n = total.status === 'fulfilled' && total.value[0] ? parseInt(total.value[0].n, 10) || 0 : 0;
  const pl = places.status === 'fulfilled' ? places.value.map(r => ({ name: r.placeLabel, n: parseInt(r.n, 10) || 0 })).filter(p => p.name && !/^Q\d+$/.test(p.name)) : [];
  const variants = vEnts.status === 'fulfilled' ? Object.values(vEnts.value).map(lbl).filter(Boolean) : [];
  const dated = centuries.reduce((s, c) => s + c.n, 0);
  const oldest = bearers[0];
  return {
    item: { id: item.id, label: item.label, desc: item.desc }, url: `https://www.wikidata.org/wiki/${item.id}`,
    bearers, centuries, total: n, dated, places: pl, variants,
    partial: early.status === 'rejected' || cents.status === 'rejected',
    summary: `${nf(n)} Namensträger${oldest ? `, ältester: ${oldest.name} (${oldest.byLabel})` : ''}`
  };
}
async function srcWikidataPerson(full) {
  const j = await fetchJSON(`${WD}?${qs({ action: 'wbsearchentities', search: full, language: 'de', uselang: 'de', type: 'item', limit: 12, format: 'json', origin: '*' })}`);
  const ids = (j.search || []).map(s => s.id);
  if (!ids.length) return { people: [], best: null, empty: true, summary: 'keine Person gefunden' };
  const ents = await wdEntities(ids);
  const people = ids.map(id => ents[id]).filter(e => e && claimIds(e, 'P31').includes('Q5')).map(e => {
    const b = claimTime(e, 'P569'), d = claimTime(e, 'P570');
    return {
      id: e.id, name: lbl(e), info: dsc(e), by: b ? b.y : null, dy: d ? d.y : null,
      hasParents: claimIds(e, 'P22').length + claimIds(e, 'P25').length > 0,
      dewiki: e.sitelinks && e.sitelinks.dewiki ? e.sitelinks.dewiki.title : null,
      enwiki: e.sitelinks && e.sitelinks.enwiki ? e.sitelinks.enwiki.title : null,
      url: `https://www.wikidata.org/wiki/${e.id}`
    };
  });
  const best = pickBestPerson(people, full);
  return { people, best, empty: !people.length, summary: people.length ? `${people.length} Person(en), zuerst: ${best ? best.name : people[0].name}` : 'keine Person gefunden' };
}
function pickBestPerson(people, full) {
  if (!people.length) return null;
  const t = fold(full);
  const exact = people.filter(p => fold(p.name) === t);
  return exact.find(p => p.hasParents) || exact[0] || people.find(p => p.hasParents) || people[0];
}
async function wdAncestors(qid) {
  const rows = await sparql(`SELECT ?a ?aLabel ?aDescription ?f ?m ?b ?d WHERE {
  wd:${qid} (wdt:P22|wdt:P25)* ?a .
  OPTIONAL { ?a wdt:P22 ?f . }
  OPTIONAL { ?a wdt:P25 ?m . }
  OPTIONAL { ?a wdt:P569 ?b . }
  OPTIONAL { ?a wdt:P570 ?d . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en,mul,fr,it,es,nl,la". }
} LIMIT 6000`, 60000);
  return buildWdTree(rows, qid);
}
function buildWdTree(rows, qid) {
  const people = new Map();
  for (const r of rows) {
    const k = entityId(r.a);
    if (!k) continue;
    let p = people.get(k);
    if (!p) { p = { id: k, name: r.aLabel || k, info: r.aDescription || '', father: null, mother: null, by: null, dy: null, url: `https://www.wikidata.org/wiki/${k}` }; people.set(k, p); }
    const f = entityId(r.f), m = entityId(r.m);
    if (f && !p.father && f !== k) p.father = f;
    if (m && !p.mother && m !== k) p.mother = m;
    const by = wdYear(r.b), dy = wdYear(r.d);
    if (by != null && (p.by == null || by < p.by)) p.by = by;
    if (dy != null && (p.dy == null || dy < p.dy)) p.dy = dy;
  }
  return { people, rootId: qid, source: 'Wikidata', truncated: rows.length >= 6000 };
}

/* ================================================================
   Quellen: WikiTree, GND, nationalize
   ================================================================ */
const WT = 'https://api.wikitree.com/api.php';
const WT_FIELDS = 'Id,Name,FirstName,MiddleName,LastNameAtBirth,LastNameCurrent,BirthDate,DeathDate,BirthLocation,DeathLocation,Father,Mother';
const wtYear = d => { const y = parseInt(String(d || '').slice(0, 4), 10); return y > 0 ? y : null; };
const wtName = m => [m.FirstName, m.MiddleName, m.LastNameAtBirth].filter(Boolean).join(' ') + (m.LastNameCurrent && m.LastNameAtBirth && m.LastNameCurrent !== m.LastNameAtBirth ? ` (später ${m.LastNameCurrent})` : '');
const wtUrl = key => `https://www.wikitree.com/wiki/${encodeURIComponent(key)}`;
async function wtSearch(params) {
  const j = await fetchJSON(`${WT}?${qs({ action: 'searchPerson', ...params, fields: WT_FIELDS, appId: 'Namensspur' })}`, { timeout: 25000 });
  const o = Array.isArray(j) ? j[0] : j;
  if (!o) return { matches: [], total: 0 };
  return { matches: o.matches || [], total: o.total != null ? o.total : (o.matches || []).length };
}
async function srcWikiTreeSurname(last) {
  const { matches, total } = await wtSearch({ LastName: last, sort: 'birth', limit: 100, dateInclude: 'both' });
  const people = matches.map(m => ({ id: String(m.Id), key: m.Name, name: wtName(m), by: wtYear(m.BirthDate), dy: wtYear(m.DeathDate), place: m.BirthLocation || '', lastBirth: m.LastNameAtBirth || '', url: wtUrl(m.Name) }))
    .filter(p => p.by != null).sort((a, b) => a.by - b.by);
  return { people, total, url: `https://www.wikitree.com/genealogy/${encodeURIComponent(last.toUpperCase())}`, empty: !people.length, summary: people.length ? `${nf(total)} Profile, ältestes: ${people[0].by}` : 'keine Profile mit Lebensdaten' };
}
async function srcWikiTreePerson(first, last) {
  const { matches, total } = await wtSearch({ FirstName: first.split(' ')[0], LastName: last, limit: 20, sort: 'birth' });
  const people = matches.map(m => ({ id: String(m.Id), key: m.Name, name: wtName(m), by: wtYear(m.BirthDate), dy: wtYear(m.DeathDate), info: m.BirthLocation || '', url: wtUrl(m.Name) }));
  return { people, total, empty: !people.length, summary: people.length ? `${nf(total)} passende Profile` : 'keine Profile' };
}
async function wtAncestors(key, depth = 10) {
  const j = await fetchJSON(`${WT}?${qs({ action: 'getAncestors', key, depth, fields: WT_FIELDS, appId: 'Namensspur' })}`, { timeout: 30000 });
  const o = Array.isArray(j) ? j[0] : j;
  const list = (o && o.ancestors) || [];
  if (!list.length) throw new Error('keine Vorfahren gespeichert');
  const people = new Map();
  for (const m of list) {
    people.set(String(m.Id), { id: String(m.Id), key: m.Name, name: wtName(m), info: m.BirthLocation || '', father: m.Father ? String(m.Father) : null, mother: m.Mother ? String(m.Mother) : null, by: wtYear(m.BirthDate), dy: wtYear(m.DeathDate), url: wtUrl(m.Name) });
  }
  const root = list.find(m => m.Name === key) || list[0];
  return { people, rootId: String(root.Id), source: 'WikiTree', fetched: new Set([key]) };
}
const gndYear = s => { if (!s) return null; const m = String(s).match(/(-?\d{1,4})/); return m ? parseInt(m[1], 10) : null; };
const flipName = n => { n = String(n || ''); return n.includes(',') ? n.split(',').map(x => x.trim()).reverse().join(' ') : n; };
async function srcGND(name, kind) {
  const q = `preferredNameEntityForThePerson.${kind === 'vorname' ? 'forename' : 'surname'}:"${name.replace(/"/g, '')}"`;
  const j = await fetchJSON(`https://lobid.org/gnd/search?${qs({ q, filter: 'type:DifferentiatedPerson', format: 'json', size: 100 })}`, { timeout: 20000 });
  const mem = j.member || [];
  const people = mem.map(m => ({
    id: m.gndIdentifier, name: flipName(m.preferredName), by: gndYear(m.dateOfBirth && m.dateOfBirth[0]), dy: gndYear(m.dateOfDeath && m.dateOfDeath[0]),
    place: (m.placeOfBirth || []).map(x => x.label).filter(Boolean).join(', '),
    info: [(m.professionOrOccupation || []).map(x => x.label).filter(Boolean).slice(0, 2).join(', '), (m.biographicalOrHistoricalInformation || [])[0]].filter(Boolean).join(' · '),
    url: m.id || `https://d-nb.info/gnd/${m.gndIdentifier}`
  })).filter(p => p.by != null).sort((a, b) => a.by - b.by);
  return { people, total: j.totalItems != null ? j.totalItems : mem.length, url: `https://lobid.org/gnd/search?${qs({ q, filter: 'type:DifferentiatedPerson' })}`, empty: !people.length, summary: people.length ? `${nf(j.totalItems || mem.length)} Einträge, frühestes Geburtsjahr in der Auswahl: ${fmtYear(people[0].by)}` : 'keine Einträge mit Geburtsjahr' };
}
async function srcNationalize(name) {
  const j = await fetchJSON(`https://api.nationalize.io/?${qs({ name })}`, { timeout: 12000 });
  let dn = null;
  try { dn = new Intl.DisplayNames(['de'], { type: 'region' }); } catch { dn = null; }
  const countries = (j.country || []).slice(0, 5).map(c => ({ code: c.country_id, name: (dn && dn.of(c.country_id)) || c.country_id, p: Number(c.probability) || 0 }));
  return { countries, count: j.count, empty: !countries.length, summary: countries.length ? countries.slice(0, 3).map(c => `${c.name} ${Math.round(c.p * 100)} %`).join(', ') : 'keine Schätzung' };
}

/* ================================================================
   KI
   ================================================================ */
let samplePromise = null;
let claudeState = IS_CLAUDE ? 'checking' : 'none';
function getSample() {
  if (!IS_CLAUDE) return Promise.resolve(null);
  if (!samplePromise) {
    samplePromise = window.claude.use('sample')
      .then(s => { claudeState = s ? 'ready' : 'absent'; renderAIStatus(); return s; })
      .catch(() => { claudeState = 'absent'; renderAIStatus(); return null; });
  }
  return samplePromise;
}
const CLAUDE_ERR = {
  not_granted: 'Die Seite darf Claude nicht nutzen. Lade die Seite neu, um erneut gefragt zu werden.',
  sampling_disabled: 'Claude ist für dieses Konto hier nicht verfügbar.',
  capability_disabled: 'Claude ist in dieser Ansicht nicht verfügbar.',
  capability_removed: 'Claude ist in dieser Ansicht nicht verfügbar.',
  not_declared: 'Claude ist für diese Seite nicht freigeschaltet.',
  rate_limited: 'Gerade zu viele Anfragen oder dein Nutzungslimit ist erreicht. Bitte später erneut versuchen.',
  session_expired: 'Bitte bei Claude neu anmelden und die Seite neu laden.',
  refused: 'Claude hat diese Anfrage abgelehnt.',
  prompt_too_large: 'Die Anfrage war zu groß.',
  empty_completion: 'Claude hat keine Antwort geliefert.'
};
async function aiClaude(prompt, onProgress, refresh) {
  const sample = await getSample();
  if (!sample) throw new Error('Claude ist in dieser Ansicht nicht verfügbar.');
  onProgress('Claude denkt nach … meist 20–60 Sekunden');
  const ctl = new AbortController();
  if (runCtl) runCtl.signal.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const res = await sample(prompt, {
      modelTier: ['quick', 'default', 'complex'].includes(cfg.tier) ? cfg.tier : 'default',
      signal: ctl.signal,
      cache: { gcTime: 6 * 3600 * 1000, refresh: !!refresh },
      onText: ({ text }) => onProgress(`Claude schreibt … ${nf(text.length)} Zeichen`)
    });
    return { text: res.text, model: res.modelTierApplied || cfg.tier, provider: 'Claude', truncated: res.truncated };
  } catch (e) {
    const code = e && e.code;
    if (code === 'cancelled') throw new Cancelled();
    if (code === 'not_granted') { claudeState = 'denied'; renderAIStatus(); }
    const err = new Error(CLAUDE_ERR[code] || 'Claude war nicht erreichbar. Bitte erneut versuchen.');
    err.code = code; err.partial = e && e.text;
    throw err;
  }
}
async function geminiModels(key) {
  const j = await fetchJSON(`https://generativelanguage.googleapis.com/v1beta/models?${qs({ pageSize: 200, key })}`, { timeout: 15000 });
  return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name).replace(/^models\//, ''));
}
function rankGemini(ids) {
  const bad = /(image|tts|live|audio|embed|robot|computer|transcri|omni|research|antigravity|veo|lyria|learnlm|aqa|banana|vision|translate|imagen|gemma|-pro)/i;
  return ids.filter(id => /^gemini-/.test(id) && !bad.test(id)).map(id => {
    const v = parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
    let s = v * 10;
    if (/flash/.test(id)) s += 5;
    if (/lite/.test(id)) s -= 3;
    if (/preview|exp/.test(id)) s -= 4;
    if (/latest/.test(id)) s += 1;
    if (/-\d{2,}(-\d{2,})?$/.test(id)) s -= 1;
    return { id, s };
  }).sort((a, b) => b.s - a.s).map(x => x.id);
}
const keyErr = (name, url) => new Error(`Der ${name}-Schlüssel wurde abgelehnt. Prüfe ihn in den Einstellungen${url ? ` (neuer Schlüssel: ${url})` : ''}.`);
async function aiGemini(prompt, onProgress) {
  const key = (cfg.keys.gemini || '').trim();
  if (!key) throw new Error('Für Gemini fehlt der Schlüssel. Du bekommst ihn kostenlos unter aistudio.google.com/apikey.');
  let cands = cfg.models.gemini ? [cfg.models.gemini.trim()] : [];
  if (!cands.length) {
    try { cands = rankGemini(await geminiModels(key)).slice(0, 4); }
    catch (e) { if (e.cancelled) throw e; if (e.status === 400 || e.status === 401 || e.status === 403) throw keyErr('Gemini', 'aistudio.google.com/apikey'); }
  }
  if (!cands.length) cands = ['gemini-flash-latest', 'gemini-2.5-flash'];
  let lastErr = null;
  for (const model of cands) {
    onProgress(`Gemini · ${model}`);
    try {
      const j = await fetchJSON(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?${qs({ key })}`, {
        method: 'POST', timeout: 150000, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' } })
      });
      const cand = (j.candidates || [])[0];
      const text = ((cand && cand.content && cand.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
      if (!text.trim()) { lastErr = new Error(`Leere Antwort (${(cand && cand.finishReason) || (j.promptFeedback && j.promptFeedback.blockReason) || 'unbekannt'})`); continue; }
      return { text, model, provider: 'Google Gemini', truncated: cand && cand.finishReason === 'MAX_TOKENS' };
    } catch (e) {
      if (e.cancelled) throw e;
      lastErr = e;
      if (e.status === 400 && /api key|API_KEY/i.test(e.body || '')) throw keyErr('Gemini', 'aistudio.google.com/apikey');
      if (!e.status || [403, 404, 429, 500, 503].includes(e.status)) continue;
      throw e;
    }
  }
  throw lastErr || new Error('Gemini nicht erreichbar');
}
async function openaiModels(base, key) {
  const j = await fetchJSON(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : undefined, timeout: 15000 });
  return (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean);
}
async function openrouterFreeModels() {
  const j = await fetchJSON('https://openrouter.ai/api/v1/models', { timeout: 15000 });
  const free = (j.data || []).filter(m => /:free$/.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 && !/auto|router/i.test(m.id)));
  const pref = ['deepseek', 'gpt-oss-120b', 'qwen3-235b', 'llama-3.3-70b', 'gemini', 'kimi', 'glm', 'mistral-small', 'gemma-3-27b', 'qwen'];
  const score = id => { const i = pref.findIndex(p => id.includes(p)); return i < 0 ? 99 : i; };
  return free.map(m => m.id).filter(id => !/(vision|image|audio|embed|guard|moderation|coder)/i.test(id)).sort((a, b) => score(a) - score(b));
}
function rankGroq(ids) {
  const pref = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2', 'qwen/qwen3-32b', 'meta-llama/llama-4-maverick', 'meta-llama/llama-4-scout', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
  const score = id => { const i = pref.findIndex(p => id.startsWith(p)); return i < 0 ? 50 : i; };
  return ids.filter(id => !/(whisper|tts|guard|playai|orpheus|distil|compound|allam|safeguard)/i.test(id)).sort((a, b) => score(a) - score(b));
}
/* DeepSeek: das günstige Flash-Modell zuerst, dann Chat, dann Pro/Reasoner */
function rankDeepSeek(ids) {
  const score = id => id === 'deepseek-flash' ? 0 : /flash/.test(id) && !/vision/.test(id) ? 1 : id === 'deepseek-chat' ? 2 : /chat/.test(id) ? 3 : /pro/.test(id) ? 4 : /reason/.test(id) ? 5 : 6;
  return ids.filter(id => !/(vision|embed|ocr)/i.test(id)).map((id, i) => ({ id, i })).sort((a, b) => (score(a.id) - score(b.id)) || (a.i - b.i)).map(x => x.id);
}
async function aiOpenAI(which, prompt, onProgress) {
  const P = PROV[which];
  const base = String(typeof P.base === 'string' ? P.base : (cfg.bases[which] || '')).trim().replace(/\/+$/, '');
  const key = String(cfg.keys[which] || '').trim();
  if (!base) throw new Error('Bitte in den Einstellungen die Adresse (Base-URL) des Dienstes eintragen.');
  if (P.key === true && !key) throw new Error(`Für ${P.name} fehlt der Schlüssel. ${which === 'deepseek' ? 'Erhältlich' : 'Kostenlos erhältlich'} unter ${P.keyHost}.`);
  let cands = cfg.models[which] ? [cfg.models[which].trim()] : [];
  if (!cands.length) {
    try {
      if (which === 'openrouter') cands = await openrouterFreeModels();
      else {
        const ids = await openaiModels(base, key);
        cands = which === 'groq' ? rankGroq(ids) : which === 'deepseek' ? rankDeepSeek(ids) : ids;
      }
    } catch (e) {
      if (e.cancelled) throw e;
      if (e.status === 401) throw keyErr(P.name, P.keyHost);
      if (which === 'ollama') throw new Error('Ollama ist nicht erreichbar. Läuft Ollama auf diesem Rechner?');
    }
  }
  if (!cands.length && which === 'groq') cands = ['llama-3.3-70b-versatile'];
  if (!cands.length && which === 'deepseek') cands = ['deepseek-flash', 'deepseek-chat'];
  if (!cands.length) throw new Error('Kein Modell gefunden. Bitte in den Einstellungen ein Modell eintragen.');
  let lastErr = null;
  let jsonMode = which === 'deepseek';
  const queue = cands.slice(0, 3);
  for (let i = 0; i < queue.length; i++) {
    const model = queue[i];
    onProgress(`${P.name} · ${model}`);
    const body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: which === 'groq' ? 4000 : 6000 };
    if (which === 'groq' && /gpt-oss/.test(model)) body.reasoning_effort = 'low';
    if (jsonMode) body.response_format = { type: 'json_object' };
    try {
      const j = await fetchJSON(`${base}/chat/completions`, {
        method: 'POST', timeout: 150000,
        headers: key ? { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } : { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const ch = (j.choices || [])[0];
      const text = (ch && ch.message && ch.message.content) || '';
      if (!text.trim()) { lastErr = new Error('Leere Antwort'); continue; }
      return { text, model, provider: P.name, truncated: ch && ch.finish_reason === 'length' };
    } catch (e) {
      if (e.cancelled) throw e;
      lastErr = e;
      if (e.status === 401) throw keyErr(P.name, P.keyHost);
      if (e.status === 402 && which === 'deepseek') throw new Error('DeepSeek meldet kein Guthaben. Bitte auf platform.deepseek.com Guthaben aufladen.');
      if (e.status === 400 && jsonMode) { jsonMode = false; i--; continue; }
      if (!e.status || [400, 402, 404, 408, 413, 429, 500, 502, 503].includes(e.status)) continue;
      throw e;
    }
  }
  if (which === 'deepseek' && lastErr && !lastErr.status && /nicht erreichbar/.test(lastErr.message)) {
    throw new Error('DeepSeek ist aus dem Browser nicht erreichbar (Netzwerk oder Browser-Sperre). Alternative: OpenRouter bietet ebenfalls DeepSeek-Modelle an.');
  }
  throw lastErr || new Error(`${P.name} nicht erreichbar`);
}
function puterText(r) {
  if (typeof r === 'string') return r;
  const c = r && r.message && r.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (p && (p.text || p.content)) || '').join('');
  if (r && typeof r.text === 'string') return r.text;
  return String(r || '');
}
async function aiPuter(prompt, onProgress) {
  if (!(window.puter && window.puter.ai)) {
    onProgress('Puter wird geladen …');
    await withAbort(loadScript('https://js.puter.com/v2/'));
  }
  if (!(window.puter && window.puter.ai && window.puter.ai.chat)) throw new Error('Puter konnte nicht geladen werden.');
  const opts = {};
  if (cfg.models.puter) opts.model = cfg.models.puter.trim();
  onProgress(`Puter · ${opts.model || 'Standardmodell'} – ggf. im Puter-Fenster anmelden`);
  const r = await withAbort(window.puter.ai.chat(prompt, opts));
  return { text: puterText(r), model: opts.model || 'Standardmodell', provider: 'Puter' };
}
function runAI(prov, prompt, onProgress, refresh) {
  switch (prov) {
    case 'claude': return aiClaude(prompt, onProgress, refresh);
    case 'gemini': return aiGemini(prompt, onProgress);
    case 'groq': case 'openrouter': case 'deepseek': case 'ollama': case 'custom': return aiOpenAI(prov, prompt, onProgress);
    case 'puter': return aiPuter(prompt, onProgress);
    default: return Promise.reject(new Error('Keine KI ausgewählt.'));
  }
}

/* KI-Antwort lesen */
function parseAIJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const s = t.slice(a, b + 1);
  const noTrail = s.replace(/,\s*([}\]])/g, '$1');
  for (const x of [s, noTrail]) { try { const o = JSON.parse(x); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* nächster Versuch */ } }
  return null;
}
function normAI(o) {
  const S = v => typeof v === 'string' ? v.trim() : (v == null ? '' : (typeof v === 'object' ? '' : String(v)));
  const A = v => Array.isArray(v) ? v : [];
  const cert = v => { v = S(v).toLowerCase(); return v.startsWith('beleg') ? 'belegt' : v.startsWith('unsich') || v.startsWith('vermut') ? 'unsicher' : 'wahrscheinlich'; };
  let zs = A(o.zeitschichten).map(z => {
    if (!z || typeof z !== 'object') return null;
    const zeit = S(z.zeit);
    const j = toNum(z.jahr);
    return { zeit, jahr: j != null ? j : guessYear(zeit), form: S(z.form), sprache: S(z.sprache), text: S(z.text), sicherheit: cert(z.sicherheit), quelle: S(z.quelle) };
  }).filter(z => z && (z.form || z.text));
  if (zs.length && zs.every(z => z.jahr != null)) zs = zs.map((z, i) => ({ z, i })).sort((a, b) => (b.z.jahr - a.z.jahr) || (a.i - b.i)).map(x => x.z);
  const strs = v => A(v).map(x => typeof x === 'string' ? x.trim() : (x && typeof x === 'object' ? S(x.name || x.text || '') : '')).filter(Boolean);
  const person = typeof o.person === 'string' ? o.person.trim() : (o.person && typeof o.person === 'object' ? S(o.person.text) : '');
  return {
    name: S(o.name), kurz: S(o.kurz), bedeutung: S(o.bedeutung), namenstyp: S(o.namenstyp), sprachraum: S(o.sprachraum), aeltesteWurzel: S(o.aeltesteWurzel),
    zeitschichten: zs.slice(0, 12),
    varianten: strs(o.varianten).slice(0, 24),
    verwandt: strs(o.verwandt).slice(0, 12),
    regionen: A(o.regionen).map(r => typeof r === 'string' ? { region: r.trim(), text: '' } : { region: S(r && r.region), text: S(r && r.text) }).filter(r => r.region).slice(0, 8),
    fruehePersonen: A(o.fruehePersonen).map(p => p && typeof p === 'object' ? { name: S(p.name), zeit: S(p.zeit), info: S(p.info), quelle: S(p.quelle) || 'KI-Wissen' } : null).filter(p => p && p.name).slice(0, 15),
    person,
    vorfahren: A(o.vorfahren).map(v => v && typeof v === 'object' ? { generation: toNum(v.generation), beziehung: S(v.beziehung), name: S(v.name), zeit: S(v.zeit), sicherheit: cert(v.sicherheit) } : null).filter(v => v && v.name).slice(0, 30),
    wissenswertes: strs(o.wissenswertes).slice(0, 8),
    forschungstipps: strs(o.forschungstipps).slice(0, 8),
    hinweis: S(o.hinweis)
  };
}

/* Anfrage an die KI */
function buildContext(R) {
  const parts = [];
  const add = (label, text, max) => { if (text && String(text).trim()) parts.push(`### ${label}\n${clip(text, max)}`); };
  const s = R.src;
  if (s.wpPerson && s.wpPerson.text) add(`Wikipedia: ${s.wpPerson.title}`, s.wpPerson.text, 2600);
  if (s.wpDe && s.wpDe.text) add(`Wikipedia (de): ${s.wpDe.title}`, s.wpDe.text, 3200);
  if (s.wpEn && s.wpEn.text) add(`Wikipedia (en): ${s.wpEn.title}`, s.wpEn.text, 1800);
  if (s.wiktDe && s.wiktDe.text) add('Wiktionary (de), Herkunft', s.wiktDe.text, 1800);
  if (s.wiktEn && s.wiktEn.text) add('Wiktionary (en), Etymology', s.wiktEn.text, 1400);
  const wd = s.wd;
  if (wd && wd.status === 'ok' && wd.item) {
    const cents = (wd.centuries || []).map(c => `${centLabel(c.c)}: ${c.n}`).join(', ');
    add('Wikidata (Namens-Datensatz)', `${wd.item.label}: ${wd.item.desc}. Personen mit diesem Namen in Wikidata: ${wd.total}. ${wd.variants && wd.variants.length ? `Laut Wikidata gleichbedeutend: ${wd.variants.join(', ')}. ` : ''}${cents ? `Verteilung nach Geburtsjahrhundert: ${cents}.` : ''}`, 900);
  }
  const recs = collectRecords(R, false).filter(r => r.year != null).slice(0, 25);
  if (recs.length) add('Früheste dokumentierte Namensträger (Datenbanken)', recs.map(r => `- ${r.yearLabel || fmtYear(r.year)}: ${r.name}${r.info ? ' – ' + clip(r.info, 90) : ''} [${r.source}]`).join('\n'), 2600);
  if (wd && wd.status === 'ok' && wd.places && wd.places.length) add('Häufigste Geburtsorte (Wikidata)', wd.places.map(p => `${p.name} (${p.n})`).join(', '), 500);
  if (s.nat && s.nat.status === 'ok' && s.nat.countries && s.nat.countries.length) add('Heutige Verbreitung (nationalize.io, statistische Schätzung)', s.nat.countries.map(c => `${c.name} ${Math.round(c.p * 100)} %`).join(', '), 300);
  if (R.tree && R.tree.data) {
    const st = treeStats(R.tree.data, R.tree.data.rootId);
    add(`Stammbaum (${R.tree.data.source})`, `${st.count} Vorfahren über ${st.maxGen} Generationen. Väterliche Linie: ${st.line.slice(0, 14).map(p => `${p.name}${p.by != null || p.dy != null ? ` (${lifespan(p.by, p.dy)})` : ''}`).join(' ← ')}${st.oldest ? `. Ältester Vorfahr: ${st.oldest.name} (geb. ${fmtYear(st.oldest.by)})` : ''}.`, 1600);
  }
  return parts.length ? parts.join('\n\n') : '(Keine Live-Quellen verfügbar. Nutze dein Fachwissen, kennzeichne es mit "quelle": "KI-Wissen" und sei bei Details vorsichtig.)';
}
function buildPrompt(R) {
  const target = R.mode === 'vorname' ? R.name : R.last;
  const art = R.mode === 'vorname' ? 'Vorname'
    : R.mode === 'nachname' ? 'Familienname (Nachname)'
    : `Person „${R.name}“ – analysiere vor allem den Familiennamen „${R.last}“${R.first ? ` (Vorname: ${R.first})` : ''}`;
  return `Du bist Fachperson für Namenforschung (Onomastik), historische Sprachwissenschaft und Genealogie.
Aufgabe: Verfolge den Namen „${target}“ so weit wie möglich in der Zeit zurück – von heute über seine historischen Formen bis zur ältesten erreichbaren sprachlichen Wurzel – und fasse alles Wissenswerte zusammen.

Art: ${art}

Regeln:
- Schreibe auf Deutsch, sachlich und knapp.
- Stütze dich zuerst auf die QUELLEN unten. Eigenes Fachwissen ist erlaubt; kennzeichne es mit "quelle": "KI-Wissen".
- "sicherheit": "belegt" = steht in den Quellen oder ist in der Namenforschung anerkannt; "wahrscheinlich" = übliche, plausible Deutung; "unsicher" = Vermutung oder umstritten. Gibt es mehrere Deutungen, nenne sie.
- Erfinde keine Personen, Jahreszahlen, Urkunden, Orte oder Wappen. Nenne konkrete Namensträger nur, wenn sie in den Quellen stehen oder allgemein bekannt sind.
- Ist die Person privat oder unbekannt, spekuliere nicht über sie oder ihre Familie; erkläre stattdessen die Namen.
- "zeitschichten": 4 bis 9 Einträge, von der Gegenwart zur ältesten Wurzel sortiert. "form" ist die Namens- oder Wortform dieser Zeit (rekonstruierte Formen mit *), "jahr" das ungefähre Anfangsjahr als Zahl (vor Christus negativ).
- Stammt der Name nicht aus dem Deutschen, verfolge ihn in seiner eigenen Sprachgeschichte.
- "vorfahren" nur füllen, wenn die Art „Person“ ist, die Person historisch oder öffentlich bekannt ist und die Quellen keinen Stammbaum enthalten; sonst [].

Antworte ausschließlich mit einem JSON-Objekt (kein Markdown, kein Text davor oder danach) in genau dieser Struktur:
{
  "name": "…",
  "kurz": "2–3 Sätze Zusammenfassung",
  "bedeutung": "kurze Bedeutung",
  "namenstyp": "z. B. Berufsname, Herkunftsname, Wohnstättenname, Patronym, Übername oder Rufname",
  "sprachraum": "z. B. Niederdeutsch (Westfalen)",
  "aeltesteWurzel": "älteste erreichbare Form mit Sprache und Zeit",
  "zeitschichten": [{"zeit": "z. B. 12.–13. Jh.", "jahr": 1150, "form": "…", "sprache": "…", "text": "1–3 Sätze", "sicherheit": "belegt|wahrscheinlich|unsicher", "quelle": "Wikipedia|Wiktionary|Wikidata|WikiTree|GND|KI-Wissen"}],
  "varianten": ["Schreibvarianten"],
  "verwandt": ["verwandte Namen gleicher Wurzel"],
  "regionen": [{"region": "…", "text": "…"}],
  "fruehePersonen": [{"name": "…", "zeit": "…", "info": "…", "quelle": "…"}],
  "person": "nur bei bekannter Person: Herkunft ihrer Familie in 2–4 Sätzen, sonst leer",
  "vorfahren": [{"generation": 1, "beziehung": "Vater", "name": "…", "zeit": "…", "sicherheit": "belegt|wahrscheinlich|unsicher"}],
  "wissenswertes": ["kurze Fakten"],
  "forschungstipps": ["konkrete Tipps für die eigene Ahnenforschung zu diesem Namen"],
  "hinweis": "Unsicherheiten und konkurrierende Deutungen"
}

QUELLEN:
${buildContext(R)}`;
}

/* ================================================================
   Auswertung von Belegen und Stammbaum
   ================================================================ */
function centLabel(c) { return c >= 0 ? `${c + 1}. Jh.` : `${-c}. Jh. v. Chr.`; }
function centShort(c) { return c >= 0 ? `${c + 1}.` : `${-c}. v.`; }
function collectRecords(R, withAI = true) {
  const recs = [];
  const s = R.src || {};
  if (s.wd && s.wd.status === 'ok') for (const p of s.wd.bearers || []) recs.push({ year: p.by, yearLabel: p.byLabel, name: p.name, info: [p.info, p.places && p.places[0] ? `geb. in ${p.places[0]}` : ''].filter(Boolean).join(' · '), url: p.url, source: 'Wikidata' });
  if (s.wt && s.wt.status === 'ok') for (const p of s.wt.people || []) recs.push({ year: p.by, name: p.name, info: [p.dy ? `† ${p.dy}` : '', p.place].filter(Boolean).join(' · '), url: p.url, source: 'WikiTree' });
  if (s.gnd && s.gnd.status === 'ok') for (const p of s.gnd.people || []) recs.push({ year: p.by, name: p.name, info: [p.info, p.place ? `geb. in ${p.place}` : ''].filter(Boolean).join(' · '), url: p.url, source: 'GND' });
  if (withAI && R.ai && R.ai.data) for (const p of R.ai.data.fruehePersonen || []) recs.push({ year: firstYear(p.zeit), yearLabel: p.zeit, name: p.name, info: p.info, source: p.quelle || 'KI-Wissen', ai: true });
  const key = r => { const t = fold(r.name).replace(/\(.*?\)/g, '').split(' ').filter(Boolean); return `${t[0] || ''} ${t[t.length - 1] || ''}|${r.year ?? ''}`; };
  const out = uniqBy(recs, key);
  return out.map((r, i) => ({ r, i })).sort((a, b) => ((a.r.year ?? 1e9) - (b.r.year ?? 1e9)) || (a.i - b.i)).map(x => x.r);
}
function kekule(data, rootId) {
  const num = new Map();
  if (!data.people.has(rootId)) return num;
  num.set(rootId, 1n);
  const q = [rootId];
  while (q.length) {
    const id = q.shift();
    const p = data.people.get(id);
    const k = num.get(id);
    if (!p) continue;
    for (const [pid, kk] of [[p.father, 2n * k], [p.mother, 2n * k + 1n]]) {
      if (pid && data.people.has(pid) && !num.has(pid)) { num.set(pid, kk); q.push(pid); }
    }
  }
  return num;
}
function treeStats(data, rootId) {
  const num = kekule(data, rootId);
  let maxGen = 0, oldest = null;
  for (const [id, k] of num) {
    const g = k.toString(2).length - 1;
    if (g > maxGen) maxGen = g;
    const p = data.people.get(id);
    if (id !== rootId && p && p.by != null && (!oldest || p.by < oldest.by)) oldest = p;
  }
  const line = [];
  const guard = new Set();
  let cur = data.people.get(rootId);
  while (cur && !guard.has(cur.id) && line.length < 120) { guard.add(cur.id); line.push(cur); cur = cur.father ? data.people.get(cur.father) : null; }
  const childCount = new Map();
  for (const id of num.keys()) {
    const p = data.people.get(id);
    for (const par of [p && p.father, p && p.mother]) if (par && num.has(par)) childCount.set(par, (childCount.get(par) || 0) + 1);
  }
  let implex = 0;
  for (const c of childCount.values()) if (c > 1) implex++;
  return { num, maxGen, count: Math.max(0, num.size - 1), oldest, line, implex };
}

/* ================================================================
   Beispiel (von Hand zusammengestellt)
   ================================================================ */
const EXAMPLE = {
  example: true, name: 'Müller', mode: 'nachname', first: '', last: 'Müller', src: {}, tree: null, ui: {},
  ai: {
    status: 'ok', provider: 'Beispiel', model: '',
    data: {
      name: 'Müller',
      kurz: 'Müller ist ein Berufsname für den Betreiber einer Mühle. Weil fast jedes Dorf eine Mühle hatte, entstand der Name an vielen Orten unabhängig voneinander – deshalb ist er heute der häufigste Familienname in Deutschland.',
      bedeutung: 'Müller, Betreiber einer Mühle',
      namenstyp: 'Berufsname',
      sprachraum: 'Deutsch, niederdeutsch auch Möller',
      aeltesteWurzel: '*melh₂- „mahlen“ (Indogermanisch)',
      zeitschichten: [
        { zeit: 'heute', jahr: 2000, form: 'Müller', sprache: 'Neuhochdeutsch', text: 'Häufigster Familienname in Deutschland und der Schweiz. In Auswandererländern oft ohne Umlaut als Mueller oder Muller geschrieben.', sicherheit: 'belegt', quelle: 'Namenkunde' },
        { zeit: 'ab 1874/76', jahr: 1875, form: 'Müller', sprache: 'Standesamtsregister', text: 'Mit den Standesämtern (Preußen 1874, ganzes Deutsches Reich 1876) wird die Schreibweise amtlich beurkundet. Davor schwankt sie in Kirchenbüchern zwischen Müller, Müllner und Miller.', sicherheit: 'belegt', quelle: 'Namenkunde' },
        { zeit: '16.–17. Jh.', jahr: 1550, form: 'Molitor', sprache: 'Humanistenlatein', text: 'Gelehrte übersetzen ihren Namen ins Lateinische oder Griechische: Aus Müller wird Molitor oder Mylius. Beide Formen leben als eigene Familiennamen weiter.', sicherheit: 'belegt', quelle: 'Namenkunde' },
        { zeit: '13.–14. Jh.', jahr: 1250, form: 'mülner', sprache: 'Mittelhochdeutsch', text: 'Die Berufsbezeichnung (mhd. mülnære, müller) wird zum vererbten Beinamen. In Städten setzen sich feste Familiennamen ab dem 12./13. Jahrhundert durch, auf dem Land oft erst später.', sicherheit: 'wahrscheinlich', quelle: 'Namenkunde' },
        { zeit: '8.–11. Jh.', jahr: 800, form: 'mulināri', sprache: 'Althochdeutsch', text: 'Das Wort wird aus dem Spätlatein übernommen – zusammen mit der Wassermühle, die aus dem Römischen Reich kam.', sicherheit: 'belegt', quelle: 'Namenkunde' },
        { zeit: '4.–6. Jh.', jahr: 400, form: 'molinarius', sprache: 'Spätlatein', text: '„Der an der Mühle (molina) arbeitet“ – gebildet zu lateinisch mola „Mühlstein, Mühle“ und molere „mahlen“.', sicherheit: 'belegt', quelle: 'Namenkunde' },
        { zeit: 'ca. 4000–2500 v. Chr.', jahr: -3500, form: '*melh₂-', sprache: 'Indogermanisch (rekonstruiert)', text: 'Rekonstruierte Wurzel für „mahlen, zerreiben“. Auf sie gehen auch Mehl und englisch meal zurück.', sicherheit: 'wahrscheinlich', quelle: 'Sprachwissenschaft' }
      ],
      varianten: ['Mueller', 'Muller', 'Möller', 'Müllner', 'Miller', 'Molitor', 'Mylius'],
      verwandt: ['Möllers', 'Mühlmann', 'Mühlbauer'],
      regionen: [
        { region: 'Ganz Deutschland', text: 'Kein einzelnes Ursprungsgebiet: Der Name entstand überall dort, wo Mühlen standen.' },
        { region: 'Norddeutschland', text: 'Niederdeutsche Form Möller.' },
        { region: 'Schwaben und Bayern', text: 'Mundartliche Form Miller.' }
      ],
      fruehePersonen: [
        { name: 'Johannes Müller (Regiomontanus)', zeit: '1436–1476', info: 'Astronom und Mathematiker aus Königsberg in Franken', quelle: 'Wikipedia' },
        { name: 'Johannes von Müller', zeit: '1752–1809', info: 'Schweizer Historiker aus Schaffhausen', quelle: 'Wikipedia' },
        { name: 'Wilhelm Müller', zeit: '1794–1827', info: 'Dichter der „Winterreise“, vertont von Franz Schubert', quelle: 'Wikipedia' }
      ],
      person: '',
      vorfahren: [],
      wissenswertes: [
        'Müller ist ein polygenetischer Name: Die meisten Familien Müller sind nicht miteinander verwandt.',
        'Die Wassermühle kam mit den Römern über die Alpen – das Wort für den Müller wanderte mit der Technik.',
        'Der Astronom Regiomontanus hieß eigentlich Johannes Müller; sein Gelehrtenname bezieht sich auf seinen Geburtsort Königsberg.'
      ],
      forschungstipps: [
        'Bei häufigen Namen immer mit Ort und ungefährem Geburtsjahr suchen, sonst wird die Trefferliste zu groß.',
        'Vor 1876 sind Kirchenbücher die Hauptquelle: evangelische bei Archion, katholische teils kostenlos bei Matricula.',
        'In alten Einträgen auch nach Molitor, Miller und Möller suchen – dieselbe Familie kann unterschiedlich geschrieben sein.'
      ],
      hinweis: 'Von Hand zusammengestelltes Beispiel. Echte Ergebnisse verbinden Live-Quellen mit KI und markieren jede Aussage nach ihrer Sicherheit.'
    }
  }
};
const EXAMPLES = {
  nachname: ['Müller', 'Schmidt', 'Nowak', 'Rossi'],
  vorname: ['Johanna', 'Friedrich', 'Mia', 'Emil'],
  person: ['Johann Sebastian Bach', 'Martin Luther', 'Ludwig van Beethoven']
};
const PLACEHOLDER = { nachname: 'z. B. Müller', vorname: 'z. B. Johanna', person: 'z. B. Johann Sebastian Bach' };

/* ================================================================
   Zustand & Suche
   ================================================================ */
let R = null;
function splitName(name, mode) {
  if (mode === 'vorname') return { first: name, last: '' };
  if (mode === 'nachname') return { first: '', last: name };
  if (name.includes(',')) { const [l, f] = name.split(',').map(x => x.trim()); return { first: f || '', last: l || '' }; }
  const toks = name.split(' ').filter(Boolean);
  if (toks.length === 1) return { first: '', last: toks[0] };
  const last = toks[toks.length - 1];
  const first = toks.slice(0, -1).filter(t => !PARTICLES.test(t.toLowerCase())).join(' ');
  return { first, last };
}
function currentMode() { const r = document.querySelector('input[name="mode"]:checked'); return r ? r.value : 'nachname'; }
function setMode(mode) { const r = document.querySelector(`input[name="mode"][value="${mode}"]`); if (r) r.checked = true; $('#nameInput').placeholder = PLACEHOLDER[mode] || ''; renderRecent(); }

async function startSearch(rawName, mode) {
  const name = capName(String(rawName || '').replace(/\s+/g, ' ').trim()).slice(0, 80);
  if (!name) { $('#nameInput').focus(); return; }
  if (runCtl) runCtl.abort();
  runCtl = new AbortController();
  const my = ++runId;
  const parts = splitName(name, mode);
  R = { example: false, name, mode, first: parts.first, last: parts.last, src: {}, tree: null, ai: { status: 'wait' }, ui: {} };
  addRecent(name, mode);
  setBusy(true);
  logReset();
  renderResult();
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#progress').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  try {
    if (IS_CLAUDE) logAdd('Live-Datenbanken', 'skip', 'in Claude gesperrt – die KI nutzt ihr eigenes Wissen');
    else await gatherSources(my);
    if (my !== runId) return;
    await runAnalysis(my, false);
  } catch (e) {
    if (!(e && e.cancelled) && my === runId) logAdd('Unerwarteter Fehler', 'fail', e && e.message);
  } finally {
    if (my === runId) { setBusy(false); runCtl = null; renderResult(); }
  }
}
async function gatherSources(my) {
  const S = cfg.sources;
  const kind = R.mode === 'vorname' ? 'vorname' : 'nachname';
  const nm = R.mode === 'vorname' ? R.name : R.last;
  const jobs = [];
  const job = (key, label, fn) => {
    const li = logAdd(label);
    jobs.push((async () => {
      try {
        const d = await fn(msg => { if (my === runId) logUpd(li, 'run', msg); });
        if (my !== runId) return;
        R.src[key] = Object.assign({ status: 'ok' }, d);
        logUpd(li, d.empty ? 'skip' : 'ok', d.summary || '');
      } catch (e) {
        if ((e && e.cancelled) || my !== runId) return;
        R.src[key] = { status: 'fail', error: (e && e.message) || String(e) };
        logUpd(li, 'fail', (e && e.message) || 'Fehler');
      }
      if (my === runId) renderResult();
    })());
  };
  let itemP = Promise.resolve(null);
  if (S.wikidata && nm) {
    itemP = wdFindNameItem(nm, kind).catch(e => { if (e && e.cancelled) throw e; return null; });
    itemP.catch(() => null);
    job('wd', `Wikidata · ${kind === 'vorname' ? 'Vorname' : 'Familienname'} „${nm}“`, prog => srcWikidataName(nm, kind, itemP, prog));
  }
  let personP = Promise.resolve(null);
  if (R.mode === 'person' && S.wikidata) {
    personP = srcWikidataPerson(R.name);
    personP.catch(() => null);
    job('wdPerson', `Wikidata · Person „${R.name}“`, async prog => {
      const d = await personP;
      if (d.best) { prog(`Stammbaum von ${d.best.name} wird geladen …`); await loadTree({ source: 'Wikidata', id: d.best.id, label: d.best.name }, my); }
      return d;
    });
  }
  if (S.wikipedia) {
    if (R.mode === 'person') {
      job('wpPerson', `Wikipedia · Person „${R.name}“`, () => srcWikipediaPerson(R.name, personP.catch(() => null)));
      if (nm) job('wpDe', `Wikipedia · Name „${nm}“`, () => srcWikipediaName('de', nm, kind, itemP.catch(() => null)));
    } else {
      job('wpDe', 'Wikipedia (deutsch)', () => srcWikipediaName('de', nm, kind, itemP.catch(() => null)));
      job('wpEn', 'Wikipedia (englisch)', () => srcWikipediaName('en', nm, kind, itemP.catch(() => null)));
    }
  }
  if (S.wiktionary && nm) {
    job('wiktDe', 'Wiktionary (deutsch)', () => srcWiktionary('de', nm));
    job('wiktEn', 'Wiktionary (englisch)', () => srcWiktionary('en', nm));
  }
  if (S.wikitree && R.mode !== 'vorname' && nm) job('wt', `WikiTree · Familienname „${nm}“`, () => srcWikiTreeSurname(nm));
  if (S.wikitree && R.mode === 'person' && R.first) job('wtPerson', `WikiTree · Person „${R.name}“`, () => srcWikiTreePerson(R.first, R.last));
  if (S.gnd && nm) job('gnd', 'GND · Deutsche Nationalbibliothek', () => srcGND(nm, kind));
  if (S.nationalize && nm) job('nat', 'nationalize.io · heutige Verbreitung', () => srcNationalize(nm));
  if (!jobs.length) logAdd('Keine Live-Quellen aktiv', 'skip', 'in „KI & Quellen“ einschalten');
  await Promise.all(jobs);
}
async function loadTree(cand, my) {
  const target = R;
  target.tree = Object.assign({}, target.tree || {}, { loading: cand, error: null });
  renderTree();
  try {
    const data = cand.source === 'Wikidata' ? await wdAncestors(cand.id) : await wtAncestors(cand.key);
    if (R !== target || (my !== undefined && my !== runId)) return;
    target.tree = { data, viewRoot: data.rootId, loading: null, error: null, cand };
  } catch (e) {
    if (e && e.cancelled) return;
    if (R !== target) return;
    target.tree = Object.assign({}, target.tree || {}, { loading: null, error: `${cand.source}: ${(e && e.message) || 'Fehler'}` });
  }
  renderResult();
}
async function rerootTree(id) {
  const T = R && R.tree;
  if (!T || !T.data) return;
  const data = T.data;
  const p = data.people.get(id);
  if (!p) return;
  T.viewRoot = id;
  renderTree();
  if (data.source === 'WikiTree' && p.key && !(data.fetched && data.fetched.has(p.key))) {
    try {
      const more = await wtAncestors(p.key);
      for (const [k, v] of more.people) if (!data.people.has(k)) data.people.set(k, v);
      data.fetched = data.fetched || new Set();
      data.fetched.add(p.key);
      if (R && R.tree === T) renderTree();
    } catch { /* bleibt bei den geladenen Generationen */ }
  }
}
async function runAnalysis(my, refresh) {
  const prov = effProvider();
  if (prov === 'none' || (prov === 'claude' && (claudeState === 'absent' || claudeState === 'denied'))) { R.ai = { status: 'off' }; renderResult(); return; }
  const li = logAdd(`KI-Auswertung · ${PROV[prov].name}`);
  R.ai = { status: 'run', provider: PROV[prov].name, msg: 'startet …' };
  renderResult();
  const target = R;
  try {
    const res = await runAI(prov, buildPrompt(R), msg => {
      if (my !== runId || R !== target) return;
      target.ai.msg = msg; logUpd(li, 'run', msg); renderStrata();
    }, refresh);
    if (my !== runId || R !== target) return;
    const obj = parseAIJSON(res.text);
    if (!obj) {
      target.ai = { status: 'error', provider: res.provider, model: res.model, error: res.truncated ? 'Die Antwort wurde abgeschnitten. Bitte erneut versuchen.' : 'Die Antwort der KI war nicht lesbar.', raw: res.text };
      logUpd(li, 'fail', 'Antwort nicht lesbar');
    } else {
      target.ai = { status: 'ok', provider: res.provider, model: res.model, data: normAI(obj), truncated: res.truncated };
      logUpd(li, 'ok', `${res.provider}${res.model ? ' · ' + res.model : ''}`);
    }
  } catch (e) {
    if ((e && e.cancelled) || my !== runId || R !== target) { if (target.ai && target.ai.status === 'run') target.ai = { status: 'cancelled' }; logUpd(li, 'skip', 'abgebrochen'); return; }
    target.ai = { status: 'error', provider: PROV[prov].name, error: (e && e.message) || String(e), raw: (e && e.partial) || '' };
    logUpd(li, 'fail', (e && e.message) || 'Fehler');
  }
  renderResult();
}
async function reanalyze() {
  if (!R || R.example || runCtl) return;
  runCtl = new AbortController();
  const my = runId;
  setBusy(true);
  $('#progress').hidden = false;
  try { await runAnalysis(my, true); }
  finally { if (my === runId) { setBusy(false); runCtl = null; renderResult(); } }
}
function stopSearch() {
  if (runCtl) runCtl.abort();
  runId++;
  runCtl = null;
  if (R && R.ai && (R.ai.status === 'run' || R.ai.status === 'wait')) R.ai = { status: 'cancelled' };
  logAdd('Abgebrochen', 'skip', '');
  setBusy(false);
  renderResult();
}

/* ================================================================
   Darstellung
   ================================================================ */
function setBusy(b) {
  const go = $('#btnGo');
  go.disabled = b;
  go.textContent = b ? 'Läuft …' : 'Zurückverfolgen';
  $('#btnStop').hidden = !b;
}
function logReset() { $('#log').innerHTML = ''; $('#progress').hidden = false; }
function logAdd(label, state = 'run', detail = '') {
  const li = document.createElement('li');
  li.dataset.s = state;
  li.innerHTML = '<span class="st" aria-hidden="true"></span><span><span class="l"></span> <span class="d"></span></span>';
  li.querySelector('.l').textContent = label;
  li.querySelector('.d').textContent = detail ? `— ${detail}` : '';
  $('#log').appendChild(li);
  return li;
}
function logUpd(li, state, detail) {
  if (!li) return;
  li.dataset.s = state;
  if (detail != null) li.querySelector('.d').textContent = detail ? `— ${detail}` : '';
}
const CERT = { belegt: ['●', 'belegt'], wahrscheinlich: ['◐', 'wahrscheinlich'], unsicher: ['○', 'unsicher'] };
const certChip = c => { const k = CERT[c] ? c : 'wahrscheinlich'; return `<span class="cert cert-${k}" title="Sicherheit"><span aria-hidden="true">${CERT[k][0]}</span> ${CERT[k][1]}</span>`; };

function renderResult() {
  if (!R) return;
  renderHead(); renderStrata(); renderTree(); renderRecords(); renderSide(); renderResearch(); renderSources();
}
function renderHead() {
  const d = R.ai && R.ai.data;
  $('#resBadge').hidden = !R.example;
  $('#resMode').textContent = ({ nachname: 'Familienname', vorname: 'Vorname', person: 'Person' })[R.mode] + (R.mode === 'person' && R.last ? ` · Familienname ${R.last}` : '');
  $('#resName').textContent = R.name;
  let summary = (d && d.kurz) || '';
  if (!summary) { const s = R.src; const wp = (s.wpPerson && s.wpPerson.text) || (s.wpDe && s.wpDe.text) || (s.wpEn && s.wpEn.text); if (wp) summary = clip(wp.split('\n')[0], 360); }
  if (!summary && R.ai && (R.ai.status === 'run' || R.ai.status === 'wait')) summary = 'Die Spur wird gerade verfolgt …';
  $('#resSummary').textContent = summary;
  $('#resSummary').hidden = !summary;
  const facts = [];
  if (d) {
    if (d.namenstyp) facts.push(['Namenstyp', d.namenstyp]);
    if (d.bedeutung) facts.push(['Bedeutung', d.bedeutung]);
    if (d.sprachraum) facts.push(['Sprachraum', d.sprachraum]);
    if (d.aeltesteWurzel) facts.push(['Älteste Wurzel', d.aeltesteWurzel]);
  }
  const firstDb = collectRecords(R, false).find(r => r.year != null);
  if (firstDb) facts.push(['Ältester Datenbank-Beleg', `${firstDb.yearLabel || fmtYear(firstDb.year)} · ${firstDb.name}`]);
  const wd = R.src.wd;
  if (wd && wd.status === 'ok' && wd.total) facts.push(['In Wikidata', `${nf(wd.total)} Namensträger`]);
  if (R.tree && R.tree.data) { const st = treeStats(R.tree.data, R.tree.data.rootId); if (st.count) facts.push(['Stammbaum', `${nf(st.count)} Vorfahren · ${st.maxGen} Generationen`]); }
  $('#resFacts').innerHTML = facts.slice(0, 6).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('#resFacts').hidden = !facts.length;
  const acts = [];
  const busy = !!runCtl;
  if (!R.example && d) acts.push('<button type="button" class="btn ghost small" data-act="copy">Zusammenfassung kopieren</button>');
  if (!R.example && !busy && R.ai && ['ok', 'error', 'cancelled'].includes(R.ai.status) && effProvider() !== 'none') acts.push('<button type="button" class="btn ghost small" data-act="reai">Neu auswerten</button>');
  $('#resActions').innerHTML = acts.length ? acts.join('') + '<span id="copyOut" class="note" aria-live="polite"></span>' : '';
}
function ghostLayers() {
  return ['gegenwart', 'neuzeit', 'mittelalter', 'antike', 'urzeit'].map(e => `<li class="layer ghost era-${e}"><div class="core" aria-hidden="true"></div><div class="layer-body"><span class="ln"></span><span class="ln big"></span><span class="ln"></span></div></li>`).join('');
}
function renderStrata() {
  const st = R.ai ? R.ai.status : 'off';
  const d = R.ai && R.ai.data;
  const box = $('#strata'), state = $('#strataState'), wrap = $('#strataWrap');
  $('#strataNote').textContent = '';
  if (st === 'ok' && d && d.zeitschichten.length) {
    state.innerHTML = '';
    wrap.hidden = false;
    box.classList.toggle('static', !!R.example);
    box.innerHTML = d.zeitschichten.map((z, i) => {
      const y = z.jahr != null ? z.jahr : guessYear(z.zeit);
      const era = eraOf(y);
      const reko = /^\s*\*/.test(z.form);
      return `<li class="layer era-${era}" style="--i:${i}">
  <div class="core" aria-hidden="true"><span class="yr">${coreYearHTML(y)}</span><span class="era">${esc(ERA[era])}</span></div>
  <div class="layer-body">
    <div class="layer-meta"><span>${esc(z.zeit || fmtYear(y))}</span>${z.sprache ? `<span>${esc(z.sprache)}</span>` : ''}<span class="sr-only">${esc(ERA[era])}</span></div>
    ${z.form ? `<p class="form${reko ? ' reko' : ''}">${esc(z.form)}</p>` : ''}
    ${z.text ? `<p class="layer-text">${esc(z.text)}</p>` : ''}
    <div class="tags">${certChip(z.sicherheit)}${z.quelle ? `<span class="src">${esc(z.quelle)}</span>` : ''}</div>
  </div>
</li>`;
    }).join('');
    const last = d.zeitschichten[d.zeitschichten.length - 1];
    $('#deepest').textContent = d.aeltesteWurzel || (last ? `${last.zeit}${last.sprache ? ' · ' + last.sprache : ''}` : '');
    const notes = [];
    if (d.hinweis) notes.push(`Hinweis: ${d.hinweis}`);
    if (R.ai.truncated) notes.push('Die KI-Antwort wurde gekürzt.');
    $('#strataNote').textContent = notes.join(' ');
    return;
  }
  if (st === 'run' || st === 'wait') {
    wrap.hidden = false;
    $('#deepest').textContent = '';
    box.innerHTML = ghostLayers();
    const msg = st === 'wait' ? 'Quellen werden gesammelt …' : (R.ai.msg || 'startet …');
    state.innerHTML = `<div class="state-box"><span class="spin" aria-hidden="true"></span><div><b>${st === 'wait' ? 'Quellen werden gesammelt' : 'Die KI zeichnet die Zeitschichten'}</b><p class="note">${esc(msg)}</p></div></div>`;
    return;
  }
  wrap.hidden = true;
  box.innerHTML = '';
  const wikt = (R.src.wiktDe && R.src.wiktDe.text) || (R.src.wiktEn && R.src.wiktEn.text) || '';
  const quote = wikt ? `<p class="note" style="margin-top:12px">Herkunft laut Wiktionary:</p><p class="quote">${esc(clip(wikt, 700))}</p>` : '';
  if (st === 'error') {
    state.innerHTML = `<div class="state-box bad"><div><b>Die KI-Auswertung hat nicht geklappt.</b><p>${esc(R.ai.error || '')}</p><div class="row"><button type="button" class="btn ghost small" data-act="reai">Erneut versuchen</button>${IS_CLAUDE ? '' : '<button type="button" class="btn ghost small" data-act="openSettings">KI-Einstellungen</button>'}</div>${R.ai.raw ? `<details class="more"><summary>Rohantwort der KI</summary><pre>${esc(clip(R.ai.raw, 6000))}</pre></details>` : ''}${quote}</div></div>`;
  } else if (st === 'cancelled') {
    state.innerHTML = `<div class="state-box"><div><b>Abgebrochen.</b><p class="note">Starte die Suche erneut, um die Zeitschichten zu erzeugen.</p>${quote}</div></div>`;
  } else {
    const txt = IS_CLAUDE
      ? (claudeState === 'denied' ? 'Die Seite darf Claude gerade nicht nutzen. Lade die Seite neu, um erneut gefragt zu werden.' : 'Claude ist in dieser Ansicht nicht verfügbar.')
      : 'Für die Zeitschichten braucht Namensspur eine KI. Kostenlos: Gemini, Groq oder OpenRouter mit Gratis-Schlüssel oder Puter ganz ohne Schlüssel. Sehr günstig: DeepSeek.';
    state.innerHTML = `<div class="state-box"><div><b>Ohne KI-Auswertung</b><p>${esc(txt)}</p>${IS_CLAUDE ? '' : '<button type="button" class="btn ghost small" data-act="openSettings">KI einrichten</button>'}${quote}</div></div>`;
  }
}

/* Früheste Belege */
let lastChart = null;
function renderRecords() {
  const sec = $('#secRecords');
  const recs = collectRecords(R, true);
  const wd = R.src.wd;
  const cents = wd && wd.status === 'ok' ? (wd.centuries || []) : [];
  sec.hidden = !recs.length && cents.length < 2;
  if (sec.hidden) { lastChart = null; return; }
  const first = recs.find(r => r.year != null);
  $('#recIntro').textContent = first ? `Ältester Eintrag: ${first.name} (${first.yearLabel || fmtYear(first.year)}, Quelle: ${first.source}).` : '';
  const chartBox = $('#centChart');
  if (cents.length >= 2) { chartBox.hidden = false; lastChart = { cents, dated: wd.dated }; drawCenturyChart(); }
  else { chartBox.hidden = true; lastChart = null; }
  const showAll = R.ui && R.ui.allRecords;
  const rows = showAll ? recs : recs.slice(0, 25);
  $('#recTable').innerHTML = rows.length ? `<table><thead><tr><th scope="col">Geboren</th><th scope="col">Name</th><th scope="col">Angaben</th><th scope="col">Quelle</th></tr></thead><tbody>${rows.map(r => {
    const u = r.url ? safeUrl(r.url) : '';
    return `<tr><td class="num">${esc(r.yearLabel || fmtYear(r.year) || '–')}</td><td>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td><td>${esc(r.info || '')}</td><td><span class="src">${esc(r.source)}</span></td></tr>`;
  }).join('')}</tbody></table>` : '';
  $('#recTable').hidden = !rows.length;
  const more = $('#recMore');
  more.hidden = recs.length <= 25 || !!showAll;
  more.textContent = `Alle ${nf(recs.length)} Einträge zeigen`;
}
function niceStep(v) {
  if (v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function barPath(x, yBase, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  const yt = yBase - h;
  return `M${x},${yBase}L${x},${yt + r}Q${x},${yt} ${x + r},${yt}L${x + w - r},${yt}Q${x + w},${yt} ${x + w},${yt + r}L${x + w},${yBase}Z`;
}
function drawCenturyChart() {
  const box = $('#centChart');
  if (!lastChart || box.hidden) return;
  const { cents, dated } = lastChart;
  let minC = cents[0].c;
  const maxC = cents[cents.length - 1].c;
  if (maxC - minC > 59) minC = maxC - 59;
  const byC = new Map(cents.map(x => [x.c, x.n]));
  const all = [];
  for (let c = minC; c <= maxC; c++) all.push({ c, n: byC.get(c) || 0 });
  const W = Math.max(280, Math.round(box.clientWidth - 28)), H = 200;
  const padL = 40, padR = 8, padT = 12, padB = 40;
  const iw = W - padL - padR, ih = H - padT - padB;
  const maxN = Math.max(1, ...all.map(x => x.n));
  const step = niceStep(maxN / 4);
  const top = Math.ceil(maxN / step) * step;
  const yOf = v => padT + ih - (v / top) * ih;
  const slot = iw / all.length;
  const bw = Math.max(2, Math.min(24, slot - 2));
  const every = Math.max(1, Math.ceil(all.length / Math.max(4, Math.floor(iw / 42))));
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${yOf(v).toFixed(1)}" y2="${yOf(v).toFixed(1)}"></line><text class="tick" x="${padL - 6}" y="${(yOf(v) + 4).toFixed(1)}" text-anchor="end">${nf(v)}</text>`;
  let bars = '', ticks = '', hits = '';
  all.forEach((d, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    const h = (d.n / top) * ih;
    if (d.n > 0) bars += `<path class="bar" data-i="${i}" d="${barPath(x, padT + ih, bw, h, 4)}"></path>`;
    if (i % every === 0) ticks += `<text class="tick" x="${(x + bw / 2).toFixed(1)}" y="${padT + ih + 16}" text-anchor="middle">${esc(centShort(d.c))}</text>`;
    hits += `<rect class="hit" data-i="${i}" x="${(padL + i * slot).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${ih}"></rect>`;
  });
  box.innerHTML = `<p class="chart-title">Namensträger in Wikidata nach Geburtsjahrhundert</p><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Säulendiagramm: ${nf(dated)} Personen mit bekanntem Geburtsjahr, verteilt auf Jahrhunderte">${g}${bars}${ticks}<text class="tick" x="${padL}" y="${H - 4}">Jahrhundert (Geburt)</text>${hits}</svg><div class="tip" hidden></div>
<details class="more"><summary>Als Tabelle</summary><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th scope="col">Jahrhundert</th><th scope="col">Personen</th></tr></thead><tbody>${all.filter(x => x.n).map(x => `<tr><td>${esc(centLabel(x.c))}</td><td class="num">${nf(x.n)}</td></tr>`).join('')}</tbody></table></div></details>`;
  const tip = box.querySelector('.tip'), svg = box.querySelector('svg');
  let on = null;
  const clear = () => { tip.hidden = true; if (on) { on.classList.remove('on'); on = null; } };
  svg.addEventListener('pointermove', e => {
    const t = e.target.closest && e.target.closest('.hit');
    if (!t) { clear(); return; }
    const i = +t.dataset.i, d = all[i];
    tip.textContent = `${centLabel(d.c)}: ${nf(d.n)} ${d.n === 1 ? 'Person' : 'Personen'}`;
    const br = box.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(e.clientX - br.left, 60), br.width - 60)}px`;
    tip.style.top = `${e.clientY - br.top - 8}px`;
    tip.hidden = false;
    const b = svg.querySelector(`.bar[data-i="${i}"]`);
    if (on && on !== b) on.classList.remove('on');
    if (b) { b.classList.add('on'); on = b; }
  });
  svg.addEventListener('pointerleave', clear);
}

/* Stammbaum */
function pcard(data, id, k) {
  if (!id) return `<div class="pcard empty"><span class="k">${k}</span><span class="n">unbekannt</span></div>`;
  const p = data.people.get(id);
  const yrs = lifespan(p.by, p.dy);
  const inner = `<span class="k">${k}</span><span class="n">${esc(p.name)}</span>${yrs ? `<span class="y">${esc(yrs)}</span>` : ''}`;
  if (k === 1) return `<div class="pcard root" aria-current="true">${inner}</div>`;
  return `<button type="button" class="pcard" data-act="treeRoot" data-id="${esc(id)}" title="Vorfahren von ${esc(p.name)} anzeigen">${inner}</button>`;
}
function treeHTML(T) {
  const data = T.data;
  const root = data.people.has(T.viewRoot) ? T.viewRoot : data.rootId;
  const st = treeStats(data, root);
  const rp = data.people.get(root);
  const slots = [null, root];
  for (let k = 1; k < 8; k++) {
    const p = slots[k] ? data.people.get(slots[k]) : null;
    slots[2 * k] = p && p.father && data.people.has(p.father) ? p.father : null;
    slots[2 * k + 1] = p && p.mother && data.people.has(p.mother) ? p.mother : null;
  }
  const genNames = ['Person', 'Eltern', 'Großeltern', 'Urgroßeltern'];
  const cols = [0, 1, 2, 3].map(g => {
    let cards = '';
    for (let k = 2 ** g; k < 2 ** (g + 1); k++) cards += pcard(data, slots[k], k);
    return `<div class="gen"><p class="gen-label">${genNames[g]}</p><div class="gen-cards">${cards}</div></div>`;
  }).join('');
  const facts = [
    ['Vorfahren gefunden', nf(st.count)],
    ['Generationen', nf(st.maxGen)],
    ['Ältester Vorfahr', st.oldest ? `${st.oldest.name} (geb. ${fmtYear(st.oldest.by)})` : '–'],
    ['Ahnenimplex', st.implex ? `${nf(st.implex)} Personen mehrfach` : 'keiner erkannt']
  ];
  const rootName = (data.people.get(data.rootId) || {}).name || 'Start';
  const u = safeUrl((rp && rp.url) || '');
  const rows = [...st.num.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)).slice(0, 400);
  return `<p class="tree-src">Quelle: ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(data.source)}</a>` : esc(data.source)}${data.truncated ? ' · Ergebnis gekürzt' : ''}${root !== data.rootId ? ` · Ansicht ab ${esc(rp.name)} · <button type="button" class="linkbtn" data-act="treeRoot" data-id="${esc(data.rootId)}">zurück zu ${esc(rootName)}</button>` : ''}</p>
<dl class="facts small">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
<div class="pedigree-wrap"><div class="pedigree">${cols}</div></div>
<p class="note" style="margin-top:8px">Tippe auf eine Person, um ihre Vorfahren weiter zurückzuverfolgen. Nummern nach Kekulé: 1 = Person, 2 = Vater, 3 = Mutter, 4 = Vater des Vaters und so weiter.</p>
${st.line.length > 1 ? `<h4>Väterliche Linie – meist die Linie des Familiennamens</h4><ol class="line">${st.line.map((p, i) => `<li><span class="g">${i === 0 ? 'Start' : `−${i}`}</span><span><b>${esc(p.name)}</b>${p.by != null || p.dy != null ? `<span class="y">${esc(lifespan(p.by, p.dy))}</span>` : ''}${i === st.line.length - 1 ? '<span class="endnote">ältester bekannter Vorfahr dieser Linie</span>' : ''}</span></li>`).join('')}</ol>` : ''}
${rows.length > 1 ? `<details class="more"><summary>Ahnenliste nach Kekulé (${nf(st.num.size)} Personen${st.num.size > 400 ? ', die ersten 400' : ''})</summary><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th scope="col">Nr.</th><th scope="col">Generation</th><th scope="col">Name</th><th scope="col">Lebensdaten</th></tr></thead><tbody>${rows.map(([id, k]) => { const p = data.people.get(id); const pu = safeUrl(p.url || ''); return `<tr><td class="num">${esc(k.toString())}</td><td class="num">${k.toString(2).length - 1}</td><td>${pu ? `<a href="${esc(pu)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td><td class="num">${esc(lifespan(p.by, p.dy))}</td></tr>`; }).join('')}</tbody></table></div></details>` : ''}
<p class="note" style="margin-top:10px">${data.source === 'Wikidata' ? 'Wikidata wird von Freiwilligen gepflegt. Sehr frühe Generationen, etwa in Herrscherhäusern, können legendär oder umstritten sein.' : 'WikiTree ist ein gemeinsamer Stammbaum von Freiwilligen. Prüfe die Quellenangaben im jeweiligen Profil.'}</p>`;
}
function aiVorfahrenHTML(v) {
  return `<h4>Vorfahren laut KI-Wissen (ungeprüft)</h4><ol class="line">${v.map(x => `<li><span class="g">${x.generation != null ? `−${Math.abs(x.generation)}` : ''}</span><span><b>${esc(x.name)}</b>${x.zeit ? `<span class="y">${esc(x.zeit)}</span>` : ''}<span class="note" style="display:block">${esc(x.beziehung)} ${certChip(x.sicherheit)}</span></span></li>`).join('')}</ol>`;
}
function candHTML(wdp, wtp) {
  const cur = R.tree && R.tree.cand;
  const item = (c, src) => {
    const active = cur && cur.source === src && ((src === 'Wikidata' && cur.id === c.id) || (src === 'WikiTree' && cur.key === c.key));
    return `<li><div><b>${esc(c.name)}</b> <span class="y">${esc(lifespan(c.by, c.dy))}</span>${c.info ? `<span class="ci">${esc(clip(c.info, 100))}</span>` : ''}</div>${active ? '<span class="note">angezeigt</span>' : `<button type="button" class="btn ghost small" data-act="loadTree" data-src="${src}" data-id="${esc(c.id)}" data-key="${esc(c.key || '')}" data-label="${esc(c.name)}">Stammbaum laden</button>`}</li>`;
  };
  return `<details class="cands"${R.tree && R.tree.data ? '' : ' open'}><summary>Andere Treffer (${wdp.length + wtp.length})</summary>${wdp.length ? `<h4>Wikidata</h4><ul>${wdp.slice(0, 8).map(c => item(c, 'Wikidata')).join('')}</ul>` : ''}${wtp.length ? `<h4>WikiTree</h4><ul>${wtp.slice(0, 10).map(c => item(c, 'WikiTree')).join('')}</ul>` : ''}</details>`;
}
function renderTree() {
  const sec = $('#secTree');
  sec.hidden = R.mode !== 'person';
  if (sec.hidden) return;
  const T = R.tree;
  const aiV = (R.ai && R.ai.data && R.ai.data.vorfahren) || [];
  const wdp = (R.src.wdPerson && R.src.wdPerson.people) || [];
  const wtp = (R.src.wtPerson && R.src.wtPerson.people) || [];
  const parts = [];
  if (T && T.loading) parts.push(`<p class="state-line"><span class="spin" aria-hidden="true"></span> Stammbaum von ${esc(T.loading.label)} wird geladen (${esc(T.loading.source)}) …</p>`);
  if (T && T.error) parts.push(`<p class="state-line bad">${esc(T.error)}</p>`);
  if (T && T.data) parts.push(treeHTML(T));
  else if (!(T && T.loading)) {
    if (aiV.length) parts.push(aiVorfahrenHTML(aiV));
    else if (IS_CLAUDE) parts.push(`<p class="note">In Claude sind Stammbaum-Datenbanken gesperrt${R.ai && R.ai.status === 'ok' ? ', und die KI kennt keine gesicherten Vorfahren dieser Person' : ''}. Die eigenständige Version fragt Wikidata und WikiTree live ab.</p>`);
    else if (R.src.wdPerson || R.src.wtPerson) parts.push('<p class="note">Keine öffentlichen Stammbaumdaten gefunden. Das ist bei Privatpersonen normal: Stammbäume lebender oder wenig bekannter Menschen stehen nicht in offenen Datenbanken. Die Links unter „Selbst weiterforschen“ helfen beim eigenen Suchen.</p>');
    else parts.push('<p class="note">Stammbaum wird gesucht …</p>');
  }
  if (wdp.length || wtp.length) parts.push(candHTML(wdp, wtp));
  $('#treeBody').innerHTML = parts.join('');
}

/* Randspalte */
function renderSide() {
  const d = (R.ai && R.ai.data) || {};
  const base = fold(R.mode === 'vorname' ? R.name : R.last);
  const wtVar = [];
  if (R.src.wt && R.src.wt.status === 'ok') {
    const cnt = new Map();
    for (const p of R.src.wt.people || []) if (p.lastBirth && fold(p.lastBirth) !== base) cnt.set(p.lastBirth, (cnt.get(p.lastBirth) || 0) + 1);
    wtVar.push(...[...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]));
  }
  const v = uniqBy([...(d.varianten || []), ...((R.src.wd && R.src.wd.variants) || []), ...wtVar]).filter(x => fold(x) !== base).slice(0, 24);
  const rel = uniqBy(d.verwandt || []).filter(x => fold(x) !== base).slice(0, 12);
  const vmode = R.mode === 'vorname' ? 'vorname' : 'nachname';
  const chip = x => `<button type="button" class="chip" data-act="search" data-name="${esc(x)}" data-mode="${vmode}">${esc(x)}</button>`;
  $('#secVariants').hidden = !v.length && !rel.length;
  $('#variants').innerHTML = v.map(chip).join('');
  $('#related').innerHTML = rel.length ? `<p class="mini-h">Gleiche Wurzel</p><div class="chips">${rel.map(chip).join('')}</div>` : '';
  const regs = d.regionen || [];
  const nat = R.src.nat && R.src.nat.status === 'ok' ? (R.src.nat.countries || []) : [];
  const places = R.src.wd && R.src.wd.status === 'ok' ? (R.src.wd.places || []) : [];
  $('#secSpread').hidden = !regs.length && !nat.length && !places.length;
  const maxP = Math.max(0.0001, ...nat.map(c => c.p));
  $('#spread').innerHTML = [
    regs.length ? `<ul class="plain">${regs.map(r => `<li><b>${esc(r.region)}</b>${r.text ? ` – ${esc(r.text)}` : ''}</li>`).join('')}</ul>` : '',
    nat.length ? `<p class="mini-h">Heutige Länder (Schätzung)</p><div class="bars">${nat.map(c => `<div class="bar-row"><span>${esc(c.name)}</span><span class="pct">${Math.round(c.p * 100)} %</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round((c.p / maxP) * 100))}%"></div></div></div>`).join('')}</div><p class="note" style="margin-top:6px">Wahrscheinlichkeit laut nationalize.io</p>` : '',
    places.length ? `<p class="mini-h">Häufigste Geburtsorte (Wikidata)</p><ul class="plain compact">${places.slice(0, 8).map(p => `<li>${esc(p.name)} <span class="y">${nf(p.n)}</span></li>`).join('')}</ul>` : ''
  ].join('');
  const w = d.wissenswertes || [];
  const pers = d.person || '';
  $('#secKnow').hidden = !w.length && !pers;
  $('#know').innerHTML = (pers ? `<p style="margin:0 0 10px">${esc(pers)}</p>` : '') + (w.length ? `<ul class="plain">${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
}

/* Weiterforschen */
function linkGroups(R) {
  const last = R.mode === 'vorname' ? '' : R.last;
  const first = R.mode === 'vorname' ? R.name : (R.first || '').split(' ')[0];
  const nm = last || first;
  const full = R.mode === 'person' ? R.name : nm;
  const g1 = { title: 'Stammbaum-Datenbanken', links: [] };
  if (last) {
    g1.links.push({ name: 'FamilySearch', desc: 'Größte kostenlose Sammlung: Kirchenbücher, Zensus, Stammbäume', url: `https://www.familysearch.org/search/record/results?${qs({ 'q.surname': last, 'q.givenName': first })}` });
    g1.links.push({ name: 'WikiTree', desc: 'Gemeinsamer Welt-Stammbaum, frei zugänglich', url: `https://www.wikitree.com/genealogy/${encodeURIComponent(last.toUpperCase())}` });
    g1.links.push({ name: 'GEDBAS', desc: 'Stammbäume deutscher Familienforscher', url: `https://gedbas.genealogy.net/search/simple?${qs({ lastname: last, firstname: first })}` });
    g1.links.push({ name: 'CompGen Metasuche', desc: 'Verlustlisten, Adressbücher, Ortsfamilienbücher', url: `https://meta.genealogy.net/search/index?${qs({ lastname: last })}` });
    g1.links.push({ name: 'Geneanet', desc: 'Europäische Stammbäume und Register', url: `https://de.geneanet.org/fonds/individus/?${qs({ go: 1, nom: last, prenom: first })}` });
    g1.links.push({ name: 'Ancestry', desc: 'Suche kostenlos, Einsicht meist kostenpflichtig', url: `https://www.ancestry.de/search/?${qs({ name: `${first || ''}_${last}` })}` });
  } else {
    g1.links.push({ name: 'FamilySearch', desc: 'Personen mit diesem Vornamen in historischen Registern', url: `https://www.familysearch.org/search/record/results?${qs({ 'q.givenName': first })}` });
  }
  const g2 = { title: 'Namenkunde', links: [] };
  if (last) {
    g2.links.push({ name: 'Familiennamenwörterbuch (DFD)', desc: 'Wissenschaftliche Deutung, Namen dort eingeben', url: 'https://www.namenforschung.net/dfd/woerterbuch/liste/' });
    g2.links.push({ name: 'Geogen', desc: 'Verbreitungskarte in Deutschland', url: `https://legacy.stoepel.net/de/Default.aspx?${qs({ name: last })}` });
    g2.links.push({ name: 'Forebears', desc: 'Weltweite Häufigkeit und Verbreitung', url: `https://forebears.io/surnames/${encodeURIComponent(slug(last))}` });
    g2.links.push({ name: 'Behind the Name', desc: 'Herkunft von Familiennamen (englisch)', url: `https://surnames.behindthename.com/names/search.php?${qs({ terms: last })}` });
  } else {
    g2.links.push({ name: 'Behind the Name', desc: 'Herkunft und Bedeutung des Vornamens (englisch)', url: `https://www.behindthename.com/names/search.php?${qs({ terms: first })}` });
  }
  g2.links.push({ name: 'Google Books Ngram', desc: 'Wie oft der Name seit 1500 in Büchern steht', url: `https://books.google.com/ngrams/graph?${qs({ content: nm, year_start: 1500, year_end: 2022, corpus: 'de', smoothing: 3 })}` });
  g2.links.push({ name: 'Wiktionary', desc: 'Wörterbucheintrag mit Herkunft', url: `https://de.wiktionary.org/wiki/${encodeURIComponent(nm)}` });
  const g3 = { title: 'Archive und Kirchenbücher', links: [
    { name: 'Archion', desc: 'Evangelische Kirchenbücher online (kostenpflichtig)', url: 'https://www.archion.de/' },
    { name: 'Matricula', desc: 'Katholische Kirchenbücher, kostenlos', url: 'https://data.matricula-online.eu/de/' },
    { name: 'Deutsche Digitale Bibliothek', desc: 'Digitalisierte Urkunden, Bücher und Akten', url: `https://www.deutsche-digitale-bibliothek.de/searchresults?${qs({ query: full })}` },
    { name: 'Archivportal-D', desc: 'Bestände deutscher Archive', url: `https://www.archivportal-d.de/objekte?${qs({ query: full })}` }
  ] };
  return [g1, g2, g3];
}
function renderResearch() {
  const d = (R.ai && R.ai.data) || {};
  const tips = d.forschungstipps || [];
  $('#tips').innerHTML = tips.length ? `<ul class="plain">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  $('#links').innerHTML = linkGroups(R).map(g => `<div class="lk-group"><h4>${esc(g.title)}</h4><div class="linkgrid">${g.links.map(l => { const u = safeUrl(l.url); return u ? `<a class="lk" href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(l.name)}</b><span>${esc(l.desc)}</span></a>` : ''; }).join('')}</div></div>`).join('');
}

/* Quellen */
const SRC_META = {
  wpPerson: 'Wikipedia · Person', wpDe: 'Wikipedia (deutsch)', wpEn: 'Wikipedia (englisch)',
  wiktDe: 'Wiktionary (deutsch)', wiktEn: 'Wiktionary (englisch)',
  wd: 'Wikidata · Name', wdPerson: 'Wikidata · Person', wt: 'WikiTree · Familienname', wtPerson: 'WikiTree · Person',
  gnd: 'GND (Deutsche Nationalbibliothek)', nat: 'nationalize.io'
};
function renderSources() {
  const box = $('#sources');
  if (R.example) { box.innerHTML = '<p class="note">Beispiel ohne Live-Abfrage. Starte eine Suche, um die Quellen abzurufen.</p>'; return; }
  const items = Object.entries(R.src).map(([k, s]) => {
    const st = s.status === 'fail' ? ['fail', 'nicht erreichbar'] : s.empty ? ['skip', 'nichts gefunden'] : ['ok', 'abgerufen'];
    const u = s.url ? safeUrl(s.url) : '';
    const sum = s.status === 'fail' ? s.error : s.summary;
    return `<li><div class="row1"><span class="nm">${esc(SRC_META[k] || k)}</span><span class="state ${st[0]}">${st[1]}</span></div>${sum ? `<p class="sm">${esc(sum)}</p>` : ''}${u ? `<p class="sm"><a href="${esc(u)}" target="_blank" rel="noopener">${esc(s.title || 'Quelle öffnen')}</a></p>` : ''}${s.text ? `<details class="more"><summary>Ausgewerteter Text</summary><p class="excerpt">${esc(s.text)}</p></details>` : ''}</li>`;
  });
  let html = items.length ? `<ul class="srclist">${items.join('')}</ul>` : `<p class="note">${IS_CLAUDE ? 'In Claude sind externe Datenbanken gesperrt. Diese Auswertung beruht auf dem Wissen der KI; prüfe Details in den Links oben.' : 'Keine Live-Quellen abgefragt.'}</p>`;
  if (R.ai && R.ai.status === 'ok') html += `<p class="note" style="margin-top:10px">KI: ${esc(R.ai.provider)}${R.ai.model ? ` · ${esc(R.ai.model)}` : ''}. KI-Aussagen sind nach Sicherheit markiert und können Fehler enthalten.</p>`;
  box.innerHTML = html;
}

/* Kopfbereich & Einstellungen */
function activeSourcesText() {
  const on = Object.entries(cfg.sources).filter(([, v]) => v).map(([k]) => SOURCE_NAMES[k]);
  return on.length ? `${on.length} Live-Quellen` : 'keine Live-Quellen';
}
function renderAIStatus() {
  const el = $('#aiStatus');
  if (!el) return;
  if (IS_CLAUDE) {
    const t = {
      checking: 'KI: Claude wird verbunden …',
      ready: 'KI: <b>Claude</b> über dein Claude-Konto – keine Zusatzkosten.',
      absent: 'KI: Claude ist in dieser Ansicht nicht verfügbar.',
      denied: 'KI: Die Seite darf Claude nicht nutzen. Zum erneuten Fragen die Seite neu laden.'
    }[claudeState] || '';
    el.innerHTML = `${t} <button type="button" class="linkbtn" data-act="openSettings">Details</button>`;
  } else {
    const p = effProvider();
    el.innerHTML = `KI: <b>${esc(PROV[p].name)}</b>${p === 'puter' ? ' (ohne Schlüssel)' : ''} · ${esc(activeSourcesText())} <button type="button" class="linkbtn" data-act="openSettings">ändern</button>`;
  }
}
function renderRecent() {
  const mode = currentMode();
  const rec = store.get(RECENT_KEY, []).filter(x => x && x.name);
  $('#recent').innerHTML = `<span class="lbl">Beispiele</span>${EXAMPLES[mode].map(n => `<button type="button" class="chip" data-act="search" data-name="${esc(n)}" data-mode="${mode}">${esc(n)}</button>`).join('')}${rec.length ? `<span class="lbl">Zuletzt</span>${rec.map(x => `<button type="button" class="chip" data-act="search" data-name="${esc(x.name)}" data-mode="${esc(x.mode)}">${esc(x.name)}</button>`).join('')}` : ''}`;
}
function addRecent(name, mode) {
  const r = store.get(RECENT_KEY, []).filter(x => x && !(x.name === name && x.mode === mode));
  store.set(RECENT_KEY, [{ name, mode }, ...r].slice(0, 6));
  renderRecent();
}
function fieldKey(p) {
  const P = PROV[p];
  return `<label class="field-label" for="key_${p}">${esc(P.name)}-Schlüssel${P.key === 'optional' ? ' (falls nötig)' : ''}</label>
<div class="inrow"><input id="key_${p}" type="password" autocomplete="off" spellcheck="false" placeholder="Schlüssel einfügen" value="${esc(cfg.keys[p] || '')}" data-cfg="keys.${p}"><button type="button" class="btn ghost small" data-act="toggleKey" data-for="key_${p}">zeigen</button></div>
${P.keyUrl ? `<p class="note"><a href="${esc(P.keyUrl)}" target="_blank" rel="noopener">${p === 'deepseek' ? 'Schlüssel holen (Guthaben nötig)' : 'Kostenlosen Schlüssel holen'}</a> · ${esc(P.keyHost)}</p>` : ''}`;
}
function fieldModel(p) {
  return `<label class="field-label" for="model_${p}">Modell (leer = automatisch)</label>
<div class="inrow"><input id="model_${p}" type="text" list="dl_${p}" autocomplete="off" spellcheck="false" placeholder="automatisch" value="${esc(cfg.models[p] || '')}" data-cfg="models.${p}"><button type="button" class="btn ghost small" data-act="listModels" data-p="${p}">Modelle abrufen</button></div><datalist id="dl_${p}"></datalist>`;
}
function fieldBase(p) {
  return `<label class="field-label" for="base_${p}">Adresse (Base-URL)</label><input id="base_${p}" type="url" autocomplete="off" spellcheck="false" placeholder="https://…/v1" value="${esc(cfg.bases[p] || '')}" data-cfg="bases.${p}">`;
}
function renderSettings() {
  const sel = $('#provSel');
  const opts = IS_CLAUDE ? ['claude'] : ['auto', 'gemini', 'groq', 'openrouter', 'deepseek', 'puter', 'ollama', 'custom', 'none'];
  sel.innerHTML = opts.map(o => `<option value="${o}">${esc(o === 'auto' ? 'Automatisch – erster eingerichteter Dienst, sonst Puter' : PROV[o].label)}</option>`).join('');
  sel.value = IS_CLAUDE ? 'claude' : (opts.includes(cfg.provider) ? cfg.provider : 'auto');
  sel.disabled = IS_CLAUDE;
  renderProvFields();
  $('#srcToggles').innerHTML = Object.keys(SOURCE_NAMES).map(k => `<label><input type="checkbox" id="src_${k}" data-src="${k}"${cfg.sources[k] ? ' checked' : ''}${IS_CLAUDE ? ' disabled' : ''}> ${esc(SOURCE_NAMES[k])}</label>`).join('');
  $('#srcNote').textContent = IS_CLAUDE
    ? 'In Claude sind Anfragen an andere Websites gesperrt. Die Live-Quellen funktionieren in der eigenständigen Version.'
    : 'Alle Quellen sind frei zugänglich. Die Abfragen gehen direkt aus deinem Browser an die jeweiligen Dienste.';
  $('#siteNote').textContent = IS_CLAUDE
    ? 'Die eigenständige Version ist eine einzelne HTML-Datei: Sie fragt Wikipedia, Wikidata, WikiTree & Co. live ab und nutzt kostenlose oder günstige KIs (Gemini, Groq, OpenRouter, DeepSeek, Puter oder Ollama). Doppelklick öffnet sie im Browser; kostenlos online stellen z. B. über Netlify Drop oder GitHub Pages.'
    : 'Diese Seite ist eine einzelne HTML-Datei und damit schon eine komplette Website. Kostenlos online stellen: Datei in index.html umbenennen und auf app.netlify.com/drop ziehen oder bei GitHub Pages hochladen. Schlüssel bleiben nur in deinem Browser gespeichert.';
}
const autoNote = eff => `Aktuell: ${PROV[eff].name}. Trag unten einen Schlüssel ein, um einen stärkeren Dienst zu nutzen: Gemini, Groq und OpenRouter sind kostenlos, DeepSeek kostet Bruchteile eines Cents pro Suche.`;
function renderProvFields() {
  const p = IS_CLAUDE ? 'claude' : (cfg.provider || 'auto');
  const eff = effProvider();
  $('#provNote').textContent = p === 'auto' ? autoNote(eff) : (PROV[p] ? PROV[p].note : '');
  let html = '';
  if (p === 'claude') html += `<label class="field-label" for="tierSel">Gründlichkeit</label><select id="tierSel" data-cfg="tier"><option value="quick"${cfg.tier === 'quick' ? ' selected' : ''}>Schnell</option><option value="default"${cfg.tier === 'default' ? ' selected' : ''}>Standard</option><option value="complex"${cfg.tier === 'complex' ? ' selected' : ''}>Gründlich (dauert länger)</option></select><p class="note">${esc(PROV.claude.note)}</p>`;
  if (p === 'auto') html += ['gemini', 'groq', 'openrouter', 'deepseek'].map(fieldKey).join('');
  if (['gemini', 'groq', 'openrouter', 'deepseek', 'custom'].includes(p)) html += fieldKey(p);
  if (['ollama', 'custom'].includes(p)) html += fieldBase(p);
  if (['gemini', 'groq', 'openrouter', 'deepseek', 'ollama', 'custom', 'puter'].includes(p)) html += fieldModel(p);
  $('#provFields').innerHTML = html;
  $('#btnTest').hidden = p === 'none' || IS_CLAUDE;
}
function setCfgPath(path, value) {
  const [a, b] = path.split('.');
  if (b) cfg[a][b] = value; else cfg[a] = value;
  saveCfg();
  renderAIStatus();
  if (path.startsWith('keys.') && cfg.provider === 'auto') $('#provNote').textContent = autoNote(effProvider());
}
async function listModels(p) {
  const out = $('#testOut');
  out.textContent = 'Modelle werden geladen …';
  try {
    let ids = [];
    if (p === 'gemini') ids = rankGemini(await geminiModels((cfg.keys.gemini || '').trim()));
    else if (p === 'openrouter') ids = await openrouterFreeModels();
    else if (p === 'puter') {
      if (!(window.puter && window.puter.ai)) await loadScript('https://js.puter.com/v2/');
      const list = window.puter.ai.listModels ? await window.puter.ai.listModels() : [];
      ids = (list || []).map(m => typeof m === 'string' ? m : (m && (m.id || m.name))).filter(Boolean);
    } else {
      const base = String(typeof PROV[p].base === 'string' ? PROV[p].base : (cfg.bases[p] || '')).trim().replace(/\/+$/, '');
      ids = await openaiModels(base, (cfg.keys[p] || '').trim());
      if (p === 'groq') ids = rankGroq(ids);
      if (p === 'deepseek') ids = rankDeepSeek(ids);
    }
    const dl = document.getElementById(`dl_${p}`);
    if (dl) dl.innerHTML = ids.slice(0, 200).map(id => `<option value="${esc(id)}"></option>`).join('');
    out.textContent = ids.length ? `${nf(ids.length)} Modelle gefunden – ins Feld klicken zum Auswählen.` : 'Keine Modelle gefunden.';
  } catch (e) {
    out.textContent = `Fehler: ${(e && e.message) || e}`;
  }
}
async function testConnection() {
  const out = $('#testOut');
  const prov = effProvider();
  if (prov === 'none') { out.textContent = 'Keine KI ausgewählt.'; return; }
  out.textContent = 'Teste …';
  try {
    const res = await runAI(prov, 'Antworte nur mit diesem JSON: {"ok": true}', () => {}, true);
    const ok = parseAIJSON(res.text);
    out.textContent = ok ? `Verbindung steht · ${res.provider}${res.model ? ' · ' + res.model : ''}` : `Antwort erhalten, aber kein JSON: ${clip(res.text, 80)}`;
  } catch (e) {
    out.textContent = `Fehler: ${(e && e.message) || e}`;
  }
}
let downloadsNS = null;
async function downloadStandalone() {
  const out = $('#dlOut');
  if (!downloadsNS) { out.textContent = 'Download ist in dieser Ansicht nicht verfügbar.'; return; }
  out.textContent = 'Wird vorbereitet …';
  try {
    const r = await fetch('namensspur-standalone.html');
    if (!r.ok) throw new Error('Datei nicht gefunden');
    const text = await r.text();
    await downloadsNS.save({ filename: 'namensspur.html', data: text });
    out.textContent = 'Gespeichert. Datei im Browser öffnen oder online stellen.';
  } catch (e) {
    out.textContent = e && e.code === 'declined' ? 'Download abgebrochen.' : `Download nicht möglich (${(e && (e.code || e.message)) || 'Fehler'}).`;
  }
}

/* Zusammenfassung kopieren */
function summaryText() {
  const d = R && R.ai && R.ai.data;
  if (!d) return '';
  const L = [`${R.name} – Namensspur`, ''];
  if (d.kurz) L.push(d.kurz, '');
  if (d.bedeutung) L.push(`Bedeutung: ${d.bedeutung}`);
  if (d.namenstyp) L.push(`Namenstyp: ${d.namenstyp}`);
  if (d.sprachraum) L.push(`Sprachraum: ${d.sprachraum}`);
  if (d.aeltesteWurzel) L.push(`Älteste Wurzel: ${d.aeltesteWurzel}`);
  if (d.zeitschichten.length) {
    L.push('', 'Zeitschichten:');
    for (const z of d.zeitschichten) L.push(`- ${z.zeit || fmtYear(z.jahr)}: ${z.form}${z.sprache ? ` (${z.sprache})` : ''} – ${z.text} [${z.sicherheit}${z.quelle ? ', ' + z.quelle : ''}]`);
  }
  if (d.varianten.length) L.push('', `Varianten: ${d.varianten.join(', ')}`);
  const recs = collectRecords(R, true).filter(r => r.year != null).slice(0, 10);
  if (recs.length) { L.push('', 'Früheste Belege:'); for (const r of recs) L.push(`- ${r.yearLabel || fmtYear(r.year)}: ${r.name}${r.info ? ` (${r.info})` : ''} [${r.source}]`); }
  if (R.tree && R.tree.data) {
    const st = treeStats(R.tree.data, R.tree.data.rootId);
    L.push('', `Väterliche Linie (${R.tree.data.source}): ${st.line.map(p => `${p.name}${p.by != null || p.dy != null ? ` (${lifespan(p.by, p.dy)})` : ''}`).join(' ← ')}`);
  }
  if (d.forschungstipps.length) { L.push('', 'Forschungstipps:'); for (const t of d.forschungstipps) L.push(`- ${t}`); }
  if (d.hinweis) L.push('', `Hinweis: ${d.hinweis}`);
  L.push('', `Erstellt mit Namensspur · KI: ${R.ai.provider}${R.ai.model ? ' (' + R.ai.model + ')' : ''}`);
  return L.join('\n');
}
async function copySummary() {
  const text = summaryText();
  const out = document.getElementById('copyOut');
  try {
    await navigator.clipboard.writeText(text);
    if (out) out.textContent = 'Kopiert.';
  } catch {
    let ta = document.querySelector('.copy-fallback');
    if (!ta) { ta = document.createElement('textarea'); ta.className = 'copy-fallback'; ta.setAttribute('aria-label', 'Zusammenfassung'); $('#resActions').appendChild(ta); }
    ta.value = text;
    ta.focus(); ta.select();
    if (out) out.textContent = 'Text markiert – jetzt kopieren.';
  }
}

/* ================================================================
   Start
   ================================================================ */
function openSettings(open) {
  const s = $('#settings');
  const show = open === undefined ? s.hidden : open;
  s.hidden = !show;
  $('#btnSettings').setAttribute('aria-expanded', String(show));
  if (show) { renderSettings(); s.scrollIntoView({ block: 'nearest' }); }
}
function onClick(e) {
  const el = e.target.closest && e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'search') {
    const mode = el.dataset.mode || currentMode();
    setMode(mode);
    $('#nameInput').value = el.dataset.name || '';
    startSearch(el.dataset.name, mode);
  } else if (act === 'openSettings') openSettings(true);
  else if (act === 'reai') reanalyze();
  else if (act === 'copy') copySummary();
  else if (act === 'recMore') { R.ui = R.ui || {}; R.ui.allRecords = true; renderRecords(); }
  else if (act === 'loadTree') loadTree({ source: el.dataset.src, id: el.dataset.id, key: el.dataset.key, label: el.dataset.label });
  else if (act === 'treeRoot') rerootTree(el.dataset.id);
  else if (act === 'toggleKey') { const i = document.getElementById(el.dataset.for); if (i) { i.type = i.type === 'password' ? 'text' : 'password'; el.textContent = i.type === 'password' ? 'zeigen' : 'verbergen'; } }
  else if (act === 'listModels') listModels(el.dataset.p);
}
function init() {
  document.documentElement.lang = 'de';
  document.addEventListener('click', onClick);
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); startSearch($('#nameInput').value, currentMode()); });
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', () => setMode(currentMode())));
  $('#btnStop').addEventListener('click', stopSearch);
  $('#btnSettings').addEventListener('click', () => openSettings());
  $('#btnCloseSettings').addEventListener('click', () => openSettings(false));
  $('#btnTest').addEventListener('click', testConnection);
  $('#btnDownload').addEventListener('click', downloadStandalone);
  $('#provSel').addEventListener('change', e => { cfg.provider = e.target.value; saveCfg(); renderProvFields(); renderAIStatus(); });
  $('#settings').addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.cfg) setCfgPath(t.dataset.cfg, t.value.trim()); });
  $('#settings').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.src) { cfg.sources[t.dataset.src] = t.checked; saveCfg(); renderAIStatus(); }
    else if (t.dataset && t.dataset.cfg && t.tagName === 'SELECT') setCfgPath(t.dataset.cfg, t.value);
  });
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawCenturyChart, 150); });
  if (IS_CLAUDE) {
    const note = $('#envNote');
    note.hidden = false;
    note.textContent = 'In Claude läuft die KI über dein Claude-Konto. Externe Datenbanken sind hier gesperrt – die eigenständige Version (unter „KI & Quellen“) fragt sie live ab.';
    getSample();
    window.claude.use('downloads').then(d => { downloadsNS = d; $('#btnDownload').hidden = !d; }).catch(() => { downloadsNS = null; });
  }
  setMode('nachname');
  renderAIStatus();
  R = JSON.parse(JSON.stringify(EXAMPLE));
  renderResult();
}

if (!HAS_WINDOW || typeof document === 'undefined') {
  globalThis.__NS_TEST__ = { parseAIJSON, normAI, guessYear, firstYear, eraOf, wdYear, wdYearLabel, wiktDeExtract, wiktEnExtract, cleanWiki, wpSections, wpPick, parseEarliest, parseCenturies, buildWdTree, treeStats, kekule, collectRecords, splitName, capName, rankGemini, rankGroq, rankDeepSeek, buildPrompt, linkGroups, centLabel, fold, slug, EXAMPLE };
  return;
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
