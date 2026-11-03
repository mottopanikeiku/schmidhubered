// HTML for the 1200×630 share cards, rendered to PNG by scripts/cards.mjs. Same matchup as the site:
// the credited side in blue on the left, Schmidhuber's side in vermilion on the right.
import crypto from 'node:crypto';
import { esc, cardOf, yearOf } from './lib.mjs';

export const CARD_W = 1200;
export const CARD_H = 630;
const VERSION = 4;

export function cardHash(c) {
  const k = cardOf(c);
  return crypto.createHash('sha1').update(JSON.stringify([VERSION, k.headline, k.category, k.credited, k.challenger, k.question])).digest('hex').slice(0, 10);
}

function shell(fontDir, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Archivo";src:url("${fontDir}/archivo.woff2") format("woff2");font-weight:400 900;font-stretch:62% 100%}
*{margin:0;box-sizing:border-box}
html,body{width:${CARD_W}px;height:${CARD_H}px;overflow:hidden}
body{background:#f3f2ee;color:#111216;font-family:"Archivo",sans-serif;display:flex;flex-direction:column;
  border-top:14px solid;border-image:linear-gradient(90deg,#e2401c 50%,#1546c7 50%) 1;padding:44px 64px 40px}
.top{display:flex;justify-content:space-between;align-items:baseline;font-weight:700;font-size:20px;letter-spacing:.1em;text-transform:uppercase;color:#6a6d77}
.brand{font-weight:900;font-stretch:70%;font-size:34px;letter-spacing:.01em;color:#111216}
.brand span{color:#e2401c}
h1{font-size:54px;font-weight:850;font-stretch:82%;line-height:1;margin-top:26px;letter-spacing:-.01em}
.m{display:grid;grid-template-columns:auto 1fr auto;column-gap:36px;margin-top:22px;align-items:start}
.s{display:flex;flex-direction:column}
.s.r{text-align:right;align-items:flex-end}
.y{font-weight:850;font-stretch:66%;font-size:150px;line-height:.86;font-variant-numeric:tabular-nums}
.l .y{color:#e2401c}.r .y{color:#1546c7}
.w{font-weight:800;font-size:28px;margin-top:10px;max-width:420px}
.t{font-size:22px;color:#6a6d77;margin-top:4px;max-width:400px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.g{padding-top:66px;text-align:center;font-weight:700;font-size:22px;letter-spacing:.06em;text-transform:uppercase;color:#3a3c44}
.g i{display:block;height:4px;margin-top:10px;background:linear-gradient(90deg,#e2401c,#1546c7)}
.q{margin-top:auto;font-size:30px;font-weight:600;line-height:1.22;color:#3a3c44;max-width:1060px}
.site h1{font-size:176px;font-weight:900;font-stretch:62%;text-transform:uppercase;line-height:.85;margin-top:40px}
.site h1 span{color:#e2401c}
.site .q{font-size:36px}
</style></head><body>${inner}</body></html>`;
}

export function caseCardHTML(c, fontDir) {
  const k = cardOf(c);
  const a = yearOf(k.credited.year);
  const b = yearOf(k.challenger.year);
  const gap = a && b && a !== b ? `${Math.abs(a - b)} yrs` : '';
  const q = k.question.length > 120 ? 'font-size:26px' : '';
  return shell(fontDir, `<div class="top"><span class="brand">Schmidhuber<span>ed</span></span><span>${esc(k.category || 'A priority claim')}</span></div>
<h1${k.headline.length > 40 ? ' style="font-size:44px"' : ''}>${esc(k.headline)}</h1>
<div class="m"><div class="s l"><span class="y">${esc(k.challenger.year)}</span><span class="w">${esc(k.challenger.who)}</span><span class="t">${esc(k.challenger.what)}</span></div>
<div class="g">${gap}<i></i></div>
<div class="s r"><span class="y">${esc(k.credited.year)}</span><span class="w">${esc(k.credited.who)}</span><span class="t">${esc(k.credited.what)}</span></div></div>
<p class="q" style="${q}">${esc(k.question)}</p>`);
}

export function siteCardHTML(fontDir) {
  return shell(fontDir, `<div class="top site"><span>Priority claims, case by case</span><span>Vote on each</span></div>
<div class="site"><h1>Schmidhuber<span>ed</span></h1></div>
<p class="q">Jürgen Schmidhuber says these results were done earlier, by him or by others. Read both sides and vote.</p>`);
}
