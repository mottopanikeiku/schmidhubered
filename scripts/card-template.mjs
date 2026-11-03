// HTML for the 1200×630 share cards, rendered to PNG by scripts/cards.mjs.
import crypto from 'node:crypto';
import { esc } from './lib.mjs';

export const CARD_W = 1200;
export const CARD_H = 630;
const VERSION = 2;

export function cardHash(c) {
  return crypto.createHash('sha1').update(JSON.stringify([VERSION, c.title, c.matchup, c.question])).digest('hex').slice(0, 10);
}

function shell(fontDir, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Docket Serif";src:url("${fontDir}/serif-roman.woff2") format("woff2");font-weight:400 700}
@font-face{font-family:"Docket Serif";src:url("${fontDir}/serif-italic.woff2") format("woff2");font-weight:400 700;font-style:italic}
*{margin:0;box-sizing:border-box}
html,body{width:${CARD_W}px;height:${CARD_H}px;overflow:hidden}
body{background:#f6f2e8;color:#1f1c17;font-family:"Docket Serif",Georgia,serif;padding:64px 80px 56px;display:flex;flex-direction:column;
  font-variant-numeric:lining-nums}
.top{display:flex;justify-content:space-between;align-items:baseline;border-top:3px solid #1f1c17;padding-top:14px;
  font-size:22px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
.top span:last-child{color:#7a2e22;letter-spacing:.08em}
.rule{border-top:1px solid #1f1c17;margin-top:6px}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center}
h1{font-size:68px;line-height:1.04;font-weight:650;letter-spacing:-.012em}
.m{font-size:28px;line-height:1.3;color:#5d5548;margin-top:18px}
.q{font-size:30px;line-height:1.32;font-style:italic;margin-top:26px;max-width:1000px}
.foot{display:flex;gap:34px;font-size:23px;color:#5d5548;border-top:1px solid #cfc6b3;padding-top:16px}
.foot b{font-weight:600;color:#1f1c17}
.site h1{font-size:104px;letter-spacing:-.02em}
.site .q{font-style:normal;font-size:34px;color:#3c372e}
</style></head><body>${inner}</body></html>`;
}

const foot = '<div class="foot"><span><b>Valid</b></span><span><b>Partly</b></span><span><b>Not valid</b></span><span style="margin-left:auto">Vote on GitHub</span></div>';

export function caseCardHTML(c, fontDir) {
  const long = c.question.length > 150;
  return shell(fontDir, `<div class="top"><span>Schmidhubered</span><span>A priority claim</span></div><div class="rule"></div>
<div class="mid"><h1${c.title.length > 34 ? ' style="font-size:56px"' : ''}>${esc(c.title)}</h1>
<p class="m">${esc(c.matchup)}</p>
<p class="q"${long ? ' style="font-size:26px"' : ''}>${esc(c.question)}</p></div>${foot}`);
}

export function siteCardHTML(fontDir) {
  return shell(fontDir, `<div class="top"><span>A docket of priority claims</span><span>Case by case</span></div><div class="rule"></div>
<div class="mid site"><h1>Schmidhubered</h1>
<p class="q">Jürgen Schmidhuber’s priority claims, each set out with both sides in their own words and a vote on whether it holds.</p></div>${foot}`);
}
