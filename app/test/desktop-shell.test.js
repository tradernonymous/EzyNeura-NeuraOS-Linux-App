// The app frame (UI plan, phase 1): the top bar with its menus, the project
// sidebar that groups history by folder, and no right rail. shell.js is pure,
// so the grouping and the storage cases run here without a DOM; the .tsx and
// .css pins keep the frame the way the plan drew it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const shell = require('../desktop/src/shell.js');

function memory(seed) {
  const map = new Map(Object.entries(seed || {}));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}
const chat = (id, at, project, title) => ({ id, title: title || id, messages: [], updatedAt: at, project });

test('every chat belongs to a folder, and history is read by folder', () => {
  const home = '/home/me/NeuraOS';
  const list = [
    chat('a', 5, '/src/app'), chat('b', 4, home), chat('c', 3, '/src/lib'), chat('d', 2), chat('e', 1, '/src/app'),
  ];
  const groups = shell.groups(list, { home });
  assert.deepEqual(groups.map((g) => g.key), ['project:/src/app', 'project:/src/lib', 'home']);
  assert.deepEqual(groups[0].items.map((s) => s.id), ['a', 'e'], 'newest first inside a folder');
  assert.equal(groups[0].title, 'app');
  // A chat with no folder and a chat in the home folder are the same group, last.
  assert.deepEqual(groups[2].items.map((s) => s.id), ['b', 'd']);
  assert.equal(groups[2].title, shell.HOME_LABEL);
  assert.equal(groups[2].path, '');
});

test('pinned chats come first, and the filters narrow the list', () => {
  const list = [chat('a', 3, '/p'), chat('b', 2, '/p'), chat('c', 1)];
  const busy = new Set(['b']);
  const all = shell.groups(list, { pinned: ['c'], busy });
  assert.equal(all[0].key, 'pinned');
  assert.deepEqual(all[0].items.map((s) => s.id), ['c']);
  assert.deepEqual(all[1].items.map((s) => s.id), ['a', 'b'], 'a pinned chat appears once');
  assert.equal(all[1].running, true);
  const running = shell.groups(list, { pinned: ['c'], busy, filter: 'running' });
  assert.deepEqual(running.map((g) => g.items.map((s) => s.id)), [['b']]);
  const pinned = shell.groups(list, { pinned: ['c'], busy, filter: 'pinned' });
  assert.deepEqual(pinned.map((g) => [g.key, g.items.map((s) => s.id)]), [['home', ['c']]]);
  assert.deepEqual(shell.groups(list, { query: 'zzz' }), []);
  assert.equal(shell.statusOf(list[1], busy), 'running');
  assert.equal(shell.statusOf(list[0], busy, new Set(['a'])), 'needs-you');
  assert.equal(shell.statusOf(list[0], busy), 'idle');
});

test('a folder is named by its last segment on either slash; home has a label', () => {
  assert.equal(shell.projectName('/home/me/src/neuraos/'), 'neuraos');
  assert.equal(shell.projectName('C:\\Users\\me\\repo'), 'repo');
  assert.equal(shell.projectName(''), shell.HOME_LABEL);
  assert.equal(shell.projectName(undefined), shell.HOME_LABEL);
  assert.equal(shell.cleanProject('  /a/b '), '/a/b');
  assert.equal(shell.cleanProject(42), '');
  assert.equal(shell.cleanProject('x'.repeat(2000)), '', 'a path that cannot be real is nothing');
});

test('the sidebar and the recent folders survive damaged storage', () => {
  const store = memory({ [shell.SIDEBAR_KEY]: '{"json":true}', [shell.RECENT_KEY]: '{"not":"a list"}', [shell.FOLDED_KEY]: '[1, "a"]' });
  assert.equal(shell.readHidden(store), false, 'anything but "1" shows the sidebar');
  assert.deepEqual(shell.readRecent(store), []);
  assert.deepEqual(shell.readFolded(store), ['a']);
  shell.writeHidden(true, store);
  assert.equal(shell.readHidden(store), true);
  const throwing = { getItem() { throw new Error('private window'); }, setItem() { throw new Error('private window'); } };
  assert.equal(shell.readHidden(throwing), false);
  assert.deepEqual(shell.readRecent(throwing), []);
  assert.doesNotThrow(() => shell.writeHidden(true, throwing));
  assert.doesNotThrow(() => shell.writeRecent(['/a'], throwing));
});

