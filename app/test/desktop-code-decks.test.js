// Code (UI plan, phase 3): one compact toolbar, task decks by category under
// the box, `/` for the same list, {{blanks}} selected on fill, and the
// project's own tasks in .neuraos/commands/*.md. tasks.js is pure; the .tsx
// pins keep the screen's shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const tasks = require('../desktop/src/tasks.js');

test('seven decks, five to seven tasks each, every task a template with a label', () => {
  assert.deepEqual(tasks.DECKS.map((d) => d.id), ['build', 'fix', 'refactor', 'test', 'review', 'docs', 'git']);
  const ids = new Set();
  for (const deck of tasks.DECKS) {
    assert.ok(deck.tasks.length >= 5 && deck.tasks.length <= 7, `${deck.id} has ${deck.tasks.length} tasks`);
    assert.ok(deck.hint && deck.icon);
    for (const t of deck.tasks) {
      assert.ok(t.label && t.template.length > 20, `${deck.id}:${t.id}`);
      assert.ok(!ids.has(deck.id + ':' + t.id), 'ids are unique');
      ids.add(deck.id + ':' + t.id);
    }
  }
  assert.equal(tasks.deckAt('fix').label, 'Fix');
  assert.equal(tasks.deckAt('nope'), null);
});

test('blanks are found once each, the first is selectable, and fill leaves the unanswered', () => {
  const t = 'Rename {{old name}} to {{new name}} in {{old name}}.';
  assert.deepEqual(tasks.blanks(t), ['old name', 'new name']);
  assert.deepEqual(tasks.firstBlank(t), { start: 7, end: 19 });
  assert.equal(tasks.firstBlank('no blanks'), null);
  assert.equal(tasks.fill(t, { 'old name': 'foo' }), 'Rename foo to {{new name}} in foo.');
  assert.equal(tasks.fill(t, { 'old name': '  ' }), t, 'whitespace is not an answer');
  assert.deepEqual(tasks.blanks(''), []);
});

test('the / menu lists custom tasks first, then every deck, filtered by words', () => {
  const custom = [tasks.parseCustom('deploy-staging.md', '# Deploy to staging\n> Pushes the branch\n\nDeploy {{branch}} to staging.')];
  const all = tasks.slashRows('/', custom, 100);
  assert.equal(all[0].deck, 'Mine');
  assert.equal(all[0].label, 'Deploy to staging');
  assert.equal(all.length, 1 + tasks.DECKS.reduce((n, d) => n + d.tasks.length, 0));
  assert.equal(tasks.slashRows('/', [], 5).length, 5, 'capped');
  const fix = tasks.slashRows('/fix bug', []);
  assert.equal(fix[0].label, 'Fix a bug');
  assert.deepEqual(tasks.slashRows('/zzzz', []), []);
  assert.equal(tasks.isSlash('/'), true);
  assert.equal(tasks.isSlash('/fix te'), true);
  assert.equal(tasks.isSlash('fix /x'), false);
  assert.equal(tasks.isSlash('/fix: the thing'), false, 'punctuation means a sentence, not a search');
});

test('a custom task file round-trips through parseCustom and customFile', () => {
  const file = tasks.customFile('Deploy to staging', 'Deploy {{branch}} to staging.', 'Pushes the branch');
  assert.equal(file.path, '.neuraos/commands/deploy-to-staging.md');
  const back = tasks.parseCustom('deploy-to-staging.md', file.text);
  assert.equal(back.label, 'Deploy to staging');
  assert.equal(back.hint, 'Pushes the branch');
  assert.equal(back.template, 'Deploy {{branch}} to staging.');
  assert.equal(back.custom, true);
  assert.equal(tasks.parseCustom('plain.md', 'Just a template line').label, 'plain');
  assert.equal(tasks.parseCustom('empty.md', '# Title only\n'), null);
  assert.equal(tasks.fileNameOf('  Weird/Name!!  '), 'weird-name.md');
  assert.equal(tasks.fileNameOf(''), 'task.md');
});

test('the Code screen wears the toolbar, the decks and the / menu', () => {
  const code = read('desktop', 'src', 'screens', 'CodeScreen.tsx');
  assert.match(code, /className="code-toolbar"/);
  assert.ok(!/<header className="screen-header">/.test(code), 'the big header is gone');
  assert.match(code, /<TaskDecks custom=\{customTasks\} onPick=\{fillRequest\}/);
  assert.match(code, /tasksLib\.slashRows\(request, customTasks\)/);
  assert.match(code, /box\.setSelectionRange\(at\.start, at\.end\)/, 'the first blank is selected on fill');
  assert.match(code, /readLocalFile\(localRoot, '\.git\/HEAD'\)/, 'the branch comes from .git/HEAD');
  assert.match(code, /tasksLib\.customFile\(label, template\)/);
  assert.match(code, /freeai4u:open-project/);
  const decks = read('desktop', 'src', 'components', 'TaskDecks.tsx');
  assert.match(decks, /HOVER_MS = 150/);
  assert.match(decks, /pointerType === 'mouse'/);
  assert.match(read('desktop', 'src', 'App.tsx'), /detail\.panel === 'terminal'/);
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.code-toolbar', '.task-decks', '.task-deck-card', '.code-slash', '.task-row', '.code-empty']) assert.ok(css.includes(sel + ' {'), `index.css has ${sel}`);
});
