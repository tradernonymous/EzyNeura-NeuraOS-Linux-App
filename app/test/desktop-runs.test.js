// Agents (UI plan, phase 6): one space with a switch, cards with hover
// actions (Run / Edit / Duplicate), and Runs as a list or a board (Queued →
// Running → Needs review → Done). runs.js is pure; the .tsx pins keep the
// screens' shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const runs = require('../desktop/src/runs.js');

const NOW = 1_700_000_000_000;
const recipe = (id, schedule) => ({ id, name: 'Recipe ' + id, schedule });

test('the board: four columns, each fed by the module that owns its facts', () => {
  const columns = runs.board({
    now: NOW,
    pending: [{ id: 'p1', recipeId: 'a', recipeName: 'Recipe a', tool: 'run_command', summary: 'ls', at: NOW - 1000 }],
    busy: ['c1', 'c9'],
    sessions: [{ id: 'c1', title: 'Fix the tests', model: 'llama', updatedAt: NOW - 5000 }],
    recipes: [recipe('a', { everyMinutes: 30 }), recipe('b', { everyMinutes: 5, enabled: false }), recipe('c', { dailyAt: '09:00' })],
    runs: { a: { at: NOW - 60_000, ok: true, chatId: 'c1' }, z: { at: NOW - 7_200_000, ok: false, error: 'boom' } },
    nextRun: (r, last, now) => (r.id === 'a' ? now + 1_800_000 : now + 3_600_000 * 5),
    scheduleLabel: (r) => (r.schedule.everyMinutes ? `every ${r.schedule.everyMinutes} min` : 'daily'),
  });
  assert.deepEqual(columns.map((c) => c.id), ['queued', 'running', 'review', 'done']);
  const [queued, running, review, done] = columns;
  assert.deepEqual(queued.cards.map((c) => c.recipeId), ['a', 'c'], 'the disabled schedule is not queued; sooner first');
  assert.equal(queued.cards[0].meta, 'every 30 min · next in 30m');
  assert.deepEqual(running.cards.map((c) => [c.chatId, c.title]), [['c1', 'Fix the tests'], ['c9', 'A chat']]);
  assert.equal(review.cards[0].approvalId, 'p1');
  assert.equal(review.cards[0].title, 'Recipe a: run_command');
  assert.deepEqual(done.cards.map((c) => [c.recipeId, c.ok]), [['a', true], ['z', false]], 'newest first; an unknown recipe keeps its id');
  assert.equal(done.cards[1].meta, 'boom · 2h ago');
  assert.equal(done.cards[0].chatId, 'c1');
  assert.equal(runs.attention(columns), 1);
});

test('relative times read short, and Done is capped', () => {
  assert.equal(runs.relative(NOW + 90_000, NOW), 'in 2m');
  assert.equal(runs.relative(NOW - 30_000, NOW), '1m ago');
  assert.equal(runs.relative(NOW - 3 * 86_400_000, NOW), '3d ago');
  const many = {};
  for (let i = 0; i < 30; i += 1) many['r' + i] = { at: NOW - i * 1000, ok: true };
  const columns = runs.board({ now: NOW, runs: many });
  assert.equal(columns[3].cards.length, runs.MAX_DONE);
  assert.equal(columns[3].cards[0].recipeId, 'r0');
  assert.deepEqual(runs.board({}).map((c) => c.cards.length), [0, 0, 0, 0], 'nothing in, nothing out');
});

test('the screens wear it: the switch, the cards, the board', () => {
  const app = read('desktop', 'src', 'App.tsx');
  assert.match(app, /<SpaceSwitch destination="agents" active=\{view\} onNavigate=\{setView\} badge=\{\{ activity: approvals \}\} \/>/);
  const activity = read('desktop', 'src', 'screens', 'ActivityScreen.tsx');
  assert.match(activity, /<h1>Runs<\/h1>/);
  assert.match(activity, /runsLib\.board\(\{/);
  assert.match(activity, /className="runs-board"/);
  assert.match(activity, /freeai4u\.runs\.layout/, 'list or board is remembered');
  assert.match(activity, /recipesLib\.approvals\.answer\(card\.approvalId!, 'once'\)/, 'a Needs-review card answers in place');
  for (const screen of ['AgentsScreen', 'RecipesScreen']) {
    const src = read('desktop', 'src', 'screens', `${screen}.tsx`);
    assert.match(src, /className="ar-card-actions"/, `${screen} cards have hover actions`);
    assert.match(src, />Run<\/button>/);
    assert.match(src, />Duplicate<\/button>/);
    assert.match(src, /const duplicate = /);
  }
  assert.match(read('desktop', 'src', 'screens', 'RecipesScreen.tsx'), /enabled: false \} : undefined/, 'a duplicated recipe starts with its schedule off');
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.ar-card', '.ar-card-actions', '.runs-board', '.runs-col', '.runs-card', '.space-switch']) assert.ok(css.includes(sel + ' {'), `index.css has ${sel}`);
});
