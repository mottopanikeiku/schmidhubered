// Live vote counts, and the sort and category controls of the chart on the home page. The build prepends
// src/tally.js to this file and fills in the API address, so the pages work as plain HTML when this never runs.
import { fromReactions, total, contest, tallyInner, miniInner, voteLine } from './tally.js';

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

const live = document.querySelectorAll('[data-issue]');
if (live.length) {
  liveCounts().then((c) => {
    for (const el of live) {
      const n = c[el.dataset.issue];
      if (!n) continue;
      const html = el.classList.contains('tally') ? tallyInner(n, 'open')
        : el.classList.contains('mini') ? miniInner(n) : voteLine(n, 'open');
      if (el.innerHTML !== html) el.innerHTML = html;
      const row = el.closest('.row');
      if (row) {
        row.dataset.votes = total(n);
        row.dataset.contest = contest(n).toFixed(5);
      }
    }
  }).catch(() => {
    // Rate-limited or offline: the counts baked in at the last build stay on the page.
  });
}

// The recorded statements live inside the full case, which is collapsed by default. A link that
// arrives with #every is handled by an inline script next to it, before the page is painted.
const full = document.getElementById('full');
if (full) {
  for (const a of document.querySelectorAll('a[href="#every"]')) a.addEventListener('click', () => { full.open = true; });
}

const rows = document.getElementById('rows');
if (rows) {
  const sort = document.getElementById('sort');
  const cat = document.getElementById('cat');
  const shown = document.getElementById('shown');
  const num = (el, k) => Number(el.dataset[k]);
  const orders = {
    gap: (a, b) => num(b, 'gap') - num(a, 'gap') || num(a, 'his') - num(b, 'his'),
    his: (a, b) => num(a, 'his') - num(b, 'his') || num(a, 'cred') - num(b, 'cred'),
    cred: (a, b) => num(a, 'cred') - num(b, 'cred') || num(a, 'his') - num(b, 'his'),
    votes: (a, b) => num(b, 'votes') - num(a, 'votes') || num(b, 'gap') - num(a, 'gap'),
  };

  const params = new URLSearchParams(location.search);
  const pick = (select, value) => {
    if ([...select.options].some((o) => o.value === value)) select.value = value;
  };
  pick(sort, params.get('sort'));
  pick(cat, params.get('cat'));

  const apply = () => {
    const list = [...rows.children];
    list.sort((a, b) => orders[sort.value](a, b) || a.dataset.title.localeCompare(b.dataset.title));
    rows.append(...list);
    let n = 0;
    for (const row of list) {
      row.hidden = Boolean(cat.value) && row.dataset.cat !== cat.value;
      if (!row.hidden) n++;
    }
    shown.textContent = `${n} ${n === 1 ? 'case' : 'cases'}`;
    const q = new URLSearchParams();
    if (sort.value !== sort.options[0].value) q.set('sort', sort.value);
    if (cat.value) q.set('cat', cat.value);
    history.replaceState(null, '', q.size ? `?${q}` : location.pathname);
  };

  sort.addEventListener('change', apply);
  cat.addEventListener('change', apply);
  if (params.has('sort') || params.has('cat')) apply();
}