test('recent folders: newest first, once each, capped', () => {
  let list = [];
  for (let i = 0; i < 12; i += 1) list = shell.remember(list, `/p${i}`);
  assert.equal(list.length, shell.MAX_RECENT);
  assert.equal(list[0], '/p11');
  assert.deepEqual(shell.remember(['/a', '/b', '/c'], '/b'), ['/b', '/a', '/c']);
  assert.deepEqual(shell.remember(['/a'], ''), ['/a'], 'the home pick is not a folder to remember');
  const store = memory();
  shell.writeRecent(['/x', '/y'], store);
  assert.deepEqual(shell.readRecent(store), ['/x', '/y']);
  assert.deepEqual(shell.knownProjects([chat('a', 2, '/y'), chat('b', 1, '/z'), chat('c', 3, '/home')], ['/x', '/y'], '/home'), ['/x', '/y', '/z']);
  assert.deepEqual(shell.toggleFolded(['a'], 'a'), []);
  assert.deepEqual(shell.toggleFolded(['a'], 'b'), ['a', 'b']);
});

// ---- the frame ---------------------------------------------------------------

test('the top bar has four destinations with menus, and the right rail is gone', () => {
  const sidebar = read('desktop', 'src', 'Sidebar.tsx');
  const ids = [...sidebar.matchAll(/\{ id: '(\w+)', label: '[^']+', icon: '\w+', keys: 'Alt\+(\d)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ids, [['chat', '1'], ['code', '2'], ['create', '3'], ['agents', '4']]);
  // Activity lives under Agents now; nothing is lost, it is a tab.
  assert.match(sidebar, /id: 'activity', label: 'Runs', parent: 'agents'/);
  assert.match(sidebar, /id: 'evals', label: 'Evals', parent: 'agents'/);
  const nav = read('desktop', 'src', 'components', 'TopNav.tsx');
  assert.match(nav, /HOVER_DELAY_MS = 150/);
  assert.match(nav, /pointerType === 'mouse'/, 'hover opens only for a mouse; touch and keyboard click or arrow down');
  assert.match(nav, /e\.key === 'ArrowDown'/);
  assert.match(nav, /role="menubar"/);
  const app = read('desktop', 'src', 'App.tsx');
  assert.ok(!/Workbench/.test(app), 'no right rail');
  assert.ok(!/right-panel/.test(app), 'no docked builds/knowledge panel');
  assert.ok(!/sub-nav/.test(app), 'the tab strip is the menu now');
  assert.match(app, /<TopNav/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'desktop', 'src', 'components', 'Workbench.tsx')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'desktop', 'src', 'workbench.js')));
  const css = read('desktop', 'src', 'index.css');
  assert.ok(!/\.workbench\b/.test(css), 'no workbench rules left');
  assert.ok(!/data-pinned/.test(css), 'no peeking rails left');
  assert.match(css, /\.raised\s*\{/);
  assert.match(css, /\.deck\s*\{/);
  assert.match(css, /\.topnav-menu\s*\{/);
});

test('a new chat starts in a folder, and the chat on screen sets the working folder', () => {
  const app = read('desktop', 'src', 'App.tsx');
  assert.match(app, /<ProjectPicker/);
  assert.match(app, /projectHome\(\)/);
  assert.match(app, /NEW_CHAT_EVENT, \{ detail: \{ project: clean \} \}/);
  assert.match(app, /ACTIVE_CHAT_EVENT/);
  const chatScreen = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.match(chatScreen, /project\?: string;/);
  assert.match(chatScreen, /newSession\(provider = '', model = '', project = ''\)/);
  const keymap = read('shared', 'keymap.js');
  assert.match(keymap, /id: 'sidebar', keys: 'Ctrl\+B'/);
  const rust = read('desktop', 'src-tauri', 'src', 'local.rs');
  assert.match(rust, /pub fn local_project_home/);
  assert.match(rust, /home\.join\("NeuraOS"\)/);
  assert.match(read('desktop', 'src-tauri', 'src', 'main.rs'), /local::local_project_home/);
});
