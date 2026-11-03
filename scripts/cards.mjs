// Renders share cards with a headless Chrome, if one is installed.
//   node scripts/cards.mjs           one card per case into .cards/ (skips cards that are up to date)
//   node scripts/cards.mjs --static  the site card, src/card.png (committed)
// The build uses whatever cards exist and falls back to the site card, so this step is optional.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, loadCases } from './lib.mjs';
import { CARD_W, CARD_H, cardHash, caseCardHTML, siteCardHTML } from './card-template.mjs';

const run = promisify(execFile);
const FONTS = path.join(ROOT, 'src/fonts');
const CACHE = path.join(ROOT, '.cards');

function findChrome() {
  const names = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const pw = path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const sub of ['chrome-linux-arm64/chrome', 'chrome-linux/chrome', 'chrome-linux64/chrome']) names.push(path.join(pw, d, sub));
    }
  }
  return names.find((p) => p && fs.existsSync(p));
}

async function shoot(chrome, html, out, w, h) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-'));
  const file = path.join(tmp, 'card.html');
  fs.writeFileSync(file, html);
  try {
    await run(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
      '--force-device-scale-factor=1', `--user-data-dir=${path.join(tmp, 'profile')}`, `--window-size=${w},${h}`,
      '--virtual-time-budget=3000', `--screenshot=${out}`, `file://${file}`], { timeout: 60000 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function pool(jobs, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < jobs.length) await jobs[i++]();
  }));
}

const chrome = findChrome();
if (!chrome) {
  console.warn('cards: no Chrome or Chromium found (set CHROME=/path/to/chrome); pages will use the site card');
  process.exit(0);
}

if (process.argv.includes('--static')) {
  await shoot(chrome, siteCardHTML(FONTS), path.join(ROOT, 'src/card.png'), CARD_W, CARD_H);
  console.log('cards: wrote src/card.png');
} else {
  fs.mkdirSync(CACHE, { recursive: true });
  const { cases } = loadCases();
  const want = new Set(cases.map((c) => `${c.id}-${cardHash(c)}.png`));
  for (const f of fs.readdirSync(CACHE)) if (!want.has(f)) fs.rmSync(path.join(CACHE, f));
  const todo = cases.filter((c) => !fs.existsSync(path.join(CACHE, `${c.id}-${cardHash(c)}.png`)));
  await pool(todo.map((c) => () => shoot(chrome, caseCardHTML(c, FONTS), path.join(CACHE, `${c.id}-${cardHash(c)}.png`), CARD_W, CARD_H)), 3);
  console.log(`cards: rendered ${todo.length}, ${cases.length - todo.length} already up to date`);
}
