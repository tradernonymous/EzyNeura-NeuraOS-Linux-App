// The next three: a guided FLUX.2 setup (three steps with the one click each
// needs), a commit action in Chat's Changes panel, and recent projects pinned
// in the Code menu. flux-setup.js is pure; the rest is pinned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const setup = require('../desktop/src/flux-setup.js');

test('FLUX.2 setup: three steps, each done or naming its one click', () => {
  const none = setup.steps(null, null);
  assert.deepEqual(none.map((s) => [s.id, s.done, s.action]), [['server', false, 'pick-server'], ['model', false, 'get-model'], ['run', false, '']]);
  assert.equal(setup.next(none).id, 'server');
  const withServer = setup.steps({ found: true, binary: '/opt/sd/sd-server', model: '', models: [] }, { state: 'stopped' });
  assert.equal(withServer[0].done, true);
  assert.equal(withServer[0].detail, 'sd-server');
  assert.equal(setup.next(withServer).id, 'model');
  const onDisk = setup.steps({ found: true, binary: 'x', model: '/m/sd15.safetensors', models: [{ path: '/m/flux-2-klein-4b', name: 'flux-2-klein-4b (set of 3 files)' }] }, {});
  assert.equal(onDisk[1].action, 'pick-flux', 'a FLUX.2 set on disk is picked, not downloaded again');
  assert.equal(onDisk[1].pick, '/m/flux-2-klein-4b');
  const chosen = setup.steps({ found: true, binary: 'x', model: '/m/flux2-klein-4B', models: [] }, { state: 'stopped' });
  assert.equal(chosen[1].done, true);
  assert.equal(chosen[2].action, 'start');
  const running = setup.steps({ found: true, binary: 'x', model: '/m/FLUX.2-dev.gguf', models: [] }, { state: 'ready', base_url: 'http://127.0.0.1:1234' });
  assert.equal(running[2].done, true);
  assert.equal(setup.next(running), null, 'all three done');
  assert.equal(setup.steps({ found: true, model: 'x/klein', models: [] }, { state: 'starting' })[2].action, '', 'no Start while it loads');
  assert.equal(setup.isFlux2('Flux-2-Klein'), true);
  assert.equal(setup.isFlux2('sd15'), false);
  assert.equal(setup.DEFAULT_REPO, 'Comfy-Org/flux2-klein-4B');
});

test('the card draws the steps and the Get button looks the set up at once', () => {
  const card = read('desktop', 'src', 'components', 'LocalImagesCard.tsx');
  assert.match(card, /className="flux-steps"/);
  assert.match(card, /fluxSetup\.steps\(facts, status\)/);
  assert.match(card, /autoLookup=\{wantRepo\}/);
  assert.match(card, /setWantRepo\(fluxSetup\.DEFAULT_REPO\)/);
  assert.match(card, /autoLookup\?: string;/);
});

test('commit from the Changes panel: checked paths and message, commit itself never pushes', () => {
  const rust = read('desktop', 'src-tauri', 'src', 'git.rs');
  assert.match(rust, /pub fn local_git_commit\(/);
  assert.match(rust, /check_commit_paths\(&paths\)\?/);
  assert.match(rust, /check_commit_message\(&message\)\?/);
  assert.match(rust, /"commit", "-m", &text/);
  // E1 added a push BUTTON in the panel; local_git_commit itself still never
  // touches a remote — that is what this pin always meant.
  const at = rust.indexOf('pub fn local_git_commit(');
  const next = rust.indexOf('#[tauri::command', at + 1);
  assert.ok(!/"push"/.test(rust.slice(at, next < 0 ? undefined : next)), 'the commit command itself never pushes');
  assert.match(rust, /fn commit_paths_and_message_are_checked_before_git_runs/);
  assert.match(read('desktop', 'src-tauri', 'src', 'main.rs'), /git::local_git_commit/);
  assert.match(read('desktop', 'src', 'bridge.ts'), /export async function gitCommit\(/);
  const output = read('desktop', 'src', 'components', 'ChatOutput.tsx');
  assert.match(output, /gitCommit\(root, paths, message\)/);
  assert.match(output, /className="chat-output-commit"/);
  assert.match(output, /type="checkbox"/);
});

test('the Code menu pins the recent folders', () => {
  const nav = read('desktop', 'src', 'components', 'TopNav.tsx');
  assert.match(nav, /RECENT_IN_MENU = 5/);
  assert.match(nav, /shellLib\.readRecent\(\)\.slice\(0, RECENT_IN_MENU\)/);
  assert.match(nav, /Recent projects/);
  assert.match(nav, /freeai4u:open-project/);
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.flux-steps', '.flux-step', '.chat-output-commit', '.topnav-menu-head']) assert.ok(css.includes(sel + ' {'), `index.css has ${sel}`);
});

test('the Changes panel can be opened from a dirty git folder before any turn writes a file', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'screens', 'ChatScreen.tsx'), 'utf8');
  assert.match(src, /gitStatus\(root\)\.then\(\(g\) => \{ if \(live\) setGitDirty/, 'the chat screen reads git status for its folder');
  assert.match(src, /\(turnLib\.outputOf\(active\.messages\)\.any \|\| gitDirty > 0\)/, 'the toggle shows for git changes too');
  assert.match(src, /`Changes · \$\{gitDirty\}`/, 'and says how many files changed');
});
