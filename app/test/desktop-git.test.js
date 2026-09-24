// Git in the shell (suggestions 2 and 4): a clone from the new-chat picker
// into the home folder, the branch and changed count on the Code chip, and
// the Changes panel reading git status with a diff per file. The parsing
// and the URL check are Rust unit tests (git.rs); this pins the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('three read-mostly git commands, registered, with the URL checked before git sees it', () => {
  const rust = read('desktop', 'src-tauri', 'src', 'git.rs');
  for (const fn of ['local_git_status', 'local_git_diff', 'local_git_clone']) {
    assert.match(rust, new RegExp(`pub fn ${fn}\\(`));
    assert.match(read('desktop', 'src-tauri', 'src', 'main.rs'), new RegExp(`git::${fn}`));
  }
  assert.match(rust, /GIT_TERMINAL_PROMPT", "0"/, 'a clone never hangs on a hidden prompt');
  assert.match(rust, /check_clone_url\(&url\)\?/, 'the URL is checked first');
  assert.match(rust, /\.arg\("clone"\)\s*\.arg\("--"\)/, 'the URL can never be read as an option');
  assert.match(rust, /fn a_clone_url_is_https_or_a_known_ssh_host_and_never_an_option/);
  assert.match(rust, /fn porcelain_status_reads_the_branch_the_counts_and_every_kind_of_change/);
  const bridge = read('desktop', 'src', 'bridge.ts');
  for (const fn of ['gitStatus', 'gitDiff', 'gitClone']) assert.match(bridge, new RegExp(`export async function ${fn}\\(`));
});

test('the picker clones into the home folder; the chip and the panel read git', () => {
  const picker = read('desktop', 'src', 'components', 'ProjectPicker.tsx');
  assert.match(picker, /Clone a repository…/);
  assert.match(picker, /onClone\?: \(url: string\) => Promise<string>/);
  const app = read('desktop', 'src', 'App.tsx');
  assert.match(app, /gitClone\(url, home\)/, 'clones land under ~/NeuraOS');
  const code = read('desktop', 'src', 'screens', 'CodeScreen.tsx');
  assert.match(code, /gitStatus\(localRoot\)/);
  const output = read('desktop', 'src', 'components', 'ChatOutput.tsx');
  assert.match(output, /gitStatus\(root\)/);
  assert.match(output, /gitDiff\(root, picked\)/);
  assert.match(output, /<DiffView text=\{diff\}/);
  assert.match(read('desktop', 'src', 'screens', 'ChatScreen.tsx'), /root=\{openFolder\(\)\}/);
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.code-project-changed', '.chat-output-diff', '.project-clone']) assert.ok(css.includes(sel + ' {'), `index.css has ${sel}`);
});
