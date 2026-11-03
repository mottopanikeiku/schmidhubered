// Creates the GitHub issue that holds the votes for every case that does not have one yet, and records
// the numbers in data/issues.json. Uses the gh CLI, so run `gh auth login` first.
//   node scripts/sync-issues.mjs                       show what would be created in the site's repo
//   node scripts/sync-issues.mjs --yes                 create them
//   node scripts/sync-issues.mjs --repo owner/name --map /tmp/issues.json --yes   try it on another repo
// Each issue body carries a hidden marker with the case id, so a lost data/issues.json is rebuilt from
// the existing issues instead of creating duplicates.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, REPO, SITE_URL, loadCases } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const repo = opt('--repo', REPO);
const mapFile = path.resolve(ROOT, opt('--map', 'data/issues.json'));
const apply = args.includes('--yes');
const LABEL = 'case';
const VOTE_LINE = 'Vote by reacting to this post: 👍 valid, 😕 partly, 👎 not valid. Comments are open for arguments and corrections.';

function gh(argv, input) {
  return execFileSync('gh', argv, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
const api = (route, ...rest) => JSON.parse(gh(['api', route, ...rest]) || 'null');

// First sentence of a case text, with Markdown kept (GitHub renders it). Initials, "et al." and
// similar abbreviations do not end a sentence.
function firstSentence(s) {
  const text = String(s).trim();
  const re = /[.!?](?=["”’)]?\s+["“‘(]?[A-Z0-9])/g;
  for (let m; (m = re.exec(text));) {
    const before = text.slice(0, m.index).split(/\s+/).pop();
    if (/^(?:(?:[A-Z]\.)*[A-Z]|al|e\.g|i\.e|vs|cf|Dr|Mr|Mrs|Ms|Prof|St|No|Fig|Eq|Sec|approx|ca|c|U\.S)$/.test(before)) continue;
    return text.slice(0, m.index + 1);
  }
  return text;
}

function issueBody(c) {
  const summary = [c.usual_credit.summary, c.claim.summary, c.crux].map(firstSentence).join(' ');
  return `<!-- case:${c.id} -->
**${c.question}**

${summary}

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

// Recover numbers from existing issues before creating anything.
for (let page = 1; ; page++) {
  const list = api(`repos/${repo}/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
  for (const issue of list) {
    const id = issue.body?.match(/<!-- case:([a-z0-9-]+) -->/)?.[1];
    if (id && !map[id]) map[id] = issue.number;
  }
  if (list.length < 100) break;
}

// Most recorded statements first, so the best-known cases get the lowest numbers.
const todo = cases.filter((c) => !map[c.id]).sort((a, b) => b.claim.times_made - a.claim.times_made || a.id.localeCompare(b.id));
console.log(`${repo}: ${cases.length} cases, ${cases.length - todo.length} with issues, ${todo.length} to create`);

if (!apply) {
  for (const c of todo) console.log(`  would create "${c.title}: ${c.matchup}"`);
  if (todo[0]) console.log(`\nexample body:\n${issueBody(todo[0])}`);
  console.log('dry run; add --yes to create them');
  process.exit(0);
}

try {
  api(`repos/${repo}/labels/${LABEL}`);
} catch {
  gh(['api', '-X', 'POST', `repos/${repo}/labels`, '-f', `name=${LABEL}`, '-f', 'color=7a2e22', '-f', 'description=One case on the site; react to the first post to vote']);
  console.log(`created label "${LABEL}"`);
}

for (const c of todo) {
  const payload = JSON.stringify({ title: `${c.title}: ${c.matchup}`, body: issueBody(c), labels: [LABEL] });
  const issue = JSON.parse(gh(['api', '-X', 'POST', `repos/${repo}/issues`, '--input', '-'], payload));
  map[c.id] = issue.number;
  save();
  console.log(`#${issue.number} ${c.id}`);
  // GitHub limits how fast content can be created; one issue a second stays well inside it.
  await new Promise((r) => setTimeout(r, 1000));
}
save();
console.log(`done: ${Object.keys(map).length} cases mapped in ${path.relative(ROOT, mapFile) || mapFile}`);
