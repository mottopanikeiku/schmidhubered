// Builds the static site in dist/ from cases/*.json, the seed catalogue, data/latest.json and live vote counts.
// Every link is relative, so the same output works under /schmidhubered/ and at a domain root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT, REPO, SITE_URL, VOTES_API, readJSON, loadCases, loadSeed, caseInstances, esc, inline, fact, plain,
  fmtDate, year, dateKey, tweetId, plural, host, loadRules, matchCases, likelyClaim,
} from './lib.mjs';
import { CHOICES, fromReactions, total, contest, tallyInner } from '../src/tally.js';
import { cardHash } from './card-template.mjs';

const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'dist');
const SITE = 'Schmidhubered';
const TAGLINE = 'Jürgen Schmidhuber’s priority claims, case by case, with a vote on each';
const CATALOGUE = '1,126';
const REPO_URL = `https://github.com/${REPO}`;
const NOW = new Date();

// ---------------------------------------------------------------- inputs

const { cases, problems } = loadCases();
for (const p of problems) console.warn(`skipping ${p.file}: ${p.errors.join('; ')}`);
const byId = new Map(cases.map((c) => [c.id, c]));
const issues = readJSON('data/issues.json', {});
const seed = loadSeed();
const rules = loadRules();
// Statements read and confirmed as claims that no single case covers (newest first), and the tracker's
// unreviewed posts, minus any that have since been reviewed into that list.
const recent = readJSON('data/recent.json', []).slice().sort((a, b) => b.date.localeCompare(a.date));
const reviewedIds = new Set(recent.map((p) => p.id));
const posts = readJSON('data/latest.json', [])
  .filter((p) => !reviewedIds.has(p.id))
  .map((p) => ({ ...p, cases: matchCases(p.text, rules), likely_claim: likelyClaim(p.text) }))
  .sort((a, b) => b.created_at.localeCompare(a.created_at));

async function fetchVotes() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'schmidhubered-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(VOTES_API, { headers, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return { ok: true, byIssue: new Map() };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    return { ok: true, byIssue: new Map(list.map((i) => [i.number, fromReactions(i.reactions)])) };
  } catch (e) {
    console.warn(`votes: could not fetch counts (${e.message}); pages will ask GitHub from the browser`);
    return { ok: false, byIssue: new Map() };
  }
}
const votes = await fetchVotes();

function voteState(c) {
  const num = issues[c.id];
  if (!num) return { num: null, state: 'closed', counts: null };
  if (!votes.ok) return { num, state: 'unknown', counts: null };
  return { num, state: 'open', counts: votes.byIssue.get(num) || { v: 0, p: 0, n: 0 } };
}

// ---------------------------------------------------------------- credited names for the filter

const ORG = /\b(company|corporation|laborator(y|ies)|labs?|team|group|university|school|institute|committee|museum|foundation|society|academy|council|association|bureau|deepmind|google|openai|meta|microsoft|ibm|nvidia|acm|ieee)\b|-ai\b/i;

function slug(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const isInitial = (t) => /^(?:[A-Z]\.)+-?(?:[A-Z]\.)*$/.test(t) || /^[A-Z]$/.test(t);

// Splits a "who" string into people and organisations. People are keyed by surname, so "Y. Bengio",
// "Yoshua Bengio" and "Geoffrey E. Hinton" versus "Geoffrey Hinton" fall together across cases.
function credited(who) {
  const out = [];
  const s = who.replace(/\([^)]*\)/g, '').replace(/,?\s*\bet al\.?/gi, '').replace(/\s+/g, ' ').trim();
  let parts = s.split(/\s*,\s*|\s+and\s+|\s*&\s*/).map((p) => p.replace(/^the\s+/i, '').trim()).filter(Boolean);
  // "Wilbur and Orville Wright": a lone given name before a full name takes that surname.
  if (parts.length === 2 && !/\s/.test(parts[0]) && /^\S+ \S+$/.test(parts[1]) && !ORG.test(who)) {
    parts = [`${parts[0]} ${parts[1].split(' ')[1]}`, parts[1]];
  }
  parts.forEach((p, i) => {
    if (ORG.test(p)) return out.push({ key: slug(p), org: p });
    const t = p.split(' ');
    const surname = t[t.length - 1];
    out.push({ key: slug(surname), surname, full: p, given: t.slice(0, -1).find((x) => !isInitial(x)) || null, first: i === 0 });
  });
  for (const m of who.matchAll(/\(([^)]+)\)/g)) out.push({ key: slug(m[1]), org: m[1].trim() });
  return out;
}

