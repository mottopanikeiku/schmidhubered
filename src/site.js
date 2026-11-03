// Live vote counts, and the category chips and sort on the home page. The build prepends
// src/tally.js to this file and fills in the API address, so the pages work as plain HTML when this never runs.
import { fromReactions, total, contest, tallyInner } from './tally.js';

const API = '__VOTES_API__';
const KEY = 'schmidhubered:votes';
const TTL = 5 * 60 * 1000;

// One unauthenticated request for every case issue, kept in sessionStorage for a few minutes
// because GitHub allows 60 such requests an hour per address.
async function liveCounts() {
  try {
    const hit = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (hit && Date.now() - hit.t < TTL) return hit.c;
  } catch {}
  const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const c = {};
  for (const issue of await res.json()) c[issue.number] = fromReactions(issue.reactions);
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), c }));
  } catch {}
  return c;
}

const tallies = document.querySelectorAll('.tally[data-issue]');
if (tallies.length) {
  liveCounts().then((c) => {
    for (const el of tallies) {
      const n = c[el.dataset.issue];
      if (!n) continue;
      const html = tallyInner(n, 'open', 'compact' in el.dataset);
      if (el.innerHTML !== html) el.innerHTML = html;
      const card = el.closest('.card');
      if (card) {
        card.dataset.votes = total(n);
        card.dataset.contest = contest(n).toFixed(5);
      }
    }
  }).catch(() => {
    // Rate-limited or offline: the counts baked in at the last build stay on the page.
  });
}

// "87 recorded statements" links into the full case, which is collapsed by default. A link that
// arrives with #every is handled by an inline script next to it, before the page is painted.
const full = document.getElementById('full');
if (full) {
  for (const a of document.querySelectorAll('a[href="#every"]')) a.addEventListener('click', () => { full.open = true; });
}

const grid = document.getElementById('grid');
if (grid) {
  const chips = [...document.querySelectorAll('.chip[data-cat]')];
  const sort = document.getElementById('sort');
  const shown = document.getElementById('shown');
  const num = (el, k) => Number(el.dataset[k]);
  const orders = {
    votes: (a, b) => num(b, 'votes') - num(a, 'votes') || num(b, 'statements') - num(a, 'statements'),
    contested: (a, b) => num(b, 'contest') - num(a, 'contest') || num(b, 'votes') - num(a, 'votes'),
    statements: (a, b) => num(b, 'statements') - num(a, 'statements'),
    year: (a, b) => num(a, 'year') - num(b, 'year') || num(b, 'statements') - num(a, 'statements'),
  };
  let cat = '';

  const params = new URLSearchParams(location.search);
  if ([...sort.options].some((o) => o.value === params.get('sort'))) sort.value = params.get('sort');
  if (chips.some((c) => c.dataset.cat === params.get('cat'))) cat = params.get('cat');

  const apply = () => {
    const cards = [...grid.children];
    cards.sort((a, b) => orders[sort.value](a, b) || a.dataset.title.localeCompare(b.dataset.title));
    grid.append(...cards);
    let n = 0;
    for (const card of cards) {
      card.hidden = Boolean(cat) && card.dataset.cat !== cat;
      if (!card.hidden) n++;
    }
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.cat === cat));
    shown.textContent = `${n} ${n === 1 ? 'case' : 'cases'}`;
    const q = new URLSearchParams();
    if (cat) q.set('cat', cat);
    if (sort.value !== 'votes') q.set('sort', sort.value);
    history.replaceState(null, '', q.size ? `?${q}` : location.pathname);
  };

  for (const chip of chips) chip.addEventListener('click', () => { cat = chip.dataset.cat; apply(); });
  sort.addEventListener('change', apply);
  if (cat || params.has('sort')) apply();
}
