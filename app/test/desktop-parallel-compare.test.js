// C5 (upgrade plan, L6): "The Activity board compares them, and you merge
// the winner." parallel-compare.js is pure — the numstat parse, the table
// itself and the store (an injectable storage) — so the whole comparison is
// tested here without a shell; the .tsx pins keep ParallelScreen recording
// and the Activity board rendering it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cmp = require('../desktop/src/parallel-compare.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/** localStorage's shape, in memory. */
function box() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// git diff --numstat output: `add<TAB>del<TAB>path`, then git's summary line.
const NUMSTAT = [
  '12\t3\tsrc/a.ts',
  '5\t1\tsrc/shared.ts',
  '-\t-\tlogo.png',
  '2 files changed, 17 insertions(+), 4 deletions(-)',
].join('\n');

test('numstat is parsed exactly, binary files are not counted as lines', () => {
  const files = cmp.parseNumstat(NUMSTAT);
  assert.deepEqual(files.map((f) => f.path), ['src/a.ts', 'src/shared.ts', 'logo.png']);
  assert.equal(files[0].add, 12);
  assert.equal(files[0].del, 3);
  assert.ok(files[2].binary, 'a "-" count means binary, not zero lines');
  assert.equal(files[2].add, 0);
  // Garbage, warnings and the summary line are skipped, never guessed at.
  assert.deepEqual(cmp.parseNumstat('warning: LF will be replaced by CRLF\n3 files changed, 9 insertions(+)'), []);
  assert.deepEqual(cmp.parseNumstat(''), []);
  // A path is only listed once even if the output repeats it.
  assert.equal(cmp.parseNumstat('1\t0\ta.ts\n2\t0\ta.ts').length, 1);
});

test('runs are recorded, grouped into batches, and compared with collisions first', () => {
  const store = box();
  const base = { root: '/home/u/proj', at: 1000, ms: 5000, status: 'done' };
  assert.ok(cmp.record({ ...base, batch: 'b1', slug: 'task-1', branch: 'neuraos/task-1', task: 'Add validation', files: cmp.parseNumstat(NUMSTAT) }, store));
  cmp.record({ ...base, batch: 'b1', slug: 'task-2', branch: 'neuraos/task-2', task: 'Write tests', at: 2000, files: [{ path: 'src/shared.ts', add: 2, del: 0 }, { path: 'test/a.test.ts', add: 30, del: 0 }] }, store);
  cmp.record({ ...base, batch: 'b0', slug: 'task-3', branch: 'neuraos/task-3', task: 'Older batch', at: 500, files: [] }, store);

  const mine = cmp.list('/home/u/proj', store);
  assert.equal(mine.length, 3, 'newest first');
  assert.equal(mine[0].slug, 'task-3', 'newest record first');

  const groups = cmp.batches(mine);
  assert.deepEqual(groups.map((g) => g.batch), ['b0', 'b1'], 'newest batch first');
  assert.equal(groups[1].runs.length, 2, 'both runs of the press are together');

  const table = cmp.compare(groups[1].runs);
  assert.equal(table.columns.length, 2);
  // list() is newest first, so task-2's column comes before task-1's.
  assert.deepEqual(table.columns.map((c) => c.totals.files), [2, 3]);
  // src/shared.ts is touched by BOTH runs: it sorts first, and both cells fill in.
  assert.equal(table.rows[0].path, 'src/shared.ts');
  assert.equal(table.rows[0].by, 2);
  assert.deepEqual(table.rows[0].cells, [{ add: 2, del: 0, binary: false }, { add: 5, del: 1, binary: false }]);
  assert.equal(table.overlap, 1, 'exactly one collision');
  // A file only the second run touched has a null slot for the other.
  const solo = table.rows.find((r) => r.path === 'test/a.test.ts');
  assert.deepEqual(solo.cells, [{ add: 30, del: 0, binary: false }, null]);

  // Re-recording the same run in the same batch replaces it, not doubles it
  // (and that run becomes the batch's newest fact, so find the batch by id).
  cmp.record({ ...base, batch: 'b1', slug: 'task-1', branch: 'neuraos/task-1', task: 'Add validation', status: 'error', files: [] }, store);
  const again = cmp.batches(cmp.list('/home/u/proj', store)).find((g) => g.batch === 'b1');
  assert.equal(again.runs.length, 2);
  assert.equal(cmp.compare(again.runs).columns.find((c) => c.slug === 'task-1').status, 'error');
});

