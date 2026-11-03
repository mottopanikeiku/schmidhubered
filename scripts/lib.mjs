// Shared loading, validation and text helpers for the build, check, card and sync scripts.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const REPO = process.env.SITE_REPO || 'mottopanikeiku/schmidhubered';
export const SITE_URL = withSlash(process.env.SITE_URL || 'https://mottopanikeiku.github.io/schmidhubered/');
export const VOTES_API = `https://api.github.com/repos/${REPO}/issues?labels=case&state=all&per_page=100`;

function withSlash(u) {
  return u.endsWith('/') ? u : u + '/';
}

export function readJSON(file, fallback) {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------- schema

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isUrl = (v) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);

function checkWorks(list, where, errs) {
  if (!Array.isArray(list)) return errs.push(`${where} must be an array`);
  list.forEach((w, i) => {
    const at = `${where}[${i}]`;
    if (!w || typeof w !== 'object') return errs.push(`${at} must be an object`);
    if (!isStr(w.who)) errs.push(`${at}.who must be a non-empty string`);
    if (!(Number.isInteger(w.year) || (typeof w.year === 'string' && /\d{4}/.test(w.year))))
      errs.push(`${at}.year must be a year`);
    if (!isStr(w.title)) errs.push(`${at}.title must be a non-empty string`);
    if (w.url !== undefined && w.url !== '' && !isUrl(w.url)) errs.push(`${at}.url must be an http(s) URL`);
  });
}

function checkQuotes(list, where, keys, errs) {
  if (!Array.isArray(list)) return errs.push(`${where} must be an array`);
  list.forEach((q, i) => {
    const at = `${where}[${i}]`;
    if (!q || typeof q !== 'object') return errs.push(`${at} must be an object`);
    for (const k of keys) if (!isStr(q[k])) errs.push(`${at}.${k} must be a non-empty string`);
    if (!isUrl(q.url)) errs.push(`${at}.url must be an http(s) URL`);
  });
}

const TOP_KEYS = ['id', 'title', 'matchup', 'question', 'usual_credit', 'claim', 'response',
  'agreed_facts', 'crux', 'related', 'instance_urls'];

// Returns a list of problems; an empty list means the case matches the schema.
export function validateCase(c, fileId) {
  const errs = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['file must hold one JSON object'];
  for (const k of TOP_KEYS) if (!(k in c)) errs.push(`missing "${k}"`);
  for (const k of Object.keys(c)) if (!TOP_KEYS.includes(k) && k !== 'card') errs.push(`unknown key "${k}"`);
  if ('card' in c) checkCard(c.card, errs);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id || '')) errs.push('id must be lowercase words joined by hyphens');
  if (fileId && c.id !== fileId) errs.push(`id "${c.id}" does not match file name "${fileId}"`);
  for (const k of ['title', 'matchup', 'question', 'crux']) if (!isStr(c[k])) errs.push(`${k} must be a non-empty string`);

  const uc = c.usual_credit;
  if (!uc || typeof uc !== 'object') errs.push('usual_credit must be an object');
  else {
    if (!isStr(uc.summary)) errs.push('usual_credit.summary must be a non-empty string');
    checkWorks(uc.works, 'usual_credit.works', errs);
    if (Array.isArray(uc.works) && uc.works.length === 0) errs.push('usual_credit.works must not be empty');
  }

  const cl = c.claim;
  if (!cl || typeof cl !== 'object') errs.push('claim must be an object');
  else {
    if (!isStr(cl.summary)) errs.push('claim.summary must be a non-empty string');
    checkWorks(cl.prior_works, 'claim.prior_works', errs);
    checkQuotes(cl.quotes, 'claim.quotes', ['text', 'date', 'venue'], errs);
    if (!Number.isInteger(cl.times_made) || cl.times_made < 0) errs.push('claim.times_made must be a whole number');
    for (const k of ['first_made', 'last_made']) if (!isStr(cl[k])) errs.push(`claim.${k} must be a date string`);
  }

  const rs = c.response;
  if (!rs || typeof rs !== 'object') errs.push('response must be an object');
  else {
    if (!isStr(rs.summary)) errs.push('response.summary must be a non-empty string');
    checkQuotes(rs.quotes, 'response.quotes', ['who', 'text', 'date'], errs);
  }

  for (const k of ['agreed_facts', 'related', 'instance_urls']) {
    if (!Array.isArray(c[k])) errs.push(`${k} must be an array`);
    else c[k].forEach((v, i) => { if (!isStr(v)) errs.push(`${k}[${i}] must be a non-empty string`); });
  }
  if (Array.isArray(c.instance_urls)) c.instance_urls.forEach((u, i) => { if (!isUrl(u)) errs.push(`instance_urls[${i}] must be an http(s) URL`); });
  return errs;
}