// The filter lists organisations, first authors and anyone credited in two or more cases; a case
// matches a name wherever it appears among its credited works.
const creditIndex = new Map();
for (const c of cases) {
  for (const w of c.usual_credit.works) {
    for (const x of credited(w.who)) {
      const e = creditIndex.get(x.key) || { key: x.key, org: x.org, surname: x.surname, full: x.full, givens: new Set(), cases: new Set(), lead: false };
      if (x.given) e.givens.add(x.given);
      e.cases.add(c.id);
      e.lead ||= Boolean(x.org || x.first);
      creditIndex.set(x.key, e);
    }
  }
}
const creditList = [...creditIndex.values()].filter((e) => e.lead || e.cases.size > 1).map((e) => ({
  key: e.key,
  cases: e.cases.size,
  // One given name: "Geoffrey Hinton". Initials only: as written, "K. He". Several people: the surname.
  label: e.org || (e.givens.size === 1 ? `${[...e.givens][0]} ${e.surname}` : e.givens.size ? e.surname : e.full),
  sortKey: slug(e.org || e.surname),
})).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
const creditKeys = (c) => [...new Set(c.usual_credit.works.flatMap((w) => credited(w.who).map((x) => x.key)))];

// ---------------------------------------------------------------- assets

function hashed(...files) {
  const h = crypto.createHash('sha1');
  for (const f of files) h.update(fs.readFileSync(path.join(ROOT, f)));
  return h.digest('hex').slice(0, 8);
}

function writeAssets() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  for (const f of ['serif-roman.woff2', 'serif-italic.woff2']) fs.copyFileSync(path.join(ROOT, 'src/fonts', f), path.join(OUT, 'fonts', f));
  fs.copyFileSync(path.join(ROOT, 'src/style.css'), path.join(OUT, 'style.css'));
  for (const f of ['card.png', 'favicon.svg', 'favicon.png', 'apple-touch-icon.png']) {
    if (fs.existsSync(path.join(ROOT, 'src', f))) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(OUT, f));
  }
  // The browser script is the shared tally module followed by the page script, in one file.
  const tally = fs.readFileSync(path.join(ROOT, 'src/tally.js'), 'utf8').replace(/^export /gm, '');
  const site = fs.readFileSync(path.join(ROOT, 'src/site.js'), 'utf8').replace(/^import .*$/gm, '')
    .replace("'__VOTES_API__'", JSON.stringify(VOTES_API));
  fs.writeFileSync(path.join(OUT, 'site.js'), `(() => {\n'use strict';\n${tally}\n${site}\n})();\n`);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
}

const VERSION = hashed('src/style.css', 'src/site.js', 'src/tally.js');

function cardFor(c) {
  const f = `${c.id}-${cardHash(c)}.png`;
  const src = path.join(ROOT, '.cards', f);
  if (!fs.existsSync(src)) return 'card.png';
  fs.mkdirSync(path.join(OUT, 'cards'), { recursive: true });
  fs.copyFileSync(src, path.join(OUT, 'cards', `${c.id}.png`));
  return `cards/${c.id}.png`;
}

// ---------------------------------------------------------------- layout

function write(rel, html) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}

function clip(s, n = 160) {
  const t = String(s).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n - 1)) + '…';
}

