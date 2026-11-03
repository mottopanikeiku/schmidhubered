// Keeps one GitHub issue per case, which holds that case's votes, and records the numbers in
// data/issues.json. Uses the gh CLI, so run `gh auth login` first.
//   node scripts/sync-issues.mjs                       show what would be created in the site's repo
//   node scripts/sync-issues.mjs --yes                 create the missing issues
//   node scripts/sync-issues.mjs --update [--yes]      also rewrite the title and first post of existing
//                                                      issues whose text no longer matches the case card
//   node scripts/sync-issues.mjs --repo owner/name --map /tmp/issues.json --yes   try it on another repo
// Each issue body carries a hidden marker with the case id, so a lost data/issues.json is rebuilt from
// the existing issues instead of creating duplicates. Editing the first post keeps its reactions.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, REPO, SITE_URL, loadCases, cardOf } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const repo = opt('--repo', REPO);
const mapFile = path.resolve(ROOT, opt('--map', 'data/issues.json'));
const apply = args.includes('--yes');
const update = args.includes('--update');
const LABEL = 'case';
const VOTE_LINE = 'Vote by reacting to this post: 👍 valid, 😕 partly, 👎 not valid. Comments are open for arguments and corrections.';

function gh(argv, input) {
  return execFileSync('gh', argv, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
const api = (route, ...rest) => JSON.parse(gh(['api', route, ...rest]) || 'null');

function issueTitle(c) {
  const k = cardOf(c);
  return `${k.headline}: ${k.challenger.who} (${k.challenger.year}) vs ${k.credited.who} (${k.credited.year})`;
}

function issueBody(c) {
  const k = cardOf(c);
  return `<!-- case:${c.id} -->
**${k.question}**

**His claim:** ${k.claim}

**The pushback:** ${k.pushback}

**What you're judging:** ${k.crux}

The full case, with both sides in their own words and every recorded statement of the claim: ${SITE_URL}cases/${c.id}/

${VOTE_LINE}
`;
}

const { cases, problems } = loadCases();
if (problems.length) {
  for (const p of problems) console.error(`${p.file}: ${p.errors.join('; ')}`);
  console.error('fix the case files above first (npm run check)');
  process.exit(1);
}

const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
const save = () => {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(mapFile, JSON.stringify(sorted, null, 2) + '\n');
};

// GitHub follows renames silently, so make sure the name still points at the repo we mean.
const info = api(`repos/${repo}`);
if (info.full_name.toLowerCase() !== repo.toLowerCase()) {
  console.error(`${repo} now redirects to ${info.full_name}; refusing to touch it`);
  process.exit(1);
}

// Recover numbers from existing issues before creating anything, and keep their text for --update.
const existing = new Map();
for (let page = 1; ; page++) {
  const list = api(`repos/${repo}/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
  for (const issue of list) {
    existing.set(issue.number, issue);
    const id = issue.body?.match(/<!-- case:([a-z0-9-]+) -->/)?.[1];
    if (id && !map[id]) map[id] = issue.number;
  }
  if (list.length < 100) break;
}

// Most recorded statements first, so the best-known cases get the lowest numbers.
const todo = cases.filter((c) => !map[c.id]).sort((a, b) => b.claim.times_made - a.claim.times_made || a.id.localeCompare(b.id));
const stale = update ? cases.filter((c) => {
  const issue = existing.get(map[c.id]);
  return issue && (issue.title !== issueTitle(c) || (issue.body || '').trim() !== issueBody(c).trim());
}) : [];
console.log(`${repo}: ${cases.length} cases, ${cases.length - todo.length} with issues, ${todo.length} to create${update ? `, ${stale.length} to update` : ''}`);

if (!apply) {
  for (const c of todo) console.log(`  would create "${issueTitle(c)}"`);
  for (const c of stale) console.log(`  would update #${map[c.id]} to "${issueTitle(c)}"`);
  const example = todo[0] || stale[0];
  if (example) console.log(`\nexample body:\n${issueBody(example)}`);
  console.log('dry run; add --yes to apply');
  process.exit(0);
}

if (todo.length) {
  try {
    api(`repos/${repo}/labels/${LABEL}`);
  } catch {
    gh(['api', '-X', 'POST', `repos/${repo}/labels`, '-f', `name=${LABEL}`, '-f', 'color=e2401c', '-f', 'description=One case on the site; react to the first post to vote']);
    console.log(`created label "${LABEL}"`);
  }
}

// GitHub limits how fast content can be created or edited; one request a second stays well inside it.
const pause = () => new Promise((r) => setTimeout(r, 1000));

for (const c of todo) {
  const payload = JSON.stringify({ title: issueTitle(c), body: issueBody(c), labels: [LABEL] });
  const issue = JSON.parse(gh(['api', '-X', 'POST', `repos/${repo}/issues`, '--input', '-'], payload));
  map[c.id] = issue.number;
  save();
  console.log(`created #${issue.number} ${c.id}`);
  await pause();
}

for (const c of stale) {
  const payload = JSON.stringify({ title: issueTitle(c), body: issueBody(c) });
  gh(['api', '-X', 'PATCH', `repos/${repo}/issues/${map[c.id]}`, '--input', '-'], payload);
  console.log(`updated #${map[c.id]} ${c.id}`);
  await pause();
}

save();
console.log(`done: ${Object.keys(map).length} cases mapped in ${path.relative(ROOT, mapFile) || mapFile}`);
