// Builds the static site in dist/ from cases/*.json, the seed catalogue, data/latest.json and live vote counts.
// Every link is relative, so the same output works under /schmidhubered/ and at a domain root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT, REPO, SITE_URL, VOTES_API, readJSON, loadCases, loadSeed, caseInstances, esc, inline, fact, plain,
  fmtDate, year, dateKey, tweetId, plural, host, loadRules, matchCases, likelyClaim, cardOf, yearOf, CATEGORIES,
} from './lib.mjs';
import { CHOICES, fromReactions, total, tallyInner, miniInner, voteLine } from '../src/tally.js';
import { cardHash } from './card-template.mjs';

const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'dist');
const SITE = 'Schmidhubered';
const TAGLINE = 'Jürgen Schmidhuber’s priority claims, case by case, with a vote on each';
const CATALOGUE = '1,126';
const REPO_URL = `https://github.com/${REPO}`;
const NOW = new Date();

// ---------------------------------------------------------------- inputs

const { cases, problems } = loadCases();
for (const p of problems) console.warn(`${p.file}: ${p.errors.join('; ')}`);
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

function slug(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------- assets

function hashed(...files) {
  const h = crypto.createHash('sha1');
  for (const f of files) h.update(fs.readFileSync(path.join(ROOT, f)));
  return h.digest('hex').slice(0, 8);
}

function writeAssets() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src/fonts/archivo.woff2'), path.join(OUT, 'fonts/archivo.woff2'));
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
<meta name="theme-color" content="#f5f4f0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121316" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${r}favicon.png" type="image/png" sizes="32x32">
<link rel="icon" href="${r}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${r}apple-touch-icon.png">
<link rel="preload" href="${r}fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${r}style.css?v=${VERSION}">
<script>document.documentElement.className = 'js';</script>
<script src="${r}site.js?v=${VERSION}" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<div class="wrap top-row">
<a class="brand" href="${r}">${SITE}</a>
<nav aria-label="Site">${navLink('about/', 'About', 'about')}${navLink('latest/', 'Latest', 'latest')}</nav>
</div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="foot">
<div class="wrap">
<p>Case texts <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener license">CC BY 4.0</a>, quotes remain their authors’, code MIT at <a href="${REPO_URL}" rel="noopener">${esc(REPO)}</a>. Built ${fmtDate(NOW.toISOString().slice(0, 10))}, ${NOW.toISOString().slice(11, 16)} UTC.</p>
</div>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------- pieces

// Vote result on a case page; the live script refreshes anything carrying data-issue.
function tally(c) {
  const v = voteState(c);
  return `<p class="tally"${v.num ? ` data-issue="${v.num}"` : ''}>${tallyInner(v.counts, v.state)}</p>`;
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
    return `<li><span class="who">${inline(w.who)}</span> <span class="yr">${esc(w.year)}</span> ${title}</li>`;
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
<figcaption>${attribution}${timeTag(q.date, { short: true })}${q.venue ? `, ${esc(venue(q.venue, q.url))}` : ''} · <a href="${esc(q.url)}" rel="noopener">source</a></figcaption></figure>`;
}

// A short quote for the case panels, cut at a word boundary when it runs long.
function panelQuote(q, who) {
  if (!q) return '';
  let t = String(q.text).replace(/\s+/g, ' ').trim();
  if (t.length > 240) t = `${t.slice(0, t.lastIndexOf(' ', 236))}…`;
  return `<figure class="pq"><blockquote><p>${plain(t)}</p></blockquote>
<figcaption>${esc(String(who).replace(/,\s*\d{4}$/, ''))}, ${timeTag(q.date, { short: true })} · <a href="${esc(q.url)}" rel="noopener">source</a></figcaption></figure>`;
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
  const caseLinks = p.cases.map((id) => (byId.has(id) ? `<a href="${r}cases/${id}/">${esc(cardOf(byId.get(id)).headline)}</a>` : esc(id)));
  const match = caseLinks.length ? `seems to match ${caseLinks.join(', ')}` : 'matches no case by keyword';
  const matches = showCases ? `<p class="post-cases">${p.likely_claim ? 'Worded like a priority claim' : 'Not worded like a priority claim'}, and ${match}.</p>` : '';
  return `<li class="inst auto"><p class="inst-meta">${timeTag(when, { short: true })} · <a href="${esc(p.url)}" rel="noopener">X</a> <span class="tag">found automatically, not yet reviewed</span>${postContext(p)}</p>
${verbatim(p.text)}${matches}</li>`;
}

function reviewedItem(p) {
  return `<li class="inst"><p class="inst-meta">${timeTag(p.date.slice(0, 10), { short: true })} · <a href="${esc(p.url)}" rel="noopener">X</a>${postContext(p)}</p>
${verbatim(p.text)}</li>`;
}

// A labelled section for the text pages: the label sits in the margin on wide screens.
function block(id, title, inner) {
  return `<section class="block" id="${id}" aria-labelledby="${id}-h">
<h2 id="${id}-h">${title}</h2>
<div class="block-body">
${inner}
</div>
</section>`;
}

// ---------------------------------------------------------------- the year scale

// One scale for the home chart and the case pictures. The few years before 1900 share a narrow band
// at the left, then comes a visible break, and 1900 to the present runs linearly across the rest.
const allYears = cases.flatMap((c) => [yearOf(cardOf(c).challenger.year), yearOf(cardOf(c).credited.year)]).filter(Boolean);
const END = NOW.getUTCFullYear();
const BREAK = 1900;
const START = Math.floor(Math.min(BREAK, ...allYears) / 100) * 100;
const BAND = START < BREAK ? 6 : 0;
const SKIP = START < BREAK ? 4 : 0;

function xOf(y) {
  if (y < BREAK) return ((y - START) / (BREAK - START)) * BAND;
  return BAND + SKIP + ((Math.min(y, END) - BREAK) / (END - BREAK)) * (100 - BAND - SKIP);
}
const at = (y) => `${xOf(y).toFixed(2)}%`;

function ticks() {
  const out = START < BREAK ? [{ y: START, major: true }] : [];
  for (let y = BREAK; y <= END; y += 10) out.push({ y, major: y % 50 === 0 });
  return out;
}

// Year labels along a line; `majorOnly` keeps just 1600, 1900, 1950 and 2000 for the case pictures.
function axis(majorOnly = false) {
  const marks = ticks().filter((t) => !majorOnly || t.major)
    .map((t) => `<span class="tick${t.major ? ' major' : ''}${t.y === START ? ' first' : ''}" style="left:${at(t.y)}">${t.y}</span>`).join('');
  const brk = BAND ? `<span class="break" style="left:${(BAND + SKIP / 2).toFixed(2)}%"></span>` : '';
  return `<span class="axis" aria-hidden="true">${marks}${brk}</span>`;
}

// ---------------------------------------------------------------- case pages

const listed = (c) => new Set(caseInstances(c, seed).map((i) => tweetId(i.url)).filter(Boolean));

// Two dots, or one split dot (half red, half blue) when both fall in the same year.
function dots(a, b) {
  if (a === b) return `<span class="dot split" style="left:${at(a)}"></span>`;
  return `<span class="dot his" style="left:${at(a)}"></span><span class="dot cred" style="left:${at(b)}"></span>`;
}

// The matchup as one picture: his year and the credited year at either end, and the two dots on a
// hairline drawn to the same scale as the home chart, so the gap shows where it sits in history.
// The gap sits above the line and the axis years below it, so the two never meet.
function picture(k) {
  const a = yearOf(k.challenger.year);
  const b = yearOf(k.credited.year);
  const gap = a && b ? Math.abs(b - a) : null;
  const gapText = gap === null ? '' : gap === 0 ? 'same year' : `${gap} ${gap === 1 ? 'year' : 'years'}`;
  const mid = a && b ? (xOf(a) + xOf(b)) / 2 : 0;
  const edge = mid < 6 ? ' start' : mid > 94 ? ' end' : '';
  const end = (s, cls) => `<div class="end ${cls}"><span class="big">${esc(s.year)}</span><span class="who">${esc(s.who)}</span><span class="what">${esc(s.what)}</span></div>`;
  const line = a && b ? `<span class="line">
${axis(true)}
<span class="join" style="left:${at(Math.min(a, b))};width:${Math.abs(xOf(b) - xOf(a)).toFixed(2)}%"></span>
${dots(a, b)}
<span class="gapl${edge}" style="left:${mid.toFixed(2)}%">${gapText}</span>
</span>` : '';
  return `<figure class="picture">
<figcaption class="sr">Claimed first in ${esc(k.challenger.year)} by ${esc(k.challenger.who)}; usually credited to ${esc(k.credited.who)}, ${esc(k.credited.year)}; ${gap === 0 ? 'in the same year' : `${gapText} apart`}.</figcaption>
<div class="ends">${end(k.challenger, 'his')}${end(k.credited, 'cred')}</div>
${line}
</figure>`;
}

// A quote under a one-sentence summary, cut at a word boundary when it runs long.
function sideQuote(q, who) {
  if (!q) return '';
  let t = String(q.text).replace(/\s+/g, ' ').trim();
  if (t.length > 220) t = `${t.slice(0, t.lastIndexOf(' ', 216))}…`;
  return `<blockquote class="sq"><p>“${plain(t)}”</p></blockquote>
<p class="cite">${esc(String(who).replace(/,\s*\d{4}$/, ''))}, ${timeTag(q.date, { short: true })}, <a href="${esc(q.url)}" rel="noopener">source</a></p>`;
}

// Events as dots on a hairline, each label in the first of four lanes (two above, two below) where it
// does not overlap a label already placed. Labels are about 15% of the line wide.
function timeline(k) {
  const ev = (k.timeline || []).map((e) => ({ ...e, y: yearOf(e.year) })).filter((e) => e.y).sort((a, b) => a.y - b.y);
  if (ev.length < 2) return '';
  const min = ev[0].y;
  const max = ev[ev.length - 1].y;
  const W = 15;
  const lanes = [[], [], [], []];
  const placed = ev.map((e, i) => {
    const x = max === min ? (i / (ev.length - 1)) * 100 : ((e.y - min) / (max - min)) * 100;
    const align = x < 12 ? 'start' : x > 88 ? 'end' : '';
    const box = align === 'start' ? [x, x + W] : align === 'end' ? [x - W, x] : [x - W / 2, x + W / 2];
    let lane = lanes.findIndex((l) => l.every(([p, q]) => box[1] + 1 < p || box[0] > q + 1));
    if (lane < 0) lane = i % 4;
    lanes[lane].push(box);
    const side = { challenger: 'his', credited: 'cred', neutral: 'other' }[e.side] || 'other';
    return { lane, html: `<li class="ev ${side} lane${lane}${align ? ` ${align}` : ''}" style="--x:${x.toFixed(2)}%"><span class="ev-box"><span class="ev-year">${esc(e.year)}</span><span class="ev-label">${inline(e.label)}</span></span></li>` };
  });
  const tall = placed.some((p) => p.lane > 1);
  return `<section class="timeline" aria-labelledby="tl-h">
<h2 id="tl-h">Timeline</h2>
<ol class="tl${tall ? '' : ' tl-short'}">${placed.map((p) => p.html).join('')}</ol>
<p class="muted small">Red marks his side, blue the usually credited side and grey everything else.</p>
</section>`;
}

function casePage(c) {
  const r = '../../';
  const k = cardOf(c);
  const inst = caseInstances(c, seed);
  const known = listed(c);
  const fresh = posts.filter((p) => p.likely_claim && p.cases.includes(c.id) && !known.has(p.id));
  const v = voteState(c);
  const issueUrl = v.num ? `${REPO_URL}/issues/${v.num}` : null;
  const pills = CHOICES.map(([key, name]) => (issueUrl
    ? `<a class="pill ${key}" href="${issueUrl}" target="_blank" rel="noopener"><span class="d" aria-hidden="true"></span>${name}</a>`
    : `<span class="pill ${key}" aria-disabled="true"><span class="d" aria-hidden="true"></span>${name}</span>`)).join('');
  const note = issueUrl
    ? 'Each GitHub account gets one vote: the buttons open this case’s issue, where you react with 👍, 😕 or 👎.'
    : 'Each GitHub account gets one vote, on this case’s issue, once it exists.';
  const related = c.related.filter((id) => byId.has(id) && id !== c.id).map((id) => byId.get(id));
  const when = span(c);
  const count = inst.length + fresh.length;

  const body = `<article class="case wrap">
<p class="crumbs"><a href="${r}">← All cases</a>${k.category ? `<span class="muted"> · ${esc(k.category)}</span>` : ''}</p>
<h1 class="case-title">${esc(k.headline)}</h1>
${picture(k)}

<section class="vote" id="vote" aria-labelledby="q">
<h2 class="question" id="q">${inline(k.question)}</h2>
<div class="pills">${pills}</div>
${tally(c)}
<p class="note">${note}</p>
</section>

<div class="sides">
<section aria-labelledby="s1"><h2 id="s1">His claim</h2><p>${inline(k.claim)}</p>${sideQuote(k.his_quote, 'Schmidhuber')}</section>
<section aria-labelledby="s2"><h2 id="s2">The pushback</h2><p>${inline(k.pushback)}</p>${k.their_quote ? sideQuote(k.their_quote, k.their_quote.who) : ''}</section>
</div>
<p class="at-issue"><span class="muted">At issue:</span> ${inline(k.crux.replace(/^The question is whether /, 'whether '))}</p>

${timeline(k)}

<details class="full" id="full">
<summary>Read the full case</summary>
<div class="full-body">
<div class="two">
<section><h3>Schmidhuber’s claim</h3><p>${inline(c.claim.summary)}</p>${c.claim.prior_works.length ? `<h4>What he says came first</h4>${works(c.claim.prior_works)}` : ''}</section>
<section><h3>Usually credited</h3><p>${inline(c.usual_credit.summary)}</p>${works(c.usual_credit.works)}</section>
</div>
${c.claim.quotes.length ? `<section><h3>In his words</h3>${c.claim.quotes.map((q) => quoteFigure(q, '')).join('\n')}</section>` : ''}
<section><h3>What the other side says</h3><p>${inline(c.response.summary)}</p>${c.response.quotes.map((q) => quoteFigure(q, `${inline(q.who)}, `)).join('')}</section>
${c.agreed_facts.length ? `<section><h3>Facts nobody disputes</h3><ol class="facts">${c.agreed_facts.map((f) => `<li>${fact(f)}</li>`).join('')}</ol></section>` : ''}
<section><h3>What’s actually in dispute</h3><p>${inline(c.crux)}</p></section>
<section id="every"><h3>Every time he has made this claim</h3>
<p class="count-line">${statements(c)}${when ? `, ${when}` : ''}${fresh.length ? `, plus ${fresh.length} found automatically and not yet reviewed` : ''}</p>
<ol class="instances">${fresh.map((p) => postItem(p, r, { showCases: false })).join('')}${inst.slice().reverse().map(instanceItem).join('')}</ol>
</section>
</div>
</details>
<script>if (location.hash === '#every' || location.hash === '#full') document.getElementById('full').open = true;</script>

${related.length ? `<p class="related"><span class="muted">Related:</span> ${related.map((x) => `<a href="${r}cases/${x.id}/">${esc(cardOf(x).headline)}</a>`).join(', ')}</p>` : ''}
</article>`;

  return layout({
    at: `cases/${c.id}/`, title: k.headline, description: clip(k.question), body, nav: 'cases', type: 'article',
    image: cardFor(c), imageAlt: `${k.headline}: ${k.challenger.who} (${k.challenger.year}) and ${k.credited.who} (${k.credited.year})`,
  });
}

// ---------------------------------------------------------------- home

// The newest claim on record: case statements, reviewed recent statements and flagged tracker posts.
function newestClaim() {
  return [
    ...cases.flatMap((c) => caseInstances(c, seed)).filter((i) => dateKey(i.date) !== '9999')
      .map((i) => ({ key: dateKey(i.date), date: i.date, url: i.url })),
    ...recent.map((p) => ({ key: p.date, date: p.date.slice(0, 10), url: p.url })),
    ...posts.filter((p) => p.likely_claim).map((p) => ({ key: p.created_at, date: p.created_at.slice(0, 10), url: p.url })),
  ].sort((a, b) => b.key.localeCompare(a.key))[0];
}

// One chart row: the headline, then a hairline from his year (red) to the credited year (blue), then a
// tiny vote bar once there are votes. The tooltip holds the short question and the vote split.
function chartRow(c) {
  const k = cardOf(c);
  const a = yearOf(k.challenger.year);
  const b = yearOf(k.credited.year);
  const v = voteState(c);
  const issue = v.num ? ` data-issue="${v.num}"` : '';
  const lo = Math.min(a, b);
  const flip = xOf(a) > 55 ? ' flip' : '';
  return `<li class="row" data-cat="${k.category ? slug(k.category) : ''}" data-gap="${b - a}" data-his="${a}" data-cred="${b}" data-votes="${total(v.counts)}" data-title="${esc(k.headline)}" style="--a:${xOf(a).toFixed(2)};--b:${xOf(b).toFixed(2)}">
<a class="row-link" href="cases/${c.id}/">
<span class="row-label">${esc(k.headline)}</span>
<span class="plot"><span class="join" style="left:${at(lo)};width:${Math.abs(xOf(b) - xOf(a)).toFixed(2)}%"></span>${dots(a, b)}</span>
<span class="mini"${issue}>${miniInner(v.counts)}</span>
<span class="sr">, claimed ${esc(k.challenger.year)}, usually credited ${esc(k.credited.year)}</span>
<span class="tip${flip}"><span class="tip-q">${esc(k.question)}</span><span class="tip-v"${issue}>${voteLine(v.counts, v.state)}</span></span>
</a>
</li>`;
}

function homePage() {
  // In order of his year, as the sort control starts: a cascade from the oldest claims down.
  const his = (c) => yearOf(cardOf(c).challenger.year);
  const cred = (c) => yearOf(cardOf(c).credited.year);
  const ranked = cases.slice().sort((x, y) => his(x) - his(y) || cred(x) - cred(y));
  const cats = CATEGORIES.filter((name) => cases.some((c) => cardOf(c).category === name));
  const newest = newestClaim();
  const decades = ticks().map((t) => `<span class="gl${t.major ? ' major' : ''}" style="left:${at(t.y)}"></span>`).join('');

  const body = `<section class="home wrap">
<p class="intro">Each line runs from the year Jürgen Schmidhuber says an idea first appeared (<span class="his-t">red</span>) to the year it is usually credited (<span class="cred-t">blue</span>). Pick one to see both sides and vote.</p>
<div class="controls">
<label>Sort by <select id="sort">
<option value="his">his year</option>
<option value="cred">credited year</option>
<option value="gap">largest gap</option>
<option value="votes">most votes</option>
</select></label>
<label>Show <select id="cat">
<option value="">all categories</option>
${cats.map((name) => `<option value="${slug(name)}">${esc(name.toLowerCase())}</option>`).join('\n')}
</select></label>
<span class="muted" id="shown" aria-live="polite">${plural(cases.length, 'case')}</span>
</div>
<div class="chart">
<div class="chart-head" aria-hidden="true"><span></span><span class="plot">${axis()}</span><span></span></div>
<div class="chart-body">
<span class="grid" aria-hidden="true">${decades}</span>
<ol class="rows" id="rows">
${ranked.map(chartRow).join('\n')}
</ol>
</div>
</div>
<p class="stats muted">${plural(cases.length, 'case')} · ${CATALOGUE} statements since 1996${newest ? ` · most recent <a href="${esc(newest.url)}" rel="noopener">${esc(fmtDate(newest.date, { short: true }))}</a>` : ''}</p>
</section>`;

  return layout({
    at: '', title: SITE, nav: 'cases', body,
    description: `${TAGLINE}: who is usually credited, what he says came first, the reply and the point in dispute.`,
  });
}

// ---------------------------------------------------------------- latest

function latestPage() {
  const r = '../';
  const shown = posts.filter((p) => p.likely_claim || p.cases.length);
  const others = posts.length - shown.length;
  const since = posts.length ? fmtDate(posts[posts.length - 1].created_at.slice(0, 10)) : null;
  const reviewed = recent.length ? block('reviewed', 'Reviewed, not tied to a case', `<p class="muted">Read and confirmed as priority claims, but no single case covers them.</p>
<ol class="instances">${recent.map(reviewedItem).join('\n')}</ol>`) : '';
  const unreviewed = `${shown.length ? `<p class="muted">Picked up by the daily check of his posts on X and not read by anyone yet, so a match only means the wording resembles a case.</p><ol class="instances">${shown.map((p) => postItem(p, r)).join('\n')}</ol>` : '<p class="muted">The daily check has not picked up any new posts since the catalogue was compiled, so nothing is waiting for review.</p>'}
${posts.length ? `<p class="muted small">${plural(posts.length, 'new post')} since ${esc(since)}${others ? `, of which ${others} matched no case and used no claim wording and ${others === 1 ? 'is' : 'are'} not listed` : ''}. The flagging rule is on the <a href="${r}about/">About</a> page.</p>` : ''}`;
  const body = `<div class="wrap page">
<h1 class="page-title">Latest</h1>
<p class="dek">His newest statements that are not in a case file yet.</p>
${reviewed}
${block('unreviewed', 'Found automatically, not yet reviewed', unreviewed)}
</div>`;
  return layout({ at: 'latest/', title: 'Latest', nav: 'latest', body, description: 'His newest statements on X that are not in a case file yet, found automatically and not yet reviewed.' });
}

// ---------------------------------------------------------------- about

function aboutPage() {
  const r = '../';
  const body = `<div class="wrap page">
<h1 class="page-title">About</h1>
<p class="dek">${SITE} sets out Jürgen Schmidhuber’s priority claims one case at a time, with both sides and a vote.</p>
${block('research', 'Sources', `<p>Every case is built from a catalogue of ${CATALOGUE} public statements he made between 1996 and 2026, and written from the primary sources on both sides.</p>
<ul>
<li>X, his website at IDSIA, papers, the Connectionists mailing list, Reddit, LinkedIn and interviews</li>
<li>Each post, email, comment, interview answer or section of a web page counts as one statement, so a long report can contribute several</li>
<li>Every quote links to where it was published</li>
</ul>`)}
${block('neutrality', 'Neutrality', '<p>The site takes no side: both accounts appear in their own words, agreed facts are kept apart from the argument, and no case ends in a verdict. Where nobody has replied in public, the case says so.</p>')}
${block('voting', 'Voting', `<p>Each case has an <a href="${REPO_URL}/issues?q=label%3Acase" rel="noopener">issue on GitHub</a>, and a vote is a reaction on its first post, so each account counts once and can change its vote.</p>
<ul>
<li>👍 valid, 😕 partly, 👎 not valid</li>
<li>Counts load live from the GitHub API and are rebuilt into the pages every hour</li>
</ul>`)}
${block('chart', 'The chart', '<p>Each case is a line from the year he says the idea first appeared to the year it is usually credited. Years before 1900 are squeezed into a narrow band at the left so that the twentieth century has room.</p>')}
${block('limits', 'What a vote means', '<p>It is a poll of interested readers with GitHub accounts, which makes it neither expert consensus nor a ruling on what happened.</p>')}
${block('new-posts', 'New posts', `<p>A daily job reads his posts on X and lists new ones on <a href="${r}latest/">Latest</a>, flagging a post when it names a year from 1960 to 2016 together with words such as invented, first, published, cite or old hat.</p>`)}
${block('corrections', 'Corrections', `<p>If a quote is wrong or a case misstates either side, <a href="${REPO_URL}/issues/new" rel="noopener">open an issue</a> or a pull request against the case file.</p>`)}
${block('licence', 'Licence', '<p>Case texts are CC BY 4.0 and the code is MIT, while quotes remain their authors’. The type is Archivo by Omnibus-Type, under the SIL Open Font License.</p>')}
</div>`;
  return layout({ at: 'about/', title: 'About', nav: 'about', body, description: 'How the cases were researched from 1,126 public statements, the neutrality policy, how voting on GitHub works and how to suggest a correction.' });
}

function notFound() {
  const base = new URL(SITE_URL).pathname;
  const body = `<div class="wrap page"><h1 class="page-title">Not found</h1>
<p class="dek">There is no page here, perhaps because a case was renamed, so try the <a href="./">list of cases</a>.</p></div>`;
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
const withCard = cases.filter((c) => c.card).length;
console.log(`built ${plural(cases.length, 'case')} into ${path.relative(ROOT, OUT)}/ (${withCard} with cards, ${plural(posts.length, 'tracked post')}, ${cards} share images, votes ${votes.ok ? 'fetched' : 'unavailable'})`);
if (problems.length) console.log(`${plural(problems.length, 'case file')} with problems; run npm run check for details`);