function layout({ at, title, description, image = 'card.png', imageAlt, body, nav, base = null, type = 'website' }) {
  const depth = at.split('/').filter(Boolean).length;
  const r = depth ? '../'.repeat(depth) : './';
  const navLink = (href, label, key) => `<a href="${r}${href}"${nav === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const full = title === SITE ? `${SITE}: ${TAGLINE}` : `${title} · ${SITE}`;
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base ? `<base href="${esc(base)}">\n` : ''}<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(SITE_URL + at)}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${esc(title === SITE ? `${SITE}: ${TAGLINE}` : title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(SITE_URL + at)}">
<meta property="og:image" content="${esc(SITE_URL + image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imageAlt || TAGLINE)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f2e8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171511" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${r}favicon.png" type="image/png" sizes="32x32">
<link rel="icon" href="${r}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${r}apple-touch-icon.png">
<link rel="preload" href="${r}fonts/serif-roman.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${r}fonts/serif-italic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${r}style.css?v=${VERSION}">
<script>document.documentElement.className = 'js';</script>
<script src="${r}site.js?v=${VERSION}" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="masthead">
<div class="wrap masthead-row">
<a class="brand" href="${r}">${SITE}</a>
<nav aria-label="Site">${navLink('', 'Cases', 'cases')}${navLink('latest/', 'Latest', 'latest')}${navLink('about/', 'About', 'about')}</nav>
</div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="colophon">
<div class="wrap">
<p>Case texts are <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener license">CC BY 4.0</a> and quotes remain their authors’. The code is MIT and lives at <a href="${REPO_URL}" rel="noopener">${esc(REPO)}</a>, where corrections are welcome as issues.</p>
<p>Built ${fmtDate(NOW.toISOString().slice(0, 10))} at ${NOW.toISOString().slice(11, 16)} UTC.</p>
</div>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------- pieces

function tally(c, cls = '') {
  const v = voteState(c);
  const attrs = v.num ? ` data-issue="${v.num}"` : '';
  return `<div class="tally${cls}"${attrs}>${tallyInner(v.counts, v.state)}</div>`;
}

function timeTag(d, opts) {
  const k = dateKey(d);
  const iso = /^\d{4}/.test(k) && k !== '9999' ? k.replace(/-00/g, '') : null;
  return iso ? `<time datetime="${iso}">${esc(fmtDate(d, opts))}</time>` : `<span>${esc(fmtDate(d, opts))}</span>`;
}

// "89 recorded statements, 2020 to 2026". One long web page can hold several statements, so this
// counts statements and not occasions.
function statements(c) {
  const n = c.claim.times_made;
  return `${n.toLocaleString('en-US')} recorded ${n === 1 ? 'statement' : 'statements'}`;
}

function span(c) {
  const a = year(c.claim.first_made);
  const b = year(c.claim.last_made);
  if (!a) return '';
  return !b || a === b ? `in ${a}` : `${a} to ${b}`;
}

function works(list) {
  return `<ul class="works">${list.map((w) => {
    const title = w.url ? `<a href="${esc(w.url)}" rel="noopener">${inline(w.title)}</a>` : `<cite>${inline(w.title)}</cite>`;
    return `<li><span class="who">${inline(w.who)}</span> <span class="yr">(${esc(w.year)})</span>. ${title}</li>`;
  }).join('')}</ul>`;
}

const VENUES = { X: 'X', website: 'his website', paper: 'paper', LinkedIn: 'LinkedIn', Reddit: 'Reddit', interview: 'interview', letter: 'letter', talk: 'talk' };
const venue = (v, url) => VENUES[v] || host(url);
const venueLink = (v, url) => `<a href="${esc(url)}" rel="noopener">${esc(v ? venue(v, url) : host(url))}</a>`;

// Verbatim text in a blockquote. Long statements show their opening paragraphs and keep the rest
// behind a toggle, so one 4,000-character post does not bury the list.
function verbatim(text) {
  const paras = String(text).split(/\n\s*\n/);
  const shown = [];
  let len = 0;
  while (paras.length && (!shown.length || len + paras[0].length < 420)) {
    len += paras[0].length;
    shown.push(paras.shift());
  }
  const body = (ps) => ps.map((p) => `<p>${plain(p)}</p>`).join('');
  const more = paras.length ? `<details class="more"><summary>Show the rest</summary>${body(paras)}</details>` : '';
  return `<blockquote>${body(shown)}${more}</blockquote>`;
}

function quoteFigure(q, attribution) {
  return `<figure class="quote">${verbatim(q.text)}
<figcaption>${attribution}${timeTag(q.date)}${q.venue ? `, ${esc(venue(q.venue, q.url))}` : ''}. <a href="${esc(q.url)}" rel="noopener">Source</a></figcaption></figure>`;
}

function instanceItem(i) {
  const quote = i.quote ? verbatim(i.quote) : '<p class="noquote">No verbatim text was recorded for this statement.</p>';
  const flags = i.deleted ? ' <span class="tag">since deleted</span>' : '';
  return `<li class="inst"><p class="inst-meta">${timeTag(i.date, { short: true })} · ${venueLink(i.venue, i.url)}${flags}</p>${quote}</li>`;
}

function postContext(p) {
  const parts = [p.reply_to ? `replying to <a href="${esc(p.reply_to)}" rel="noopener">a post</a>` : '', p.quoting ? `quoting <a href="${esc(p.quoting)}" rel="noopener">a post</a>` : ''].filter(Boolean);
  return parts.length ? ` <span class="ctx">${parts.join(', ')}</span>` : '';
}

function postItem(p, r, { showCases = true } = {}) {
  const when = p.created_at.slice(0, 10);
  const caseLinks = p.cases.map((id) => (byId.has(id) ? `<a href="${r}cases/${id}/">${esc(byId.get(id).title)}</a>` : esc(id)));
  const match = caseLinks.length ? `seems to match ${caseLinks.join(', ')}` : 'matches no case by keyword';
  const matches = showCases ? `<p class="post-cases">${p.likely_claim ? 'Worded like a priority claim' : 'Not worded like a priority claim'}, and ${match}.</p>` : '';
  return `<li class="inst auto"><p class="inst-meta">${timeTag(when, { short: true })} · <a href="${esc(p.url)}" rel="noopener">X</a> <span class="tag">found automatically, not yet reviewed</span>${postContext(p)}</p>
${verbatim(p.text)}${matches}</li>`;
}

function reviewedItem(p) {
  return `<li class="inst"><p class="inst-meta">${timeTag(p.date.slice(0, 10), { short: true })} · <a href="${esc(p.url)}" rel="noopener">X</a>${postContext(p)}</p>
${verbatim(p.text)}</li>`;
}

// ---------------------------------------------------------------- case pages

const listed = (c) => new Set(caseInstances(c, seed).map((i) => tweetId(i.url)).filter(Boolean));

// A case section: the label sits in the left margin on wide screens and above the text on phones.
function block(id, title, inner, cls = '') {
  return `<section class="block${cls ? ` ${cls}` : ''}" id="${id}" aria-labelledby="${id}-h">
<h2 id="${id}-h">${title}</h2>
<div class="block-body">
${inner}
</div>
</section>`;
}

function casePage(c) {
  const r = '../../';
  const inst = caseInstances(c, seed);
  const known = listed(c);
  const fresh = posts.filter((p) => p.likely_claim && p.cases.includes(c.id) && !known.has(p.id));
  const v = voteState(c);
  const issueUrl = v.num ? `${REPO_URL}/issues/${v.num}` : null;
  const buttons = CHOICES.map(([k, name], idx) => {
    const emoji = ['👍', '😕', '👎'][idx];
    return issueUrl
      ? `<a class="vote-btn ${k}" href="${issueUrl}" target="_blank" rel="noopener"><span aria-hidden="true">${emoji}</span> ${name}</a>`
      : `<span class="vote-btn ${k}" aria-disabled="true"><span aria-hidden="true">${emoji}</span> ${name}</span>`;
  }).join('');
  const voteNote = issueUrl
    ? 'Voting happens on GitHub so that each account counts once: each button opens this case’s issue in a new tab, where you react to the first post with 👍 for valid, 😕 for partly or 👎 for not valid.'
    : 'Voting happens on GitHub so that each account counts once, and it opens here as soon as this case has its issue.';
  const related = c.related.filter((id) => byId.has(id) && id !== c.id).map((id) => byId.get(id));
  const respQuotes = c.response.quotes.map((q) => quoteFigure(q, `${inline(q.who)}, `)).join('');

  const body = `<article class="case wrap">
<header class="case-head">
<p class="kicker"><a href="${r}">Cases</a></p>
<h1>${inline(c.title)}</h1>
<p class="matchup">${inline(c.matchup)}</p>
<p class="question"><span class="label">The question</span>${inline(c.question)}</p>
</header>

<div class="sides">
<section class="side" aria-labelledby="credited">
<h2 id="credited">Usually credited</h2>
<p>${inline(c.usual_credit.summary)}</p>
${works(c.usual_credit.works)}
</section>
<section class="side" aria-labelledby="claim">
<h2 id="claim">Schmidhuber’s claim</h2>
<p>${inline(c.claim.summary)}</p>
${c.claim.prior_works.length ? `<h3>What he says came first</h3>${works(c.claim.prior_works)}` : ''}
<p class="count-line"><a href="#every">${statements(c)}${span(c) ? `, ${span(c)}` : ''}</a></p>
</section>
</div>

${c.claim.quotes.length ? block('words', 'In his words', c.claim.quotes.map((q) => quoteFigure(q, '')).join('\n')) : ''}

${block('response', 'What the other side says', `<p>${inline(c.response.summary)}</p>\n${respQuotes}`)}

${c.agreed_facts.length ? block('facts', 'Facts nobody disputes', `<ol class="facts">${c.agreed_facts.map((f) => `<li>${fact(f)}</li>`).join('')}</ol>`) : ''}

${block('dispute', 'What’s actually in dispute', `<p>${inline(c.crux)}</p>`, 'crux')}

${block('vote', 'Your vote', `<p class="vote-q">${inline(c.question)}</p>
<div class="vote-btns">${buttons}</div>
<p class="vote-note">${voteNote}</p>
${tally(c, ' tally-wide')}`, 'vote')}

${block('every', 'Every time he has made this claim', `<details id="every-list">
<summary>${inst.length + fresh.length === 1 ? 'Show the one statement' : `Show all ${plural(inst.length + fresh.length, 'statement')}`}${fresh.length ? ` (${fresh.length} not yet reviewed)` : ''}</summary>
<ol class="instances">${fresh.map((p) => postItem(p, r, { showCases: false })).join('')}${inst.slice().reverse().map(instanceItem).join('')}</ol>
</details>
<script>if (location.hash === '#every') document.getElementById('every-list').open = true;</script>`)}

${related.length ? block('related', 'Related cases', `<ul class="related">${related.map((x) => `<li><a href="${r}cases/${x.id}/">${inline(x.title)}</a><span>${inline(x.matchup)}</span></li>`).join('')}</ul>`) : ''}
</article>`;

  return layout({
    at: `cases/${c.id}/`, title: c.title, description: clip(c.question), body, nav: 'cases', type: 'article',
    image: cardFor(c), imageAlt: `${c.title}: ${c.matchup}`,
  });
}

// ---------------------------------------------------------------- home

function minYear(c) {
  const ys = c.usual_credit.works.map((w) => Number(String(w.year).match(/\d{4}/)?.[0])).filter(Boolean);
  return ys.length ? Math.min(...ys) : 9999;
}

const WHAT = { X: 'a post on X', website: 'a passage on his website', paper: 'a passage in a paper', LinkedIn: 'a post on LinkedIn', Reddit: 'a comment on Reddit', interview: 'an interview', letter: 'a letter', talk: 'a talk' };

// The opening words of a statement for the home page: no leading @handles or links, cut at a word
// boundary and before any parenthesis the cut would leave open.
function opening(text, max = 110) {
  let s = String(text || '').replace(/^(?:@\w+\s+)+/, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  s = s.slice(0, s.lastIndexOf(' ', max));
  const open = s.lastIndexOf('(');
  if (open > 0 && s.indexOf(')', open) < 0) s = s.slice(0, open);
  return s.replace(/[\s,;:(–-]+$/, '') + '…';
}

// The newest claim on record: case statements, reviewed recent statements and flagged tracker posts.
function latestLine() {
  const all = [
    ...cases.flatMap((c) => caseInstances(c, seed)).filter((i) => dateKey(i.date) !== '9999')
      .map((i) => ({ key: dateKey(i.date), date: i.date, url: i.url, text: i.quote, venue: i.venue })),
    ...recent.map((p) => ({ key: p.date, date: p.date.slice(0, 10), url: p.url, text: p.text, venue: 'X' })),
    ...posts.filter((p) => p.likely_claim).map((p) => ({ key: p.created_at, date: p.created_at.slice(0, 10), url: p.url, text: p.text, venue: 'X', unreviewed: true })),
  ].sort((a, b) => b.key.localeCompare(a.key));
  const best = all[0];
  if (!best) return '';
  const words = opening(best.text);
  return `<p class="latest-line">The most recent recorded claim is <a href="${esc(best.url)}" rel="noopener">${WHAT[best.venue] || 'a statement'} from ${esc(fmtDate(best.date))}</a>${best.unreviewed ? ', not yet reviewed' : ''}${words ? `: “${esc(words)}”` : '.'}</p>`;
}

function homePage() {
  const r = './';
  const rows = cases.map((c) => {
    const v = voteState(c);
    return { c, v, votes: total(v.counts), contest: v.counts ? contest(v.counts) : -1 };
  }).sort((a, b) => b.votes - a.votes || b.c.claim.times_made - a.c.claim.times_made || a.c.title.localeCompare(b.c.title));

  const row = ({ c, votes: n, contest: k }) => `<li class="row" id="case-${c.id}" data-votes="${n}" data-contest="${k.toFixed(5)}" data-statements="${c.claim.times_made}" data-year="${minYear(c)}" data-title="${esc(c.title)}" data-credited="${esc(creditKeys(c).join(' '))}">
<div class="row-main">
<h2 class="row-title"><a href="${r}cases/${c.id}/">${inline(c.title)}</a></h2>
<p class="row-matchup">${inline(c.matchup)}</p>
<p class="row-question">${inline(c.question)}</p>
</div>
<div class="row-side">
<p class="row-count">${statements(c)}${span(c) ? ` <span class="yrs">${span(c)}</span>` : ''}</p>
${tally(c)}
</div>
</li>`;

  const body = `<div class="wrap">
<header class="home-head">
<h1 class="title">${SITE}</h1>
<p class="dek">${TAGLINE}</p>
<div class="intro">
<p>For thirty years Jürgen Schmidhuber has argued in public that results credited to others, in machine learning and well beyond it, were published earlier, often by his own lab and sometimes by researchers he believes were overlooked. Each case below sets out who is usually credited, what he says came first in his own words, how the other side has answered and the exact point in dispute. You vote by reacting to the case’s issue on GitHub, so each account counts once and the arguments stay in public.</p>
${latestLine()}
</div>
</header>

<div class="controls" role="group" aria-label="Sort and filter the cases">
<label for="sort">Sort by</label>
<select id="sort">
<option value="votes">Most votes</option>
<option value="contested">Most contested</option>
<option value="statements">Most statements</option>
<option value="year">Date of the credited work</option>
</select>
<label for="credited">Credited to</label>
<select id="credited">
<option value="">Anyone</option>
${creditList.map((e) => `<option value="${esc(e.key)}">${esc(e.label)}${e.cases > 1 ? ` (${e.cases})` : ''}</option>`).join('\n')}
</select>
<p class="shown" id="shown" aria-live="polite">${plural(cases.length, 'case')}</p>
</div>

<ol class="rows" id="rows">
${rows.map(row).join('\n')}
</ol>
</div>`;

  return layout({
    at: '', title: SITE, nav: 'cases', body,
    description: `${TAGLINE}. Each case sets out who is usually credited, what he says came first, the reply and the point in dispute.`,
  });
}

// ---------------------------------------------------------------- latest

function latestPage() {
  const r = '../';
  const shown = posts.filter((p) => p.likely_claim || p.cases.length);
  const others = posts.length - shown.length;
  const since = posts.length ? fmtDate(posts[posts.length - 1].created_at.slice(0, 10)) : null;
  const reviewed = recent.length
    ? `<p>These posts were read and confirmed as priority claims, but each answers something that no single case covers, so they are kept here instead of in a case file.</p>
<ol class="instances">${recent.map(reviewedItem).join('\n')}</ol>`
    : '<p>No statement outside the case files has been reviewed yet.</p>';
  const unreviewed = `${shown.length ? `<ol class="instances">${shown.map((p) => postItem(p, r)).join('\n')}</ol>` : '<p>The daily check has not picked up any new posts since the catalogue was compiled, so nothing is waiting for review.</p>'}
${posts.length ? `<p class="note">The daily check has picked up ${plural(posts.length, 'new post')} since ${esc(since)}${others ? `, and ${others === 1 ? 'one of them is' : `${others} of them are`} not listed because ${others === 1 ? 'it matched' : 'they matched'} no case and used no claim wording` : ''}. A post is flagged when it names a year between 1960 and 2016 together with a word such as invented, first, published, cite or old hat, and it is matched to cases by keyword, as the <a href="${r}about/">About</a> page describes in more detail.</p>` : ''}`;
  const body = `<div class="wrap prose-page">
<header class="page-head">
<h1>Latest</h1>
<p class="lede">This page collects his newest statements that are not part of a case file. The first list holds posts that have been read and confirmed as priority claims but fit no single case, while the second holds posts that a daily script picked up from X and nobody has reviewed yet, so a match there only means that the wording resembles a case.</p>
</header>
${block('reviewed', 'Reviewed, not tied to a case', reviewed)}
${block('unreviewed', 'Found automatically, not yet reviewed', unreviewed)}
</div>`;
  return layout({ at: 'latest/', title: 'Latest', nav: 'latest', body, description: 'His newest statements on X: reviewed claims that fit no single case, and posts found automatically that are not yet reviewed.' });
}

// ---------------------------------------------------------------- about

function aboutPage() {
  const r = '../';
  const body = `<div class="wrap prose-page">
<header class="page-head">
<h1>About</h1>
<p class="lede">${SITE} collects the priority claims Jürgen Schmidhuber has made in public, groups them by the result in question and lays out each one so that a reader can weigh it without first reading thirty years of posts.</p>
</header>
${block('research', 'How the cases were researched', `<p>The cases start from a catalogue of ${CATALOGUE} public statements by Schmidhuber, gathered from his posts on X, his website at IDSIA, his papers, mailing lists such as Connectionists, Reddit, LinkedIn and published interviews, and dated from 1996 to 2026. Each post, email, comment, interview answer or section of a web page counts as one statement, so a long report that he has revised over the years can contribute several. Statements that dispute the same credit were grouped into one case, which was then written from primary sources: the credited papers, the earlier work he points to, and what the credited researchers, prize committees and historians have said in reply. Every quote links to the place it was published, and the full list of statements behind a case is at the bottom of its page.</p>`)}

${block('neutrality', 'Neutrality', `<p>The site takes no side: each case gives both accounts in their own words, keeps the facts that both accept apart from the argument, and ends with the narrow point that actually separates them, without a verdict and without adjectives that carry one. Where nobody has answered a claim in public, the case says so instead of writing an answer on anyone’s behalf, and the name is the one place where the site allows itself a light touch.</p>`)}

${block('voting', 'How voting works', `<p>Each case has an issue in the site’s <a href="${REPO_URL}/issues?q=label%3Acase" rel="noopener">GitHub repository</a>, and a vote is a reaction on that issue’s first post: 👍 for valid, 😕 for partly valid and 👎 for not valid. Because the votes are GitHub reactions, each account counts once, anyone can see who voted, and you can change your vote by changing your reaction. The comments under each issue are open for arguments and corrections.</p>
<p>Counts are read live from the GitHub API when a page loads and kept for a few minutes, and an hourly rebuild bakes the latest counts into the pages, so they still show without JavaScript or when the API’s limit of 60 requests an hour per visitor is reached. Sorting by “most contested” scores a valid vote as 1, a partly vote as ½ and a not-valid vote as 0 and ranks the cases by how widely their votes spread, so an even split between valid and not valid comes first.</p>`)}

${block('limits', 'What a vote can tell you', `<p>A vote here is the opinion of someone with a GitHub account who found the site, which makes the totals a poll of interested readers and not a measure of expert agreement or of what happened. A person with two accounts can vote twice and a link shared in one community can move a count within hours, so the numbers are best read next to the case and never instead of it.</p>`)}

${block('new-posts', 'New posts', `<p>A scheduled job reads his latest posts on X once a day and lists new ones on the <a href="${r}latest/">Latest</a> page. It flags a post as a likely claim when the text names a year between 1960 and 2016 (or a decade such as the 1990s) and also uses a word such as invented, first, published, introduced, cite, plagiarism, old hat, nothing new, based on or essentially, and it matches posts to cases with the keyword patterns used to build the catalogue. Flagged posts also appear on the matching case pages, marked as found automatically and not yet reviewed, until someone reads them and adds them to the case file. Posts that have been read and confirmed as claims but fit no single case are listed separately on the same page.</p>`)}

${block('corrections', 'Corrections', `<p>If a quote is wrong, a source is missing or a case misstates either side, please <a href="${REPO_URL}/issues/new" rel="noopener">open an issue</a> with the page and the correction, or comment on the case’s own issue. Pull requests that edit the files in <code>cases/</code> are welcome as well, since each case is a single JSON file.</p>`)}

${block('licence', 'Licence and credits', `<p>Case texts are published under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener license">CC BY 4.0</a> and the code under the MIT licence, while every quote remains the work of its author and is reproduced for commentary. The type is a subset of Source Serif 4, designed by Frank Grießhammer for Adobe and used under the SIL Open Font License.</p>`)}
</div>`;
  return layout({ at: 'about/', title: 'About', nav: 'about', body, description: 'How the cases were researched from 1,126 public statements, the neutrality policy, how voting on GitHub works and how to suggest a correction.' });
}

function notFound() {
  const base = new URL(SITE_URL).pathname;
  const body = `<div class="wrap prose-page"><header class="page-head"><h1>Not found</h1>
<p class="lede">There is no page at this address, perhaps because a case was renamed, so the <a href="./">list of cases</a> is the best place to look for it.</p></header></div>`;
  return layout({ at: '', title: 'Not found', nav: '', body, base, description: 'Page not found.' });
}

function sitemap() {
  const urls = ['', 'latest/', 'about/', ...cases.map((c) => `cases/${c.id}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(SITE_URL + u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

// ---------------------------------------------------------------- write

writeAssets();
write('index.html', homePage());
write('about/index.html', aboutPage());
write('latest/index.html', latestPage());
write('404.html', notFound());
for (const c of cases) write(`cases/${c.id}/index.html`, casePage(c));
write('sitemap.xml', sitemap());
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);

const cards = fs.existsSync(path.join(OUT, 'cards')) ? fs.readdirSync(path.join(OUT, 'cards')).length : 0;
console.log(`built ${plural(cases.length, 'case')} into ${path.relative(ROOT, OUT)}/ (${plural(posts.length, 'tracked post')}, ${cards} case cards, votes ${votes.ok ? 'fetched' : 'unavailable'})`);
if (problems.length) console.log(`${plural(problems.length, 'case file')} skipped; run npm run check for details`);