export const CATEGORIES = ['Architectures', 'Learning methods', 'Awards', 'Companies and products', 'Origins of the field', 'Computing history'];
const SIDES = ['challenger', 'credited', 'neutral'];
const isYear = (v) => Number.isInteger(v) || (typeof v === 'string' && /\d{4}/.test(v));

// The short-form matchup used on cards and case heroes.
function checkCard(k, errs) {
  if (!k || typeof k !== 'object' || Array.isArray(k)) return errs.push('card must be an object');
  if (!CATEGORIES.includes(k.category)) errs.push(`card.category must be one of: ${CATEGORIES.join(', ')}`);
  for (const f of ['headline', 'question', 'claim', 'pushback', 'crux']) if (!isStr(k[f])) errs.push(`card.${f} must be a non-empty string`);
  for (const s of ['credited', 'challenger']) {
    const x = k[s];
    if (!x || typeof x !== 'object') { errs.push(`card.${s} must be an object`); continue; }
    if (!isStr(x.who)) errs.push(`card.${s}.who must be a non-empty string`);
    if (!isYear(x.year)) errs.push(`card.${s}.year must be a year`);
    if (!isStr(x.what)) errs.push(`card.${s}.what must be a non-empty string`);
  }
  const q = k.his_quote;
  if (!q || !isStr(q.text) || !isStr(q.date) || !isUrl(q.url)) errs.push('card.his_quote needs text, date and an http(s) url');
  const t = k.their_quote;
  if (t !== null && (!t || !isStr(t.who) || !isStr(t.text) || !isStr(t.date) || !isUrl(t.url))) errs.push('card.their_quote must be null or have who, text, date and an http(s) url');
  if (!Array.isArray(k.timeline)) errs.push('card.timeline must be an array');
  else k.timeline.forEach((e, i) => {
    if (!e || !isYear(e.year) || !isStr(e.label) || !SIDES.includes(e.side)) errs.push(`card.timeline[${i}] needs a year, a label and a side (${SIDES.join(', ')})`);
  });
}

// First sentence of a case text, Markdown kept. Initials, "et al." and similar abbreviations do not
// end a sentence.
export function firstSentence(s) {
  const text = String(s ?? '').trim();
  const re = /[.!?](?=["”’)]?\s+["“‘(]?[A-Z0-9])/g;
  for (let m; (m = re.exec(text));) {
    const before = text.slice(0, m.index).split(/\s+/).pop();
    if (/^(?:(?:[A-Z]\.)*[A-Z]|al|e\.g|i\.e|vs|cf|Dr|Mr|Mrs|Ms|Prof|St|No|Fig|Eq|Sec|approx|ca|c|U\.S)$/.test(before)) continue;
    return text.slice(0, m.index + 1);
  }
  return text;
}

export const yearOf = (v) => Number(String(v ?? '').match(/\d{4}/)?.[0]) || null;
const shortWho = (who) => (who.length > 34 ? `${who.split(/,|\band\b/)[0].trim()} et al.` : who);

// The case's card, or one derived from the long texts while a file has no card yet.
export function cardOf(c) {
  if (c.card) return c.card;
  const w = c.usual_credit.works[0];
  const p = c.claim.prior_works[0] || { who: 'Jürgen Schmidhuber', year: yearOf(c.claim.first_made), title: firstSentence(c.claim.summary) };
  const timeline = [
    ...c.claim.prior_works.map((x) => ({ year: x.year, label: x.title, side: 'challenger' })),
    ...c.usual_credit.works.map((x) => ({ year: x.year, label: x.title, side: 'credited' })),
  ].sort((a, b) => (yearOf(a.year) || 0) - (yearOf(b.year) || 0));
  return {
    category: null,
    headline: c.title,
    credited: { who: shortWho(w.who), year: w.year, what: w.title },
    challenger: { who: shortWho(p.who), year: p.year, what: p.title },
    question: c.question,
    claim: firstSentence(c.claim.summary),
    pushback: firstSentence(c.response.summary),
    crux: firstSentence(c.crux),
    his_quote: c.claim.quotes[0] || null,
    their_quote: c.response.quotes[0] || null,
    timeline,
  };
}

// Reads every cases/*.json. Files that fail to parse or validate are reported and left out, so a
// half-written file never takes the whole site down; a case whose only problem is its card is kept
// with the card derived from the long texts instead.
export function loadCases() {
  const dir = path.join(ROOT, 'cases');
  const cases = [];
  const problems = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const id = f.slice(0, -5);
    let c;
    try {
      c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      problems.push({ file: `cases/${f}`, errors: [`invalid JSON: ${e.message}`] });
      continue;
    }
    const errors = validateCase(c, id);
    if (errors.length) problems.push({ file: `cases/${f}`, errors });
    if (errors.every((e) => e.startsWith('card'))) {
      if (errors.length) delete c.card;
      cases.push(c);
    }
  }
  return { cases, problems };
}

