// Settings (UI plan, phase 5): four groups instead of thirteen rows, a grid
// of cards, shortcuts as category cards that unfold, a Ctrl+/ cheat sheet on
// any screen, and no Mica row on Linux. settings-groups.js is pure; the
// .tsx pins keep the screen's shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const groups = require('../desktop/src/settings-groups.js');

test('four groups hold every section the screen renders, once each', () => {
  assert.deepEqual(groups.GROUPS.map((g) => g.id), ['general', 'ai', 'tools', 'system']);
  const settings = read('desktop', 'src', 'screens', 'SettingsScreen.tsx');
  const inline = [...settings.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  const cards = ['Connectors', 'Appearance', 'Shortcuts', 'Local models', 'Dictation', 'Startup and desktop', 'Desktop control', 'Diagnostics'];
  const all = new Set([...inline, ...cards]);
  const listed = groups.GROUPS.flatMap((g) => g.sections);
  assert.equal(new Set(listed).size, listed.length, 'no section in two groups');
  for (const title of all) assert.ok(listed.includes(title), `${title} has a group`);
  assert.equal(groups.groupOf('Something new'), 'system', 'an unknown card lands in System');
  assert.equal(groups.groupOf('Shortcuts'), 'general');
  assert.equal(groups.isWide('Local models'), true);
  assert.equal(groups.isWide('Appearance'), false);
});

test('counts and the group a search jumps to', () => {
  const c = groups.counts(['Engine', 'Providers', 'Appearance']);
  assert.deepEqual(c.map((g) => [g.id, g.count]), [['general', 1], ['ai', 2], ['tools', 0], ['system', 0]]);
  assert.equal(groups.groupForSearch(['Dictation', 'Appearance'], 'system'), 'general', 'the first group in nav order with a hit');
  assert.equal(groups.groupForSearch([], 'tools'), 'tools');
});

test('shortcuts sort into four categories; the unknown land in Tools', () => {
  const rows = [{ id: 'palette' }, { id: 'new-chat' }, { id: 'quick' }, { id: 'terminal' }, { id: 'nav' }, { id: 'mystery' }, { id: 'x', category: 'chat' }];
  const by = groups.categorise(rows);
  assert.deepEqual(by.navigation.map((r) => r.id), ['palette', 'nav']);
  assert.deepEqual(by.chat.map((r) => r.id), ['new-chat', 'x']);
  assert.deepEqual(by.global.map((r) => r.id), ['quick']);
  assert.deepEqual(by.tools.map((r) => r.id), ['terminal', 'mystery']);
  assert.equal(groups.categoryOf('cheatsheet'), 'navigation');
  assert.equal(groups.PEEK, 3);
});

test('the screen wears it: group nav, card grid, category cards, cheat sheet, no Mica on Linux', () => {
  const settings = read('desktop', 'src', 'screens', 'SettingsScreen.tsx');
  assert.match(settings, /groupsLib\.groupForSearch\(hits, group\)/);
  assert.match(settings, /classList\.toggle\('is-hit'/);
  assert.match(settings, /classList\.toggle\('is-wide'/);
  assert.match(settings, /freeai4u:cheat-sheet/);
  const card = read('desktop', 'src', 'components', 'ShortcutsCard.tsx');
  assert.match(card, /groupsLib\.categorise\(rows\)/);
  assert.match(card, /className="shortcut-cards"/);
  assert.match(card, /slice\(0, groupsLib\.PEEK\)/);
  assert.match(card, /export const COMPOSER_KEYS/);
  const sheet = read('desktop', 'src', 'components', 'CheatSheet.tsx');
  assert.match(sheet, /keymap\.withOverrides\(keymap\.readOverrides\(\)\)/, 'the sheet reads the live table');
  assert.match(read('shared', 'keymap.js'), /id: 'cheatsheet', keys: 'Ctrl\+\/', label: 'Keyboard cheat sheet', when: 'always'/);
  const app = read('desktop', 'src', 'App.tsx');
  assert.match(app, /case 'cheatsheet': setCheatOpen/);
  assert.match(app, /<CheatSheet open=\{cheatOpen\}/);
  assert.match(read('desktop', 'src', 'commands.js'), /id: 'cheat-sheet'/);
  const appearance = read('desktop', 'src', 'components', 'AppearanceCard.tsx');
  assert.match(appearance, /\{!isLinux\(\) && \(<>/, 'the Mica row is Windows-only');
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.settings-main', '.shortcut-cards', '.shortcut-card', '.cheat-sheet', '.cheat-sheet-grid']) assert.ok(css.includes(sel + ' {'), `index.css has ${sel}`);
  assert.match(css, /\.settings-main > \.settings-section\.is-wide \{ grid-column: 1 \/ -1; \}/);
});
