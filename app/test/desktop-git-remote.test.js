// E1/E2 (upgrade plan): push and pull from the Changes panel with the
// remote's host checked first, amend/unstage on the same panel, and discard
// behind a two-click confirm. The parsing and URL checks are Rust unit tests
// in git.rs; these pins keep the wiring honest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const rust = () => read('desktop', 'src-tauri', 'src', 'git.rs');
const bridge = () => read('desktop', 'src', 'bridge.ts');
const output = () => read('desktop', 'src', 'components', 'ChatOutput.tsx');

/** The body of one function: from its `pub fn` to the next top-level item. */
const fnBody = (src, name) => {
  const at = src.indexOf(`pub fn ${name}(`);
  assert.ok(at >= 0, `${name} exists`);
  const rest = src.slice(at + 1);
  const next = rest.search(/\n#\[tauri::command|\npub fn |\nfn |\n#\[derive/);
  return next < 0 ? rest : rest.slice(0, next);
};

test('five git commands exist, are registered, and check the remote first', () => {
  for (const fn of ['local_git_push', 'local_git_pull', 'local_git_amend', 'local_git_unstage', 'local_git_discard']) {
    assert.match(rust(), new RegExp(`pub fn ${fn}\\(`));
    assert.match(read('desktop', 'src-tauri', 'src', 'main.rs'), new RegExp(`git::${fn}`));
  }
  const push = fnBody(rust(), 'local_git_push');
  assert.match(push, /check_remote_url\(&url\)\?/, 'push checks the remote URL before git runs');
  assert.match(push, /rev-parse.*@\{upstream\}/s, 'push knows whether the branch has an upstream');
  assert.match(push, /push\", \"-u\"/, 'a branch with no upstream gets one');
  const pull = fnBody(rust(), 'local_git_pull');
  assert.match(pull, /check_remote_url\(&url\)\?/, 'pull checks the remote URL before git runs');
  assert.match(pull, /--ff-only/, 'pull never merges behind the person');
  assert.match(pull, /pull_error/, 'a failure is said in this app’s words');
});

test('the remote URL check is the clone check, plus local paths; the host is pure', () => {
  const src = rust();
  assert.match(src, /pub fn check_remote_url\(url: &str\)/);
  assert.match(src, /pub fn remote_host\(url: &str\)/);
  assert.match(src, /check_clone_url\(u\)/, 'the same rules as a clone');
  // The Rust unit tests that walk it (they run in CI):
  for (const name of [
    'fn a_remote_url_is_checked_before_anything_touches_the_network',
    'fn staged_and_unborn_are_read_from_the_porcelain_line',
    'fn push_and_pull_failures_are_said_in_this_app_s_words',
  ]) assert.match(src, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `git.rs has ${name}`);
});

test('the panel shows staged state, and the bridge carries every action', () => {
  const b = bridge();
  for (const fn of ['gitPush', 'gitPull', 'gitAmend', 'gitUnstage', 'gitDiscard']) {
    assert.match(b, new RegExp(`export async function ${fn}\\(`), `bridge exports ${fn}`);
  }
  assert.match(b, /staged: boolean/, 'GitChange says whether a change is in the index');
  assert.match(b, /remote: string/, 'GitStatus carries the remote URL');
  assert.match(b, /head: boolean/, 'GitStatus says whether there is a commit to amend');
  assert.match(b, /interface GitSynced \{ remote: string; host: string; ahead: number; behind: number; message: string; \}/);
});

test('the panel pulls, pushes, amends, unstages — and discards in two clicks', () => {
  const src = output();
  assert.match(src, /gitPull\(root\)/);
  assert.match(src, /gitPush\(root\)/);
  assert.match(src, /gitAmend\(root, paths, message\)/);
  assert.match(src, /gitUnstage\(root, paths\)/);
  assert.match(src, /gitDiscard\(root, \[path\]\)/);
  assert.match(src, /hostOf\(git!\.remote\)/, 'the button names the host it talks to');
  assert.match(src, /new URL\(/, 'the remote URL is parsed, not sliced');
  assert.match(src, /discardAsk !== path/, 'the first click only arms');
  assert.match(src, /'sure\?'/, 'the armed button says what the next click does');
  assert.match(src, /Amend the last commit/);
  assert.match(src, /gitRows\.length > 0 \|\| git!\.ahead > 0/, 'the panel stays open while there is something to push');
  assert.match(src, /c\.staged/, 'staged rows are marked');
});

test('the chat screen counts unpushed commits as reachable panel state', () => {
  assert.match(read('desktop', 'src', 'screens', 'ChatScreen.tsx'), /g\.changes\.length \+ g\.ahead/);
});

test('the new rows have styles', () => {
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.chat-output-sync', '.chat-output-remote', '.change-mini', '.change-danger', '.change-unstage-all', '.chat-output-amend']) {
    assert.ok(css.includes(sel), `index.css mentions ${sel}`);
  }
  assert.match(css, /\.chat-output-sync button \{/, 'the pull/push buttons are styled');
  assert.match(css, /\.chat-output-changes \.change-mini \{/, 'mini buttons win over the row reset');
});