// ---------------------------------------------------------------- seed instances

const STOP = new Set(('the a an and or of in on to for by with from at as is are was were be been his her their its this that ' +
  'these those it he she they we our my your not no vs than then but which who what when where how did does do has have had ' +
  'about into over after before more most first also only such other others earlier later work works paper papers').split(' '));

function words(s) {
  return new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

export function loadSeed() {
  const seedCases = readJSON('seed/cases_seed.json', []);
  const unassigned = readJSON('seed/unassigned.json', []);
  const seedById = new Map(seedCases.map((c) => [c.id, c]));
  const byUrl = new Map();
  const add = (inst, seedId) => {
    const list = byUrl.get(inst.url) || [];
    list.push({ ...inst, seedId });
    byUrl.set(inst.url, list);
  };
  for (const c of seedCases) for (const i of c.instances) add(i, c.id);
  for (const i of unassigned) add(i, null);
  return { seedById, byUrl };
}

// One URL can carry several catalogued statements (a long web page quoted for different cases), and a
// case lists such a URL once per statement it uses. Take that many distinct statements, preferring the
// ones catalogued under the same case and then those whose wording overlaps most with the case text.
function pickInstances(candidates, c, caseWords, k) {
  const distinct = new Map();
  for (const i of candidates) if (!distinct.has(i.quote)) distinct.set(i.quote, i);
  const scored = [...distinct.values()].map((i, order) => {
    const w = words(`${i.quote} ${i.topic} ${i.claimed_prior} ${(i.targets || []).join(' ')}`);
    let score = i.seedId === c.id ? 1000 : 0;
    for (const x of w) if (caseWords.has(x)) score++;
    return { i, score, order };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, k).map((s) => s.i);
}

export function caseInstances(c, seed) {
  const counts = new Map();
  for (const u of c.instance_urls) counts.set(u, (counts.get(u) || 0) + 1);
  let list;
  if (counts.size) {
    const caseWords = words(`${c.title} ${c.matchup} ${c.claim.summary} ${c.claim.prior_works.map((w) => `${w.who} ${w.title}`).join(' ')}`);
    list = [...counts].flatMap(([u, k]) => {
      const cands = seed.byUrl.get(u);
      if (!cands) return [{ url: u, date: '', venue: '', quote: '', missing: true }];
      return pickInstances(cands, c, caseWords, k);
    });
  } else {
    list = seed.seedById.get(c.id)?.instances || [];
  }
  return list.slice().sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
}

// ---------------------------------------------------------------- text

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function host(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    let s = x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '');
    if (s.length > 48) s = s.slice(0, 46) + '…';
    return s;
  } catch {
    return u;
  }
}

