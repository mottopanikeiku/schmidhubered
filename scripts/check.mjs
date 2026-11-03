// Validates the case files and data, builds the site into a temporary folder and checks that every
// internal link and asset reference resolves. Exits non-zero on any error; warnings do not fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, readJSON, loadCases, loadSeed, caseInstances } from './lib.mjs';

const errors = [];
const warnings = [];

// ---------------------------------------------------------------- data

const { cases, problems } = loadCases();
for (const p of problems) for (const e of p.errors) errors.push(`${p.file}: ${e}`);
const ids = new Set(cases.map((c) => c.id));
const seed = loadSeed();

for (const c of cases) {
  const f = `cases/${c.id}.json`;
  for (const r of c.related) if (!ids.has(r)) warnings.push(`${f}: related case "${r}" does not exist yet`);
  const missing = c.instance_urls.filter((u) => !seed.byUrl.has(u));
  if (missing.length) warnings.push(`${f}: ${missing.length} instance URL(s) not in the seed catalogue, shown without a date or quote`);
  const listed = caseInstances(c, seed).length;
  if (listed !== c.claim.times_made) warnings.push(`${f}: times_made is ${c.claim.times_made} but ${listed} statements are listed`);
  const k = c.card;
  const prose = JSON.stringify([c.title, c.matchup, c.question, c.usual_credit.summary, c.claim.summary, c.response.summary, c.agreed_facts, c.crux,
    k && [k.headline, k.question, k.claim, k.pushback, k.crux, k.credited, k.challenger, (k.timeline || []).map((e) => e.label)]]);
  if (prose.includes('\u2014')) warnings.push(`${f}: contains an em dash outside quotes`);
  if (!k) warnings.push(`${f}: no card yet, so the pages derive one from the long texts`);
  else for (const field of ['claim', 'pushback', 'crux']) {
    const n = String(k[field]).split(/\s+/).filter(Boolean).length;
    if (n > 25) warnings.push(`${f}: card.${field} has ${n} words, more than 25`);
  }
}

const issues = readJSON('data/issues.json', {});
if (!issues || typeof issues !== 'object' || Array.isArray(issues)) errors.push('data/issues.json: must be an object of case id to issue number');
else {
  for (const [id, n] of Object.entries(issues)) {
    if (!Number.isInteger(n) || n < 1) errors.push(`data/issues.json: "${id}" must map to an issue number`);
    if (!ids.has(id)) warnings.push(`data/issues.json: "${id}" has an issue but no case file`);
  }
  const nums = Object.values(issues);
  if (new Set(nums).size !== nums.length) errors.push('data/issues.json: two cases share an issue number');
}

const latest = readJSON('data/latest.json', []);
if (!Array.isArray(latest)) errors.push('data/latest.json: must be an array of posts');
else {
  latest.forEach((p, i) => {
    for (const k of ['id', 'url', 'created_at', 'text']) if (typeof p?.[k] !== 'string') errors.push(`data/latest.json[${i}]: "${k}" must be a string`);
  });
}

for (const r of readJSON('seed/case_rules.json', [])) {
  try {
    new RegExp(r.pattern, 'i');
  } catch (e) {
    errors.push(`seed/case_rules.json: pattern for "${r.id}" does not compile: ${e.message}`);
  }
}

// ---------------------------------------------------------------- research-process wording

// Working notes must never reach the public pages or repo. NOTES applies everywhere, verbatim quotes
// included; PROSE also applies to everything that is not a verbatim quote, where words like "brief"
// or "this machine" are only suspicious in their process sense.
const NOTES = /DESLOP|\bUNVERIFIED\b|\bWEAK\b|\b[Tt]his agent\b|\b[Ss]ub-?agents?\b|\b[Oo]rchestrator\b/;
const PROSE = new RegExp([
  String.raw`\b[Tt]his machine\b`,
  String.raw`\b(?:by|to|from|asked|ask|told|tell)\s+Main\b`,
  String.raw`\bMain(?:'s|’s|\s+(?:said|says|asked|wants|authori[sz]ed|approved|decided))\b`,
  String.raw`\b(?:the|this|my|your)\s+(?:brief|contract)\b(?=\s*[.,;:)]|\s+(?:says|said|asks|asked|requires|required|states|rules))`,
  String.raw`\bper the (?:brief|contract)\b`,
].join('|'));

function scan(where, text, verbatim) {
  const s = String(text ?? '');
  const m = s.match(NOTES) || (!verbatim && s.match(PROSE));
  if (m) errors.push(`${where}: research-process wording "${m[0]}" in published text`);
}

