#!/usr/bin/env node
// The frontend is embedded in the binary, so its size is the app's download
// size, its install size, and how long the window takes to come up. Nothing
// else in the build notices a dependency quietly doubling that, which is why
// this is a gate rather than a report.
//
// What it measures: the bytes in app/desktop/dist, which is exactly what
// `generate_context!` embeds (tauri.conf.json, frontendDist). The engine
// (src-tauri/engine) is NOT counted -- it is a separate on-disk payload with
// its own zero-npm-dependency rule (AGENTS.md), not part of the page.
//
// Three ceilings, one file (scripts/bundle-budget.json):
//
//   totalBytes          the whole dist (the download, the install).
//   largestAssetBytes   any single file (one dependency shipping one blob).
//   entryBytes          index.html + the entry chunk + its CSS: the bytes the
//                       first window actually needs, our stand-in for
//                       time-to-first-window (nothing measures startup in CI,
//                       and the entry is what it is made of).
//
// Plus per-asset growth: the budget records the size of every chunk worth
// watching (>= 100 KB, keyed by its name with Vite's content hash stripped,
// so a rename of the hash is not a new chunk). A chunk may grow by the larger
// of 25% or 512 KB without comment; past that the gate fails and names the
// chunk, because a lazy dependency quietly doubling is exactly the change
// that sails under the total. `--write` re-records everything from the
// current dist, which is how a legitimate increase becomes a reviewable diff
// rather than a constant someone edits in place.
//
// Usage:
//   node scripts/check-bundle-size.mjs [--dist DIR] [--budget FILE] [--write] [--top N]
//
// Exit 1 when the build is over budget, naming the largest assets so the PR
// says which dependency grew rather than just "too big".
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DIST = resolve(ROOT, opt('--dist', 'app/desktop/dist'));
const BUDGET_FILE = resolve(ROOT, opt('--budget', join('scripts', 'bundle-budget.json')));
const TOP = Number(opt('--top', 10)) || 10;

// Only chunks at least this big are recorded per-asset: a 4 KB helper gaining
// 3 KB is noise, and the budget file should stay readable.
const RECORD_FROM = 100 * 1024;
// Default growth a recorded chunk may take before the gate complains. Both
// bounds apply: the larger of the ratio and the floor wins, so a small chunk
// may still double and a huge one may still add a few percent.
const GROWTH = { ratio: 0.25, bytes: 512 * 1024 };

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push({ path: p, bytes: st.size });
  }
  return out;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// Ceilings sit above the measurement on purpose: ordinary churn should pass,
// and the difference between measured and ceiling is what a PR eats into.
// `--write` records the measurement; raising a ceiling to a deliberate number
// is a hand edit with the reason in the note, exactly like wave 1 did it.
const HEADROOM = 1.13;

// Paths inside the repository read better relative to it; one outside it (only
// when a caller passes --dist) is clearer absolute than as ../../../..
const show = (p) => {
  const rel = relative(ROOT, p);
  return rel && !rel.startsWith('..') ? rel : p;
};

// Vite names a chunk `<stem>-<hash>.<ext>`, and some chunks (mermaid's) carry
// more than one hashed group (`cynefin-OW5HDTMX-C_LRS5sR.js`). The hashes
// change whenever the content does, so the budget keys on the name with every
// trailing hash-like group stripped: the same logical chunk keeps the same key
// across builds. Over-stripping a hand-named chunk is safe here -- the key is
// only ever compared against itself from the recorded build.
function chunkStem(relPath) {
  const base = basename(relPath);
  const ext = extname(base);
  let stem = base.slice(0, base.length - ext.length);
  for (let prev = null; prev !== stem; ) {
    prev = stem;
    stem = stem.replace(/-[A-Za-z0-9_-]{6,}$/, '');
  }
  return stem + ext;
}

if (!existsSync(DIST)) {
  console.error(`no build at ${show(DIST)} -- run "npm run build" in app/desktop first`);
  process.exit(1);
}

const files = walk(DIST);
if (files.length === 0) {
  console.error(`${relative(ROOT, DIST)} is empty -- the frontend build produced nothing to measure`);
  process.exit(1);
}

const total = files.reduce((n, f) => n + f.bytes, 0);
const largest = files.reduce((a, b) => (b.bytes > a.bytes ? b : a));
const byType = (ext) => files.filter((f) => f.path.endsWith(ext)).reduce((n, f) => n + f.bytes, 0);

// Per-chunk totals: several files can share a stem (rare), so record the sum.
const byStem = new Map();
for (const f of files) {
  const key = chunkStem(relative(DIST, f.path));
  byStem.set(key, (byStem.get(key) || 0) + f.bytes);
}

// The entry: what the first window needs before it can draw anything. Vite's
// entry chunk is `index-<hash>.js`, its CSS `index-<hash>.css`, plus the
// index.html that loads them. A hand-made dist (a test tree) has none; the
// check is skipped there rather than failing a tree that never claimed one.
const entryParts = files.filter((f) => {
  const stem = chunkStem(relative(DIST, f.path));
  return stem === 'index.js' || stem === 'index.css' || stem === 'index.html';
});
const entryBytes = entryParts.reduce((n, f) => n + f.bytes, 0);

