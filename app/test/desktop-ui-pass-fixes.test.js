// The bug pass over docs/UI_UPGRADE_PLAN.md P1–P8 (BACKLOG, 2026-09-27):
// what a screenshot tour of a debug build and a static review found, pinned
// so the same regressions cannot come back quietly. Source-text pins, like
// the rest of this suite: there is no React renderer here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('the icon-and-label row layout is scoped to buttons that start with an icon', () => {
  const css = read('desktop', 'src', 'index.css');
  // The bare `button` rule carries none of the trio: put there (P1 item 7)
  // it turned every column button -- the Settings rail's group name over
  // its hint, Create's sketch over a title, a Library skill card -- into
  // one centred, non-wrapping row, and shrank the top bar's sidebar
  // toggle (three empty bars in a column) to nothing at all.
  const base = css.match(/\nbutton \{([^}]*)\}/);
  assert.ok(base, 'index.css has a bare button rule');
  for (const prop of ['align-items', 'justify-content', 'white-space', 'display']) {
    assert.ok(!base[1].includes(prop + ':'), `the bare button rule does not set ${prop}`);
  }
  const scoped = css.match(/\nbutton:where\(:has\(> svg\)\) \{([^}]*)\}/);
  assert.ok(scoped, 'the trio lives on button:where(:has(> svg)) instead');
  for (const decl of ['display: inline-flex', 'align-items: center', 'white-space: nowrap', 'gap: 6px']) {
    assert.ok(scoped[1].includes(decl), `the scoped rule keeps ${decl}`);
  }
});

test('the sidebar toggle shows only where the sidebar can, and Ctrl+B elsewhere goes to Chat', () => {
  const nav = read('desktop', 'src', 'components', 'TopNav.tsx');
  assert.match(nav, /\{current === 'chat' && \(\s*<button type="button" className="topnav-burger"/, 'the burger renders only in Chat');
  const app = read('desktop', 'src', 'App.tsx');
  assert.match(app, /const toggleSidebar = useCallback\(\(\) => \{[\s\S]{0,700}if \(destinationOf\(viewRef\.current\) !== 'chat'\) \{\s*navigate\('chat'\);\s*setSidebarHidden\(false\);\s*shellLib\.writeHidden\(false\);\s*return;/, 'from another space the toggle opens Chat with the list shown instead of flipping a hidden state nobody can see');
  assert.match(app, /!sidebarHidden && destinationOf\(view\) === 'chat' && \(/, 'the sidebar itself is still Chat-only');
});

test('a user bubble sits on the centred column, and the rewind is off its text', () => {
  const css = read('desktop', 'src', 'index.css');
  assert.match(css, /\.message\.user \{[^}]*margin-right: max\(0px, calc\(\(100% - var\(--workspace-max\)\) \/ 2\)\);/, 'the right margin is the column\'s own side gap, not the pane\'s edge');
  assert.match(css, /\.message-rewind \{\s*position: absolute;[^}]*top: -8px;\s*right: -8px;/, 'the rewind sits at the bubble\'s corner now that the "You" line above it is gone');
});

test('the image-setup stepper lets its buttons drop under the text on a narrow column', () => {
  const css = read('desktop', 'src', 'index.css');
  assert.match(css, /\.flux-step \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.flux-step-actions \{[^}]*flex: 0 1 auto; min-width: 0; margin-left: auto; \}/);
  assert.match(css, /\.flux-step-body \{ flex: 1 1 180px; min-width: 0;/);
});

test('Library judges its first-launch empty state once loaded, never over an engine error', () => {
  const lib = read('desktop', 'src', 'screens', 'LibraryScreen.tsx');
  assert.match(lib, /const \[loadedOnce, setLoadedOnce\] = useState\(false\)/);
  assert.match(lib, /void Promise\.allSettled\(\[engine, hub\]\)\.then\(\(\) => setLoadedOnce\(true\)\)/, 'set once both halves of load() settle');
  assert.match(lib, /const nothingYet = loadedOnce && !hfSignedIn && !error/);
  assert.match(lib, /useState<ChatSession\[\]>\(\(\) => chatStore\.byRecency\(chatStore\.readStore\(\)\) as ChatSession\[\]\)/, 'saved chats are read for the first paint');
  assert.match(lib, /useState\(\(\) => hfAuth\.signedIn\(\)\)/, 'the sign-in state is read for the first paint');
});

test('the run-app skill names a tauri flag this CLI accepts', () => {
  const skill = read('..', '.claude', 'skills', 'run-app', 'SKILL.md');
  assert.match(skill, /npx tauri build --debug --no-bundle/);
  assert.doesNotMatch(skill, /--bundles none/, '"none" is not a bundle the CLI knows; the build stopped at the flag');
});
