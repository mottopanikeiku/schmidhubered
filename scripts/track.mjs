// Finds new posts by @SchmidhuberAI and appends them to data/latest.json, newest first.
//   node scripts/track.mjs              read his latest posts through api.fxtwitter.com
//   node scripts/track.mjs <id> [<id>]  also fetch these post ids directly (Twitter's embed endpoint)
// Posts already in seed/known_post_ids.json or data/latest.json are skipped. Each new post gets the
// case ids whose patterns in seed/case_rules.json match it and a likely_claim flag (see lib.mjs).
// When fxtwitter cannot be reached the run warns and exits successfully, so the schedule never fails on it.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, loadRules, matchCases, likelyClaim } from './lib.mjs';

const HANDLE = 'SchmidhuberAI';
const PAGES = 3;
const FILE = path.join(ROOT, 'data/latest.json');
const UA = 'schmidhubered-tracker (+https://github.com/mottopanikeiku/schmidhubered)';

const latest = readJSON('data/latest.json', []);
const known = new Set([...readJSON('seed/known_post_ids.json', []), ...latest.map((p) => p.id)]);
const rules = loadRules();
const own = (name) => String(name || '').toLowerCase() === HANDLE.toLowerCase();
const postUrl = (user, id) => `https://x.com/${user}/status/${id}`;

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
  return res.json();
}

function fromFx(s) {
  const at = new Date(s.created_timestamp ? s.created_timestamp * 1000 : s.created_at);
  return {
    id: s.id,
    url: postUrl(HANDLE, s.id),
    created_at: at.toISOString(),
    text: s.text,
    reply_to: s.replying_to?.status ? postUrl(s.replying_to.screen_name, s.replying_to.status) : null,
    quoting: s.quote?.id ? postUrl(s.quote.author?.screen_name || 'i', s.quote.id) : null,
  };
}

function fromSyndication(t) {
  let text = t.note_tweet?.text || t.text || '';
  for (const u of t.entities?.urls || []) text = text.replaceAll(u.url, u.expanded_url);
  for (const m of t.entities?.media || []) text = text.replaceAll(m.url, '').trim();
  return {
    id: t.id_str,
    url: postUrl(HANDLE, t.id_str),
    created_at: new Date(t.created_at).toISOString(),
    text,
    reply_to: t.in_reply_to_status_id_str ? postUrl(t.in_reply_to_screen_name, t.in_reply_to_status_id_str) : null,
    quoting: t.quoted_tweet ? postUrl(t.quoted_tweet.user?.screen_name || 'i', t.quoted_tweet.id_str) : null,
  };
}

const found = new Map();
const warnings = [];

try {
  let cursor = null;
  for (let page = 0; page < PAGES; page++) {
    const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const data = await getJSON(`https://api.fxtwitter.com/2/profile/${HANDLE}/statuses?count=100${q}`);
    const mine = (data.results || []).filter((s) => own(s.author?.screen_name));
    for (const s of mine) if (!found.has(s.id)) found.set(s.id, fromFx(s));
    cursor = data.cursor?.bottom;
    // Stop paging once a page holds nothing new (the pinned post aside, the timeline is newest first).
    if (!cursor || !mine.length || mine.every((s) => known.has(s.id))) break;
  }
} catch (e) {
  warnings.push(`fxtwitter: ${e.message}`);
}

const ids = [...process.argv.slice(2), ...(process.env.TRACK_IDS || '').split(/[\s,]+/)].filter((x) => /^\d{5,}$/.test(x));
for (const id of ids) {
  if (known.has(id) || found.has(id)) continue;
  try {
    const t = await getJSON(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=a`);
    if (!own(t.user?.screen_name)) warnings.push(`post ${id} is not by @${HANDLE}, skipped`);
    else found.set(id, fromSyndication(t));
  } catch (e) {
    warnings.push(`syndication ${id}: ${e.message}`);
  }
}

const fresh = [...found.values()].filter((p) => !known.has(p.id))
  .map((p) => ({ ...p, cases: matchCases(p.text, rules), likely_claim: likelyClaim(p.text) }));

if (fresh.length) {
  const all = [...latest, ...fresh].sort((a, b) => b.created_at.localeCompare(a.created_at));
  fs.writeFileSync(FILE, JSON.stringify(all, null, 1) + '\n');
}

for (const w of warnings) console.log(process.env.GITHUB_ACTIONS ? `::warning::${w}` : `warning: ${w}`);
const flagged = fresh.filter((p) => p.likely_claim).length;
console.log(`track: ${fresh.length} new post(s), ${flagged} flagged as likely claims, ${found.size} read`);
for (const p of fresh) console.log(`  ${p.created_at.slice(0, 16)} ${p.likely_claim ? 'claim' : '     '} [${p.cases.join(',')}] ${p.text.replace(/\s+/g, ' ').slice(0, 90)}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_posts=${fresh.length}\n`);