const report = {
  totalBytes: total,
  totalFiles: files.length,
  largestAssetBytes: largest.bytes,
  entryBytes,
  jsBytes: byType('.js'),
  cssBytes: byType('.css'),
};

if (flag('--write')) {
  // Records what was measured: exact sizes as the per-chunk growth baselines,
  // and the ceilings as the measurement plus 13% headroom so ordinary churn
  // passes. Every number here comes from a real dist, so any change -- up or
  // down -- shows up as a reviewable diff. CI always measures a fresh `npm run
  // build`, so a stale small dist cannot quietly lower the ceiling here.
  const assets = {};
  for (const [stem, bytes] of [...byStem.entries()].sort((a, b) => b[1] - a[1])) {
    if (bytes >= RECORD_FROM) assets[stem] = bytes;
  }
  const next = {
    totalBytes: Math.ceil(report.totalBytes * HEADROOM),
    largestAssetBytes: Math.ceil(report.largestAssetBytes * HEADROOM),
    entryBytes: report.entryBytes ? Math.ceil(report.entryBytes * HEADROOM) : undefined,
    assetGrowth: GROWTH,
    assets,
    note:
      'Ceiling for app/desktop/dist, the frontend embedded in the binary: the measurement plus 13% headroom, ' +
      'so ordinary churn passes and the difference is what a PR eats into. Re-record with ' +
      '"node scripts/check-bundle-size.mjs --write" and say in the PR which dependency earned the bytes. ' +
      "assets/ holds per-chunk sizes keyed by the chunk name with Vite's hash groups stripped; a chunk may grow " +
      'by the larger of assetGrowth.ratio or assetGrowth.bytes before the gate asks for a deliberate re-record.',
  };
  writeFileSync(BUDGET_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`budget written to ${show(BUDGET_FILE)}:`);
  console.log(`  totalBytes         ${next.totalBytes} (${mb(next.totalBytes)})`);
  console.log(`  largestAssetBytes  ${next.largestAssetBytes} (${mb(next.largestAssetBytes)})`);
  if (next.entryBytes) console.log(`  entryBytes         ${next.entryBytes} (${mb(next.entryBytes)})`);
  console.log(`  assets recorded    ${Object.keys(assets).length} chunks >= ${mb(RECORD_FROM)}`);
  process.exit(0);
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
const growth = budget.assetGrowth || GROWTH;
const problems = [];
if (total > budget.totalBytes) {
  problems.push(
    `dist is ${mb(total)}, over the ${mb(budget.totalBytes)} budget ` +
      `(+${mb(total - budget.totalBytes)}). The frontend is embedded in the binary.`,
  );
}
if (largest.bytes > budget.largestAssetBytes) {
  problems.push(
    `the largest asset is ${mb(largest.bytes)}, over the ${mb(budget.largestAssetBytes)} budget: ` +
      `${relative(DIST, largest.path)}`,
  );
}
if (budget.entryBytes && entryBytes > budget.entryBytes) {
  problems.push(
    `the entry (first window) is ${mb(entryBytes)}, over the ${mb(budget.entryBytes)} budget ` +
      `(+${mb(entryBytes - budget.entryBytes)}): ${entryParts.map((f) => relative(DIST, f.path)).join(', ')}`,
  );
}
for (const [stem, recorded] of Object.entries(budget.assets || {})) {
  const now = byStem.get(stem);
  if (now == null) continue; // a chunk that went away is not a problem
  const allowed = Math.max(recorded * growth.ratio, growth.bytes);
  if (now - recorded > allowed) {
    problems.push(
      `the ${stem} chunk grew from ${mb(recorded)} to ${mb(now)} (+${mb(now - recorded)}), ` +
        `past the ${mb(allowed)} this budget allows for it. If the growth is intended, re-record it deliberately.`,
    );
  }
}

const top = files
  .slice()
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, TOP)
  .map((f) => `  ${mb(f.bytes).padStart(10)}  ${relative(DIST, f.path)}`)
  .join('\n');

console.log(`dist: ${mb(total)} in ${files.length} files (js ${mb(report.jsBytes)}, css ${mb(report.cssBytes)})`);
console.log(`budget: ${mb(budget.totalBytes)} total, ${mb(budget.largestAssetBytes)} largest asset` + (budget.entryBytes ? `, ${mb(budget.entryBytes)} entry` : ''));
if (!entryParts.length) console.log('entry: none in this dist (a test tree, not a Vite build) -- the entry check is skipped');
console.log(`largest assets:\n${top}`);

if (problems.length) {
  console.error(`\nThe frontend is over budget:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  console.error(
    '\nIf the growth is intended, record it deliberately:\n' +
      '  node scripts/check-bundle-size.mjs --write\n' +
      'and say in the PR which dependency earned the bytes.',
  );
  process.exit(1);
}
console.log('within budget');
