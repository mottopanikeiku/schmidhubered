// HTML for the 1200×630 share cards, rendered to PNG by scripts/cards.mjs. The same quiet picture as
// the case pages: his year in red on the left, the usually credited year in blue on the right.
import crypto from 'node:crypto';
import { esc, cardOf, yearOf } from './lib.mjs';

export const CARD_W = 1200;
export const CARD_H = 630;
const VERSION = 5;

export function cardHash(c) {
  const k = cardOf(c);
  return crypto.createHash('sha1').update(JSON.stringify([VERSION, k.headline, k.credited, k.challenger, k.question])).digest('hex').slice(0, 10);
}

function shell(fontDir, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Archivo";src:url("${fontDir}/archivo.woff2") format("woff2");font-weight:400 900;font-stretch:62% 100%}
*{margin:0;box-sizing:border-box}
html,body{width:${CARD_W}px;height:${CARD_H}px;overflow:hidden}
body{background:#f5f4f0;color:#17181c;font-family:"Archivo",sans-serif;font-weight:400;display:flex;flex-direction:column;padding:56px 72px 52px}
.top{display:flex;justify-content:space-between;font-size:22px;color:#7a7c84}
.top b{font-weight:400;color:#17181c}
h1{font-size:54px;font-weight:400;line-height:1.05;letter-spacing:-.01em;margin-top:34px}
.m{display:flex;justify-content:space-between;margin-top:36px}
.s{display:flex;flex-direction:column}
.s.r{text-align:right;align-items:flex-end}
.y{font-weight:800;font-stretch:66%;font-size:150px;line-height:.82;font-variant-numeric:tabular-nums}
.l .y{color:#d93f1f}.r .y{color:#1f4fd1}
.w{font-size:26px;margin-top:16px}
.t{font-size:21px;color:#7a7c84;margin-top:2px;max-width:440px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g{margin-top:auto;display:flex;align-items:center;gap:20px;font-size:21px;color:#7a7c84}
.g i{flex:1;height:1.5px;background:#17181c;position:relative}
.g i::before,.g i::after{content:"";position:absolute;top:-7px;width:16px;height:16px;border-radius:50%}
.g i::before{left:-8px;background:#d93f1f}.g i::after{right:-8px;background:#1f4fd1}
.site{display:flex;flex-direction:column;height:100%}
.site h1{font-size:120px;letter-spacing:-.02em;margin-top:40px}
.site .g{margin-top:70px}
.site .q{margin-top:auto;font-size:32px;line-height:1.3;color:#3d3f46;max-width:980px}
</style></head><body>${inner}</body></html>`;
}

export function caseCardHTML(c, fontDir) {
  const k = cardOf(c);
  const a = yearOf(k.challenger.year);
  const b = yearOf(k.credited.year);
  const gap = a && b ? (a === b ? 'the same year' : `${Math.abs(b - a)} years`) : '';
  return shell(fontDir, `<div class="top"><b>Schmidhubered</b><span>${esc(k.category || '')}</span></div>
<h1${k.headline.length > 38 ? ' style="font-size:44px"' : ''}>${esc(k.headline)}</h1>
<div class="m"><div class="s l"><span class="y">${esc(k.challenger.year)}</span><span class="w">${esc(k.challenger.who)}</span><span class="t">${esc(k.challenger.what)}</span></div>
<div class="s r"><span class="y">${esc(k.credited.year)}</span><span class="w">${esc(k.credited.who)}</span><span class="t">${esc(k.credited.what)}</span></div></div>
<div class="g"><i></i><span>${gap}</span></div>`);
}

export function siteCardHTML(fontDir) {
  return shell(fontDir, `<div class="site"><h1>Schmidhubered</h1>
<div class="g"><i></i></div>
<p class="q">Jürgen Schmidhuber says these results were done earlier, by him or by others. Read both sides and vote.</p></div>`);
}
