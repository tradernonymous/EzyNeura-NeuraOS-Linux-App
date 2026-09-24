// Chat (UI plan, phase 2): the turn anatomy Freebuff draws -- steps folded
// into "Worked N steps", a badge per step, a stopped turn's Retry, chips
// under the last answer, rewind, the pinned goal, and the output panel that
// exists only when a turn produced something. turn.js is pure; the .tsx and
// .css pins keep the screen the way the plan drew it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const turn = require('../desktop/src/turn.js');

const ev = (name, status, args) => ({ id: name + status, name, status, args: args || {}, summary: name, asks: '' });

test('steps fold: a count, a label that says whether it is still working, open only while live', () => {
  const done = turn.stepsOf([ev('read_file', 'done'), ev('write_file', 'done'), ev('run_command', 'error')]);
  assert.equal(done.count, 3);
  assert.equal(done.label, 'Worked 3 steps');
  assert.equal(done.failed, 1);
  assert.equal(done.open, false);
  const live = turn.stepsOf([ev('read_file', 'done'), ev('run_command', 'asking')]);
  assert.equal(live.label, 'Working · 2 steps');
  assert.equal(live.open, true);
  assert.equal(turn.stepsOf([ev('x', 'running')]).label, 'Working · 1 step');
  assert.equal(turn.stepsOf(undefined).count, 0);
  assert.equal(turn.badgeOf('asking'), 'NEEDS OK');
  assert.equal(turn.badgeOf('done'), 'DONE');
  assert.equal(turn.badgeOf('weird'), 'WEIRD');
});

test('changes: every file a reply wrote or edited, once, the latest touch last', () => {
  const messages = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'ok', tools: [ev('write_file', 'done', { path: 'a.ts', content: '' }), ev('edit_file', 'done', { path: 'b.ts' }), ev('edit_file', 'denied', { path: 'c.ts' }), ev('run_command', 'done', { command: 'ls' })] },
    { role: 'assistant', content: 'more', tools: [ev('edit_file', 'done', { path: 'a.ts' })] },
  ];
  const changes = turn.changesOf(messages);
  assert.deepEqual(changes.map((c) => [c.path, c.kind, c.turns]), [['b.ts', 'edit', 1], ['a.ts', 'write', 2]]);
  assert.equal(turn.changeOf(ev('read_file', 'done', { path: 'x' })), null, 'reading is not a change');
  assert.equal(turn.latestPicture([{ role: 'user', images: ['data:1'] }, { role: 'assistant', content: 'x' }]), 'data:1');
  assert.equal(turn.latestPicture([]), '');
  assert.equal(turn.outputOf([{ role: 'user', content: 'hi' }]).any, false, 'a plain conversation has no output panel');
  assert.equal(turn.outputOf(messages).any, true);
});

test('chips: under a finished answer only, with code and review chips when they apply', () => {
  const plain = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Here is an idea.' }];
  assert.deepEqual(turn.chips(plain).map((c) => c.id), ['continue', 'shorter', 'explain', 'code']);
  assert.deepEqual(turn.chips(plain, { sending: true }), [], 'nothing while it streams');
  const coded = [{ role: 'user', content: 'x' }, { role: 'assistant', content: '```js\nlet a\n```' }];
  assert.deepEqual(turn.chips(coded).map((c) => c.id), ['continue', 'shorter', 'explain']);
  const changed = [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'done', tools: [ev('write_file', 'done', { path: 'a' })] }];
  assert.ok(turn.chips(changed).some((c) => c.id === 'review'));
  assert.ok(turn.chips(changed).some((c) => c.id === 'tests'));
  assert.deepEqual(turn.chips([{ role: 'user', content: 'x' }, { role: 'assistant', content: '', error: true }]), [], 'a failed turn has its own card');
  assert.deepEqual(turn.chips([{ role: 'user', content: 'x' }, { role: 'assistant', content: '/help', note: true }]), []);
  assert.deepEqual(turn.chips([{ role: 'user', content: 'x' }]), []);
  turn.chips(plain).forEach((c) => assert.ok(c.text.length > 3));
});

test('rewind cuts the thread before a user message and hands its words back', () => {
  const messages = [{ role: 'user', content: 'one\n\n--- attached ---\nfile' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'two' }, { role: 'assistant', content: 'b' }];
  const back = turn.rewindTo(messages, 2);
  assert.deepEqual(back.messages.map((m) => m.content), ['one\n\n--- attached ---\nfile', 'a']);
  assert.equal(back.draft, 'two');
  const first = turn.rewindTo(messages, 0);
  assert.equal(first.messages.length, 0);
  assert.equal(first.draft, 'one', 'the attachment text is not put back in the box');
  assert.equal(turn.rewindTo(messages, 1).draft, null, 'a reply cannot be rewound to');
  assert.equal(turn.rewindTo(messages, 1).messages, messages);
  assert.equal(turn.rewindTo(messages, 99).draft, null);
});

test('the goal rides as one system line, or not at all', () => {
  assert.equal(turn.goalPrompt(''), '');
  assert.equal(turn.goalPrompt('   '), '');
  assert.match(turn.goalPrompt('ship v2'), /goal for this whole conversation: ship v2/);
  assert.ok(turn.goalPrompt('x'.repeat(900)).length < 700, 'capped');
});

test('the screen wears the anatomy: fold, stop card, chips, rewind, goal, output panel, one bar', () => {
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.match(chat, /<StepsFold events=\{msg\.tools\}/);
  assert.ok(!/<ToolCards /.test(chat), 'tool cards are inside the fold now');
  assert.match(chat, /stopped: true/);
  assert.match(chat, /className="stopped-card"/);
  assert.match(chat, /turnLib\.chips\(active\.messages, \{ sending \}\)/);
  assert.match(chat, /turnLib\.rewindTo\(active\.messages, i\)/);
  assert.match(chat, /turnLib\.goalPrompt\(active\.goal\)/);
  assert.match(chat, /<ChatOutput/);
  assert.match(chat, /Reasoning · \{active\.reasoning \|\| 'off'\}/);
  const composer = read('desktop', 'src', 'components', 'Composer.tsx');
  assert.match(composer, /composer-foot-left/);
  assert.match(composer, /composer-foot-right/);
  assert.ok(!/composer-hint/.test(composer), 'the hint line is the send button\'s title now');
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.steps-fold', '.steps-summary', '.step-badge', '.stopped-card', '.reply-chip', '.goal-row', '.composer-pill', '.chat-output', '.message-rewind']) {
    assert.ok(css.includes(sel + ' {') || css.includes(sel + '{'), `index.css has ${sel}`);
  }
  assert.match(css, /\.send-btn \{ width: 34px; height: 34px; border-radius: 50%; \}/, 'the send button is round');
});
