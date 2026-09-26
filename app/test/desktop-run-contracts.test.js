// C1/C2/C3 (upgrade plan): a recipe states what its final report must
// contain (the Runs board ticks each item — an incomplete report does not
// sit in Done looking finished); every run keeps its evidence in one folder
// linked from its card; and a run's spend is shown against the recipe's
// budget with an alert near the limit. The checks are pure — this test is
// the proof — and the pins keep Activity wired to them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runs = require('../desktop/src/runs.js');
const recipes = require('../desktop/src/recipes.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const NOW = 1_700_000_000_000;

test('the contract is ticked against the report, however it is phrased', () => {
  const check = runs.contractCheck(['a summary table', 'RISK'], 'Here is a SUMMARY  TABLE:\n| a |\n\nThere is no risk to report.');
  assert.equal(check.items.length, 2);
  assert.equal(check.items[0].ok, true, 'case and spacing are normalised');
  assert.equal(check.items[1].ok, true, 'lowercased against the report');
  assert.equal(check.complete, true);
  const missing = runs.contractCheck(['a summary table', 'a date'], 'A summary table.');
  assert.equal(missing.complete, false, 'one miss keeps the run out of Done');
  assert.deepEqual(missing.items.map((i) => i.ok), [true, false]);
  assert.equal(runs.contractCheck([], 'anything').complete, true, 'nothing asked, nothing missed');
  assert.equal(runs.contractCheck(['x'], '').complete, false, 'no report, no ticks');
});

test('the budget is an estimate with an alert near the limit', () => {
  assert.equal(runs.budgetBar(0, 0).level, 'none');
  assert.equal(runs.budgetBar(1000, 100).level, 'ok');
  assert.equal(runs.budgetBar(1000, 800).level, 'near', '80% is the alert');
  assert.equal(runs.budgetBar(1000, 1001).level, 'over');
  assert.match(runs.budgetBar(25000, 12400).label, /≈12\.4k \/ 25k tok/, 'the label says ≈');
  assert.equal(runs.budgetBar(0, 1234).label, '≈1.2k tok', 'spend without a budget is still said');
  assert.equal(runs.budgetBar(null, undefined).level, 'none');
});

test('the evidence folder carries the report, the contract, the changes and the traces', () => {
  const plan = runs.artifactPlan({
    recipeName: 'Nightly Report',
    at: NOW,
    ok: true,
    chatId: 'c1',
    report: 'All good — a summary table is attached.',
    contract: ['a summary table'],
    changes: [{ kind: 'write', path: 'src/a.js' }, { kind: 'edit', path: 'src/b.js' }],
    traces: [{ at: NOW, kind: 'model', chars: 10, ms: 5 }],
  });
  assert.match(plan.dir, /^\.neuraos\/runs\/nightly-report-\d{8}-\d{6}$/, 'one folder, named for the run');
  const byPath = Object.fromEntries(plan.files.map((f) => [f.path, f.text]));
  assert.deepEqual(Object.keys(byPath).sort(), ['changes.txt', 'report.md', 'traces.jsonl']);
  assert.match(byPath['report.md'], /- \[x\] a summary table/, 'the contract is ticked into the file');
  assert.match(byPath['report.md'], /All good/);
  assert.equal(byPath['changes.txt'], 'write src/a.js\nedit src/b.js\n');
  assert.doesNotThrow(() => byPath['traces.jsonl'].trim().split('\n').map((l) => JSON.parse(l)), 'the traces are JSONL');
  // A failed run keeps why, and a run with nothing changed still says so.
  const failed = runs.artifactPlan({ recipeName: 'x', at: NOW, ok: false, error: 'boom', report: '' });
  const failedPaths = failed.files.map((f) => f.path);
  assert.ok(failedPaths.includes('error.txt'));
  assert.match(failed.files.find((f) => f.path === 'changes.txt').text, /no files changed/);
  assert.match(failed.files.find((f) => f.path === 'report.md').text, /no report was kept/);
});

test('the board keeps an unfinished report out of Done', () => {
  const board = (extra) => runs.board({
    now: NOW,
    recipes: [{ id: 'a', name: 'Nightly' }],
    runs: { a: { at: NOW - 60_000, ok: true, chatId: 'c1' } },
    ...extra,
  });
  const [queued, running, review, done] = board({
    contracts: { a: ['a summary table', 'a date'] },
    reports: { a: 'A summary table, no date.' },
    budgets: { a: 1000 },
    spend: { a: 950 },
  });
  assert.equal(done.cards.length, 0, 'missing the contract is not Done');
  assert.equal(review.cards.length, 1);
  const card = review.cards[0];
  assert.equal(card.kind, 'run');
  assert.equal(card.contract.items[1].ok, false, 'the missing item is on the card');
  assert.equal(card.budget.level, 'near', 'the budget alert is on the card too');

  const doneOnly = board({
    contracts: { a: ['a summary table'] },
    reports: { a: 'A summary table.' },
    budgets: { a: 1000 },
    spend: { a: 100 },
  })[3];
  assert.equal(doneOnly.cards.length, 1, 'a kept contract finishes in Done');
  assert.match(doneOnly.cards[0].meta, /contract 1\/1/);
  assert.equal(doneOnly.cards[0].budget.level, 'ok');
  // Without contracts or budgets the board is exactly what it was.
  const plain = board({});
  assert.equal(plain[2].cards.length, 0);
  assert.match(plain[3].cards[0].meta, /^ok · /, 'the old meta is untouched');
});

test('a recipe can state its contract and its budget', () => {
  const checked = recipes.validate({
    id: 'nightly', name: 'Nightly', prompt: 'Do the thing.',
    contract: ['a summary table', 'a summary table', 'the word RISK'], budget: 25000,
  });
  assert.equal(checked.ok, true, checked.errors.join('; '));
  assert.deepEqual(checked.recipe.contract, ['a summary table', 'the word RISK'], 'trimmed and deduped');
  assert.equal(checked.recipe.budget, 25000);
  assert.equal(recipes.validate({ id: 'x', name: 'x', prompt: 'p', contract: 'nope' }).ok, false);
  assert.equal(recipes.validate({ id: 'x', name: 'x', prompt: 'p', budget: -1 }).ok, false);
  // And it survives the round trip through storage: list() re-validates.
  const store = { getItem: () => JSON.stringify([{ id: 'x', name: 'x', prompt: 'p', contract: ['a'], budget: 100 }]), setItem: () => {}, removeItem: () => {} };
  assert.deepEqual(recipes.list(store)[0].contract, ['a']);
});

test('Activity feeds the board and links the evidence', () => {
  const activity = read('app', 'desktop', 'src', 'screens', 'ActivityScreen.tsx');
  assert.match(activity, /contracts, reports, budgets, spend/, 'all four maps reach the board');
  assert.match(activity, /runsLib\.artifactPlan\(\{/, 'the card saves evidence through runs.js');
  assert.match(activity, /writeLocalFile\(root/, 'into the open folder');
  assert.match(activity, /xdg-open/, 'and the link opens the folder');
  assert.match(activity, /'Save evidence'/, 'the action is on the card');
  const css = read('app', 'desktop', 'src', 'index.css');
  for (const sel of ['.runs-contract', '.runs-tick.is-ok', '.runs-budget.is-over']) {
    assert.ok(css.includes(sel), `index.css has ${sel}`);
  }
  const dts = read('app', 'desktop', 'src', 'runs.d.ts');
  for (const pin of ['contractCheck', 'budgetBar', 'artifactPlan', 'contracts?', 'budgets?']) {
    assert.ok(dts.includes(pin), `runs.d.ts has ${pin}`);
  }
  const rdts = read('app', 'desktop', 'src', 'recipes.d.ts');
  assert.ok(rdts.includes('contract?: string[]'), 'the recipe type carries the contract');
  assert.ok(rdts.includes('budget?: number'), 'and the budget');
});
