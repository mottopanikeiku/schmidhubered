// Live vote counts and the sort/filter controls on the home page. The build prepends src/tally.js
// to this file and fills in the API address, so the pages work as plain HTML when this never runs.
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
      const html = tallyInner(n, 'open');
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

// "89 recorded statements" links to the full list of statements, which is collapsed by default. A link that
// arrives with #every is handled by an inline script next to the list, before the page is painted.
const every = document.getElementById('every-list');
if (every) {
  for (const a of document.querySelectorAll('a[href="#every"]')) a.addEventListener('click', () => { every.open = true; });
}

const list = document.getElementById('rows');
if (list) {
  const sort = document.getElementById('sort');
  const credited = document.getElementById('credited');
  const shown = document.getElementById('shown');
  const num = (el, k) => Number(el.dataset[k]);
  const orders = {
    votes: (a, b) => num(b, 'votes') - num(a, 'votes') || num(b, 'statements') - num(a, 'statements'),
    contested: (a, b) => num(b, 'contest') - num(a, 'contest') || num(b, 'votes') - num(a, 'votes'),
    statements: (a, b) => num(b, 'statements') - num(a, 'statements'),
    year: (a, b) => num(a, 'year') - num(b, 'year') || num(b, 'statements') - num(a, 'statements'),
  };

  const params = new URLSearchParams(location.search);
  const pick = (select, value) => {
    if (value && [...select.options].some((o) => o.value === value)) select.value = value;
  };
  pick(sort, params.get('sort'));
  pick(credited, params.get('credited'));

  const apply = () => {
    const rows = [...list.children];
    rows.sort((a, b) => orders[sort.value](a, b) || a.dataset.title.localeCompare(b.dataset.title));
    list.append(...rows);
    const who = credited.value;
    let n = 0;
    for (const row of rows) {
      row.hidden = Boolean(who) && !row.dataset.credited.split(' ').includes(who);
      if (!row.hidden) n++;
    }
    const name = who ? credited.selectedOptions[0].textContent.replace(/ \(\d+\)$/, '') : '';
    shown.textContent = `${n} ${n === 1 ? 'case' : 'cases'}${who ? ` crediting ${name}` : ''}`;
    const q = new URLSearchParams();
    if (sort.value !== 'votes') q.set('sort', sort.value);
    if (who) q.set('credited', who);
    history.replaceState(null, '', q.size ? `?${q}` : location.pathname);
  };

  sort.addEventListener('change', apply);
  credited.addEventListener('change', apply);
  if (params.has('sort') || params.has('credited')) apply();
}
