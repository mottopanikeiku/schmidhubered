// Vote arithmetic and markup, shared by the build (counts baked into the HTML) and the browser
// (live counts from the GitHub API). Keep this file free of imports so the build can inline it.

// Left to right in the order of the matchup: Schmidhuber's side (valid), partly, the credited side (not valid).
export const CHOICES = [
  ['v', 'Valid', '+1'],
  ['p', 'Partly', 'confused'],
  ['n', 'Not valid', '-1'],
];

export function fromReactions(r) {
  return { v: r?.['+1'] || 0, p: r?.confused || 0, n: r?.['-1'] || 0 };
}

export function total(c) {
  return c ? c.v + c.p + c.n : 0;
}

// Whole-number percentages that add up to 100 (largest remainder).
export function percents(c) {
  const t = total(c);
  if (!t) return { v: 0, p: 0, n: 0 };
  const raw = CHOICES.map(([k]) => [k, (c[k] * 100) / t]);
  const out = Object.fromEntries(raw.map(([k, x]) => [k, Math.floor(x)]));
  let left = 100 - raw.reduce((s, [k]) => s + out[k], 0);
  for (const [k] of raw.slice().sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
    if (left-- <= 0) break;
    out[k] += 1;
  }
  return out;
}

// Spread of opinion: votes are placed at 1 (valid), 0.5 (partly) and 0 (not valid) and this is
// their variance, from 0 when everyone agrees to 0.25 for an even split between valid and not valid.
export function contest(c) {
  const t = total(c);
  if (!t) return -1;
  const mean = (c.v + 0.5 * c.p) / t;
  return (c.v * (1 - mean) ** 2 + c.p * (0.5 - mean) ** 2 + c.n * mean ** 2) / t;
}

function segments(c) {
  const t = total(c);
  return CHOICES.filter(([k]) => c[k] > 0)
    .map(([k]) => `<span class="seg ${k}" style="width:${((c[k] * 100) / t).toFixed(2)}%"></span>`).join('');
}

// "12 votes: valid 50%, partly 25%, not valid 25%", or why there is no count.
export function voteLine(c, state) {
  if (state === 'closed') return 'Voting not yet open';
  if (state === 'unknown' || !c) return 'Vote count unavailable';
  const t = total(c);
  if (!t) return 'No votes yet';
  const pc = percents(c);
  return `${t.toLocaleString('en-US')} ${t === 1 ? 'vote' : 'votes'}: ${CHOICES.map(([k, name]) => `${name.toLowerCase()} ${pc[k]}%`).join(', ')}`;
}

// The result on a case page: a thin bar and the line above, or just the line when there are no votes.
export function tallyInner(c, state) {
  const bar = c && total(c) ? `<span class="bar" role="img" aria-label="${voteLine(c, state)}">${segments(c)}</span>` : '';
  return `<span class="bar-slot">${bar}</span><span class="tally-text">${voteLine(c, state)}</span>`;
}

// The tiny bar at the end of a chart row; nothing at all until a case has votes.
export function miniInner(c) {
  return c && total(c) ? `<span class="bar" aria-hidden="true">${segments(c)}</span>` : '';
}