// Bare URLs end at whitespace; trailing sentence punctuation and unbalanced closing brackets are not part of them.
function trimUrl(u) {
  let tail = '';
  for (;;) {
    const last = u.slice(-1);
    if (/[.,;:!?'"]/.test(last)) { tail = last + tail; u = u.slice(0, -1); continue; }
    if (last === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) { tail = last + tail; u = u.slice(0, -1); continue; }
    break;
  }
  return [u, tail];
}

const ext = (u) => `<a href="${esc(u)}" rel="noopener">`;

function italics(escaped) {
  return escaped
    .replace(/(^|[\s(“"‘])\*(?!\s)([^*\n]+?)\*(?=$|[\s).,;:!?”"’])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(“"‘])_(?!\s)([^_\n]+?)_(?=$|[\s).,;:!?”"’])/g, '$1<em>$2</em>');
}

// Inline Markdown for case texts: [links](https://…), *italics* and _italics_, bare URLs.
// Everything else is escaped, so case files cannot inject markup.
export function inline(src) {
  const s = String(src ?? '');
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)|(https?:\/\/[^\s<>"]+)/g;
  let out = '';
  let last = 0;
  for (let m; (m = re.exec(s));) {
    out += italics(esc(s.slice(last, m.index)));
    if (m[1] !== undefined) {
      out += `${ext(m[2])}${italics(esc(m[1]))}</a>`;
    } else {
      const [u, tail] = trimUrl(m[3]);
      out += `${ext(u)}${esc(shortUrl(u))}</a>${esc(tail)}`;
    }
    last = m.index + m[0].length;
  }
  return out + italics(esc(s.slice(last)));
}

// A fact usually ends with its source as a bare URL ("…in March 1940: https://…").
// Those trailing URLs become small "source" links after the sentence.
export function fact(src) {
  let s = String(src ?? '').trim();
  const urls = [];
  for (;;) {
    const m = s.match(/(https?:\/\/[^\s<>"]+)\s*$/);
    if (!m || m.index === 0) break;
    urls.unshift(trimUrl(m[1])[0]);
    s = s.slice(0, m.index).replace(/(?:[\s:;,(]|\band\b|\bsee\b)+$/i, '');
  }
  if (!/[.!?”"’)]$/.test(s) && urls.length) s += '.';
  const links = urls.map((u, i) => ` <a class="src" href="${esc(u)}" rel="noopener" aria-label="source ${i + 1}: ${esc(host(u))}">${urls.length > 1 ? `source ${i + 1}` : 'source'}</a>`);
  return inline(s) + links.join('');
}

// ---------------------------------------------------------------- dates

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parts(d) {
  const m = String(d ?? '').trim().match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
  if (!m) return null;
  return { y: m[1], mo: m[2] ? Number(m[2]) : null, d: m[3] ? Number(m[3]) : null };
}

// "2025-10-04" → "4 October 2025", "2025-10" → "October 2025", "2003" → "2003"; anything else is shown as written.
export function fmtDate(d, { short = false } = {}) {
  const p = parts(d);
  if (!p) return String(d ?? '').trim() || 'undated';
  const mon = (i) => (short ? MONTHS[i - 1].slice(0, 3) : MONTHS[i - 1]);
  if (p.mo && p.mo >= 1 && p.mo <= 12) {
    if (p.d) return `${p.d} ${mon(p.mo)} ${p.y}`;
    return `${mon(p.mo)} ${p.y}`;
  }
  return p.y;
}

export function year(d) {
  const p = parts(d);
  return p ? Number(p.y) : null;
}

// Sortable key; partial dates sort at the start of their period, undated items last.
export function dateKey(d) {
  const p = parts(d);
  if (!p) return '9999';
  return `${p.y}-${String(p.mo || 0).padStart(2, '0')}-${String(p.d || 0).padStart(2, '0')}`;
}

export function tweetId(u) {
  const m = String(u || '').match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/);
  return m ? m[1] : null;
}

export function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

// Verbatim text (catalogued quotes, posts): escaped, bare URLs linked, line breaks kept, no Markdown.
export function plain(src) {
  const s = String(src ?? '');
  const re = /https?:\/\/[^\s<>"]+/g;
  let out = '';
  let last = 0;
  for (let m; (m = re.exec(s));) {
    out += esc(s.slice(last, m.index));
    const [u, tail] = trimUrl(m[0]);
    out += `${ext(u)}${esc(shortUrl(u))}</a>${esc(tail)}`;
    last = m.index + m[0].length;
  }
  return (out + esc(s.slice(last))).replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------- new posts

// The case patterns used to seed the catalogue; each is matched case-insensitively against a post's text.
export function loadRules() {
  return readJSON('seed/case_rules.json', []).flatMap((r) => {
    try {
      return [{ id: r.id, re: new RegExp(r.pattern, 'i') }];
    } catch (e) {
      console.warn(`case_rules: skipping ${r.id}: ${e.message}`);
      return [];
    }
  });
}

export function matchCases(text, rules) {
  return rules.filter((r) => r.re.test(text)).map((r) => r.id);
}

// A post is flagged as a likely priority claim when it names a year from 1960 to 2016 (or a decade
// such as "1990s") and also uses one of the words people use to assign credit. The heuristic is
// meant to keep obvious non-claims off the Latest page; every flagged post still needs a human read.
const CLAIM_YEAR = /\b(19[6-9]\d|200\d|201[0-6])s?\b/;
const CLAIM_WORDS = /\b(invent\w*|first|published|introduc\w*|cit(e|ed|es|ing|ation)|plagiar\w*|old hat|nothing new|based on|essentially|exactly what|ours|my lab|our lab|republish\w*|credit\w*)\b/i;

export function likelyClaim(text) {
  return CLAIM_YEAR.test(text) && CLAIM_WORDS.test(text);
}
