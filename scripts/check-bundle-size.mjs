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
// The budget lives in scripts/bundle-budget.json rather than in this file, so
// raising it is a visible one-line diff in a PR instead of an edit to a
// script nobody reads. `--write` rewrites it from the current dist, which is
// how a legitimate increase is recorded deliberately rather than by loosening
// a constant here.
//
// Usage:
//   node scripts/check-bundle-size.mjs [--dist DIR] [--write] [--top N]
//
// Exit 1 when the build is over budget, naming the largest assets so the PR
// says which dependency grew rather than just "too big".
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = join(ROOT, 'scripts', 'bundle-budget.json');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DIST = resolve(ROOT, opt('--dist', 'app/desktop/dist'));
const TOP = Number(opt('--top', '10')) || 10;

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

function readBudget() {
  if (!existsSync(BUDGET_FILE)) {
    throw new Error(`no budget file at ${relative(ROOT, BUDGET_FILE)}; run with --write to create one`);
  }
  return JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// Paths inside the repository read better relative to it; one outside it (only
// when a caller passes --dist) is clearer absolute than as ../../../..
const show = (p) => {
  const rel = relative(ROOT, p);
  return rel && !rel.startsWith('..') ? rel : p;
};

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

const report = {
  totalBytes: total,
  totalFiles: files.length,
  largestAssetBytes: largest.bytes,
  jsBytes: byType('.js'),
  cssBytes: byType('.css'),
};

if (flag('--write')) {
  // Records exactly what was measured, so the file always describes the real
  // build and any change -- up or down -- shows up as a reviewable diff. CI
  // always measures a fresh `npm run build`, so a stale small dist cannot
  // quietly lower the ceiling here.
  const next = {
    totalBytes: report.totalBytes,
    largestAssetBytes: report.largestAssetBytes,
    note:
      'Ceiling for app/desktop/dist, the frontend embedded in the binary. Re-record it with ' +
      '"node scripts/check-bundle-size.mjs --write" and say in the PR which dependency earned the bytes.',
  };
  writeFileSync(BUDGET_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`budget written to ${relative(ROOT, BUDGET_FILE)}:`);
  console.log(`  totalBytes         ${next.totalBytes} (${mb(next.totalBytes)})`);
  console.log(`  largestAssetBytes  ${next.largestAssetBytes} (${mb(next.largestAssetBytes)})`);
  process.exit(0);
}

const budget = readBudget();
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

const top = files
  .slice()
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, TOP)
  .map((f) => `  ${mb(f.bytes).padStart(10)}  ${relative(DIST, f.path)}`)
  .join('\n');

console.log(`dist: ${mb(total)} in ${files.length} files (js ${mb(report.jsBytes)}, css ${mb(report.cssBytes)})`);
console.log(`budget: ${mb(budget.totalBytes)} total, ${mb(budget.largestAssetBytes)} largest asset`);
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