function scanTree(where, v, verbatim = false) {
  if (typeof v === 'string') scan(where, v, verbatim);
  else if (Array.isArray(v)) v.forEach((x, i) => scanTree(`${where}[${i}]`, x, verbatim));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scanTree(`${where}.${k}`, x, verbatim || k === 'text' || k === 'quote');
}

for (const c of cases) scanTree(`cases/${c.id}.json`, c);
for (const f of ['seed/cases_seed.json', 'seed/unassigned.json']) {
  const data = readJSON(f, []);
  const list = f.includes('unassigned') ? data : data.flatMap((c) => c.instances);
  list.forEach((inst, i) => {
    if ('notes' in inst) errors.push(`${f}: instance ${i} still has a "notes" field (strip working notes before publishing)`);
    const { date, venue, url, quote, targets, topic, claimed_prior } = inst;
    scanTree(`${f}#${i}`, { date, venue, url, targets, topic, claimed_prior });
    scan(`${f}#${i}.quote`, quote, true);
  });
}
if (Array.isArray(latest)) latest.forEach((p, i) => scan(`data/latest.json[${i}].text`, p?.text, true));

const recent = readJSON('data/recent.json', []);
if (!Array.isArray(recent)) errors.push('data/recent.json: must be an array of reviewed posts');
else {
  recent.forEach((p, i) => {
    for (const k of ['id', 'url', 'date', 'text']) if (typeof p?.[k] !== 'string' || !p[k]) errors.push(`data/recent.json[${i}]: "${k}" must be a non-empty string`);
    if (p?.date && Number.isNaN(Date.parse(p.date))) errors.push(`data/recent.json[${i}]: date "${p.date}" is not a date`);
    scan(`data/recent.json[${i}].text`, p?.text, true);
  });
  if (new Set(recent.map((p) => p?.id)).size !== recent.length) errors.push('data/recent.json: an id appears twice');
}
for (const f of ['README.md']) if (fs.existsSync(path.join(ROOT, f))) scan(f, fs.readFileSync(path.join(ROOT, f), 'utf8'), false);

// ---------------------------------------------------------------- links

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'schmidhubered-check-'));
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { env: { ...process.env, OUT_DIR: out }, stdio: ['ignore', 'ignore', 'inherit'] });
  const pages = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) pages.push(p);
    }
  };
  walk(out);
  let checked = 0;
  for (const page of pages) {
    const raw = fs.readFileSync(page, 'utf8');
    const rel = path.relative(out, page);
    // Site copy: everything on the page except verbatim quotes.
    scan(`built ${rel}`, raw.replace(/<blockquote>[\s\S]*?<\/blockquote>/g, ' ').replace(/<[^>]+>/g, ' '), false);
    scan(`built ${rel}`, raw.replace(/<[^>]+>/g, ' '), true);
    // A <base> holds the site's path (for the 404 page), which maps to the root of the build.
    const base = /<base href="[^"]+">/.test(raw);
    const html = raw.replace(/<base href="[^"]+">/, '');
    const dir = base ? out : path.dirname(page);
    const pageIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const link = m[1].replace(/&amp;/g, '&');
      if (/^(https?:|mailto:|data:)/.test(link)) continue;
      checked++;
      if (link.startsWith('#')) {
        if (link.length > 1 && !pageIds.has(link.slice(1))) errors.push(`${rel}: anchor ${link} has no target`);
        continue;
      }
      if (link.startsWith('/')) {
        errors.push(`${rel}: absolute link ${link} breaks under a subpath`);
        continue;
      }
      let target = path.resolve(dir, link.replace(/[?#].*$/, ''));
      if (link.replace(/[?#].*$/, '').endsWith('/') || link === '' || link === './') target = path.join(target, 'index.html');
      if (!target.startsWith(out)) errors.push(`${rel}: link ${link} leaves the site`);
      else if (!fs.existsSync(target)) errors.push(`${rel}: broken link ${link}`);
    }
  }
  console.log(`check: ${cases.length} case files valid, ${pages.length} pages, ${checked} internal links and assets`);
} catch (e) {
  errors.push(`build failed: ${e.message}`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

for (const w of warnings) console.log(`warning: ${w}`);
for (const e of errors) console.log(`error: ${e}`);
if (errors.length) {
  console.log(`check failed with ${errors.length} error(s)`);
  process.exit(1);
}
console.log('check passed');
