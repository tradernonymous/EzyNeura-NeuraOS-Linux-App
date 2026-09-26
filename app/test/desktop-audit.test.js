// C12 (upgrade plan): every approval decision is appended to a log the
// model's tools cannot touch — localStorage, which no read_file or shell
// command of the agent's addresses — shown in Activity, and carrying
// decisions and summaries only: never the raw arguments, which can hold a
// secret. audit.js is pure with an injected store; the pins keep the
// approval funnel and the Activity section wired to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = require('../desktop/src/audit.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/** The storage shape, without a browser. */
const fakeStore = (start) => {
  const box = new Map(Object.entries(start || {}));
  return {
    getItem: (k) => (box.has(k) ? box.get(k) : null),
    setItem: (k, v) => box.set(k, String(v)),
    dump: () => Object.fromEntries(box),
  };
};

test('a decision round-trips: tool, summary, decision, project, time', () => {
  const box = fakeStore();
  const row = audit.record({ tool: 'run_command', summary: ' git status', decision: 'allowed', project: '/home/u/p', at: 1000 }, box);
  assert.equal(row.at, 1000);
  assert.equal(audit.read(box).length, 1);
  assert.deepEqual(audit.read(box)[0], {
    at: 1000, tool: 'run_command', summary: 'git status', decision: 'allowed', project: '/home/u/p',
  });
});

test('the log is capped, oldest first out, newest kept', () => {
  const box = fakeStore();
  for (let i = 0; i < audit.MAX + 5; i += 1) {
    audit.record({ tool: 'write_file', summary: `f${i}`, decision: 'allowed', at: i }, box);
  }
  const rows = audit.read(box);
  assert.equal(rows.length, audit.MAX, `capped at ${audit.MAX}`);
  assert.equal(rows[0].at, 5, 'the oldest five fell off');
  assert.equal(rows[rows.length - 1].at, audit.MAX + 4, 'the newest is kept');
  assert.deepEqual(audit.recent(box, 1).map((r) => r.at), [audit.MAX + 4], 'recent is newest first');
});

test('summaries are collapsed and bounded; a tool-less entry is dropped', () => {
  const box = fakeStore();
  const row = audit.record({ tool: 'edit_file', summary: 'a\n  long\n\n summary ' + 'x'.repeat(600), decision: 'edited', at: 1 }, box);
  assert.ok(!row.summary.includes('\n'), 'one line');
  assert.ok(row.summary.length <= 300, `bounded, got ${row.summary.length}`);
  assert.equal(audit.record({ tool: '', summary: 'no tool' }, box), null);
  assert.equal(audit.read(box).length, 1, 'nothing tool-less was written');
});

test('a corrupt or blocked store costs the log, never the answer', () => {
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(audit.read(broken), [], 'a corrupt log reads as empty, not an error');
  const row = audit.record({ tool: 'run_command', summary: 'ls', decision: 'allowed' }, broken);
  assert.equal(row.tool, 'run_command', 'the caller still gets its row');
  assert.deepEqual(audit.read(null), [], 'no store at all is empty');
});

test('decisions are said in words a person reads', () => {
  assert.equal(audit.wordFor('edited'), 'allowed, edited');
  assert.equal(audit.wordFor('always'), 'always allowed');
  assert.equal(audit.wordFor('stopped'), 'stopped');
  assert.equal(audit.wordFor('denied'), 'denied');
  assert.equal(audit.wordFor('allowed'), 'allowed');
});

test('the funnel records every answer, and arguments never reach the log', () => {
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.match(chat, /auditLib\.record\(\{/, 'the approval promise appends');
  const at = chat.indexOf('auditLib.record({');
  const block = chat.slice(at, chat.indexOf('});', at));
  assert.match(block, /tool: event\.name/);
  assert.match(block, /summary: event\.summary \|\| event\.name/);
  assert.match(block, /decision: typeof decision === 'object' \? 'edited'/, 'an edit is distinguishable from a plain allow');
  assert.match(block, /project: openFolder\(\)/);
  assert.ok(!/args:/.test(block), 'the raw arguments are never recorded');
  assert.match(chat, /finish\(false, 'stopped'\)/, 'stopping a turn is an answer too');
  // C4/C11 changed this line: "always" on a command card means the folder's
  // read-only preset (recorded as "project"), on any other card it is the
  // old per-tool always.
  assert.match(chat, /resolve\(allow && args \? \{ args \} : allow, via\)/, 'the recorded word is the decision that happened');
  assert.match(chat, /via = 'project'/, 'a command card\'s "always" is recorded as for this project');
  assert.match(chat, /via = 'always'/, '"always" is recorded as always');

  const activity = read('desktop', 'src', 'screens', 'ActivityScreen.tsx');
  assert.match(activity, /auditLib\.recent\(undefined, 20\)/, 'Activity shows the log');
  assert.match(activity, /auditLib\.wordFor\(e\.decision\)/);
  assert.match(activity, /never the arguments themselves/, 'the screen says what is not recorded');
  assert.match(activity, /import '\.\.\/audit\.js'/);

  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.audit-row', '.audit-decision', '.audit-summary']) assert.ok(css.includes(sel), `index.css has ${sel}`);
});