test('merge keeps a row, discard removes it, clear wipes one folder only', () => {
  const store = box();
  cmp.record({ batch: 'b', slug: 'a', branch: 'neuraos/a', task: 'x', root: '/p/one', at: 1, ms: 1, status: 'done', files: [] }, store);
  cmp.record({ batch: 'b', slug: 'c', branch: 'neuraos/c', task: 'y', root: '/p/two', at: 2, ms: 1, status: 'done', files: [] }, store);
  assert.ok(cmp.markMerged('b', 'a', store));
  assert.equal(cmp.list('', store).find((e) => e.slug === 'a').merged, true, 'the winner is named');

  cmp.remove('b', 'a', store);
  assert.equal(cmp.list('', store).some((e) => e.slug === 'a'), false, 'a discarded run leaves the comparison');
  cmp.remove('b', 'nope', store); // absent is not an error

  cmp.clear('/p/two', store);
  assert.deepEqual(cmp.list('', store), [], "one folder's records are gone");
  assert.ok(cmp.record({ batch: 'b', slug: 'z', branch: 'b/z', task: 'z', at: 3, ms: 1, status: 'done', files: [] }, store), 'the store still works');
  cmp.clear('', store);
  assert.equal(cmp.list('', store).length, 0);
});

test('the record is a whitelist and survives a full store', () => {
  const store = box();
  const built = cmp.build({ slug: 's', batch: 'b', secret: 'sk-should-not-survive', task: '  spaced   task  ', files: [{ path: 'x', add: 1, del: 0, junk: 5 }] });
  assert.ok(!('secret' in built), 'extra fields are dropped, not serialised');
  assert.ok(!('junk' in built.files[0]));
  assert.equal(built.task, 'spaced task');
  assert.equal(cmp.build({}), null, 'no slug, no record');
  assert.equal(cmp.record({}, store), false);

  for (let i = 0; i < cmp.CAP_ENTRIES + 10; i += 1) {
    cmp.record({ batch: 'b', slug: `s${i}`, branch: 'b', task: 't', at: i, ms: 1, status: 'done', files: [] }, store);
  }
  const all = cmp.list('', store);
  assert.equal(all.length, cmp.CAP_ENTRIES, 'the store is capped, newest kept');
});

test('the shell line, the Parallel screen and the Activity board agree', () => {
  assert.equal(cmp.numstatCommand(), 'git add -A && git diff --cached --numstat HEAD');
  const parallel = read('desktop', 'src', 'screens', 'ParallelScreen.tsx');
  assert.match(parallel, /compareLib\.parseNumstat\(num\?\.stdout \|\| ''\)/, 'the run records its own numbers');
  assert.match(parallel, /compareLib\.record\(\{\s*batch, root: localRoot/, 'records carry the batch and the folder');
  assert.match(parallel, /compareLib\.markMerged\(card\.batch, card\.row\.slug\)/, 'merging names the winner');
  assert.match(parallel, /if \(!card\.merged\) compareLib\.remove\(card\.batch, card\.row\.slug\)/, 'discarding removes, only when unmerged');
  assert.match(parallel, /void runOne\(row, provider, model, batch, now\)/, 'one batch per press');

  const activity = read('desktop', 'src', 'screens', 'ActivityScreen.tsx');
  assert.match(activity, /Parallel runs/, 'the board has the section');
  assert.match(activity, /compareLib\.batches\(compareLib\.list\(root\)\)/, 'grouped by batch, newest first');
  assert.match(activity, /row\.by >= 2 \? 'is-shared' : ''/, 'collisions are marked');
  assert.match(activity, /onOpen\('parallel'\)/, 'the section links to the Parallel screen');
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.compare-table', '.compare-batch', '.compare-path', '.is-shared']) {
    assert.ok(css.includes(sel), `index.css has ${sel}`);
  }
});
