// Build configuration and shell metadata: the things that are correct in
// exactly one place, never read at runtime, and rot silently.
//
// None of this is visible in the app. A wrong <title> shows in the window
// manager and the taskbar. A wrong package description shows in npm metadata
// nobody reads. A window effect configured for a platform that has no such
// concept looks live in review and does nothing forever. And a CSP that is
// too tight breaks at runtime in a way that is hard to trace back to the
// policy line -- so the tests here are as much about *why a directive is
// present* as about its presence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DESKTOP = path.join(ROOT, 'desktop');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const CONF = JSON.parse(read('desktop', 'src-tauri', 'tauri.conf.json'));
const PKG = JSON.parse(read('desktop', 'package.json'));
const HTML = read('desktop', 'index.html');

/** Every source file, as text, for "is this feature still used" questions. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(DESKTOP, 'src'));
  return out;
}

const ALL_SRC = sourceFiles().map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// ---- names the user actually sees ----------------------------------------

test('the window title is the product, not the old codename', () => {
  const title = HTML.match(/<title>([^<]*)<\/title>/);
  assert.ok(title, 'index.html needs a <title>');
  assert.equal(title[1], 'NeuraOS', 'the window title should be the product name');
  // FreeAI4U is the old project name. It survives in localStorage keys on
  // purpose (renaming those would strand every user's chats), but nothing the
  // user reads should still say it.
  assert.doesNotMatch(title[1], /freeai4u/i, 'the title must not use the old codename');
});

test('the title bar in the shell config agrees with the document title', () => {
  assert.equal(
    CONF.app.windows[0].title,
    'NeuraOS',
    'tauri.conf.json and index.html must name the window the same thing',
  );
});

test('the package description is not platform-locked', () => {
  // It said "native Windows app", which was true when the app was Windows-only
  // and stopped being true at the Linux port. It is npm metadata, so nothing
  // ever surfaced the contradiction.
  assert.doesNotMatch(
    PKG.description,
    /windows/i,
    'the description must not claim a single platform',
  );
  // And it should say something true. The bundler's own longDescription does.
  assert.ok(
    PKG.description.length > 40,
    'the description should actually describe the app',
  );
});

test('the description matches what the bundler ships', () => {
  assert.equal(
    PKG.description,
    CONF.bundle.longDescription,
    'npm metadata and installer metadata should not drift apart',
  );
});

// ---- window effects -------------------------------------------------------

test('no window effect is configured that this platform cannot honour', () => {
  // tauri.conf.json asked for Mica. Mica is a Windows 11 / DWM concept:
  // tauri-2.12.1/src/vibrancy/mod.rs compiles a `windows` and a `macos`
  // module and calls one of them under #[cfg] -- on Linux neither arm exists,
  // so set_window_effects does nothing at all. The config read as if the
  // window were translucent and was inert on every platform but Windows.
  for (const w of CONF.app.windows) {
    assert.equal(
      w.windowEffects,
      undefined,
      'windowEffects is not applied on Linux; the shell keeps its own flat background',
    );
  }
});

test('the shell still answers whether Mica is available, without asking the config', () => {
  // The runtime detection is the part that is real, and it is how the frontend
  // decides to go translucent. Removing the config must not have removed this:
  // the CSS still has a [data-material="mica"] path, and it needs a signal.
  const main = read('desktop', 'src-tauri', 'src', 'main.rs');
  assert.match(main, /fn window_has_mica\(\) -> bool/, 'the command must remain');
  assert.match(main, /window_has_mica,/, 'it must stay registered');
  // Two mica modules: the real one under #[cfg(windows)], and a stub under
  // #[cfg(not(windows))] that answers a hard false. The stub is what makes
  // this a signal rather than a guess -- without it the Linux build would not
  // compile at all, and the alternative (probing and inferring) is worse.
  assert.match(main, /#\[cfg\(windows\)\]\s*\nmod mica \{/, 'the real mica module is Windows-only');
  assert.match(
    main,
    /#\[cfg\(not\(windows\)\)\]\s*\nmod mica \{\s*\n\s*pub fn supported\(\) -> bool \{\s*\n\s*false\s*\n\s*\}/,
    'every other platform answers a hard false',
  );
  const theme = read('desktop', 'src', 'theme.ts');
  assert.match(theme, /export function applyMaterial/, 'the frontend still gates translucency on it');
});

// ---- the content security policy -----------------------------------------

test('the CSP keeps script-src unsafe-inline, because srcdoc frames need it', () => {
  // This is the directive most likely to be "cleaned up", and removing it
  // breaks the Design studio and research printing.
  //
  // A srcdoc iframe inherits its embedder's CSP. Three places write an inline
  // <script> into one: design/artifact.js appends the host script that powers
  // tweaks, hover states and pins; DesignScreen appends an auto-print script;
  // research.js does the same for a printed research answer. Without
  // 'unsafe-inline' in script-src all three are blocked and the features fail
  // silently -- a preview that stops responding, a page that never prints.
  const csp = CONF.app.security.csp;
  assert.match(csp, /script-src[^;]*'unsafe-inline'/, 'script-src must allow the srcdoc host scripts');

  // Prove the feature is still there, so this test fails if the scripts are
  // ever removed and the directive can then be tightened for real.
  const artifact = read('desktop', 'src', 'design', 'artifact.js');
  assert.match(
    artifact,
    /'<script id="' \+ HOST_MARK \+ '">'/,
    'the artifact host script is still injected inline',
  );
  assert.match(
    read('desktop', 'src', 'screens', 'DesignScreen.tsx'),
    /frame\.srcdoc = `\$\{artifact\.strip/,
    'DesignScreen still writes into a srcdoc frame',
  );
  assert.match(read('desktop', 'src', 'research.js'), /autoPrint \? '<script>/, 'research printing still uses an inline script');
});

test('the CSP keeps style-src unsafe-inline, because the app styles attributes inline', () => {
  // 42 `style={{...}}` attributes across the tree -- tree indentation depth,
  // frame heights, accent hue. Moving them all to classes is a large refactor
  // for a directive that costs nothing here, since the real risk (remote
  // script) is covered by script-src.
  const count = (ALL_SRC.match(/style=\{\{/g) || []).length;
  assert.ok(count > 0, 'inline style attributes exist');
  assert.match(
    CONF.app.security.csp,
    /style-src[^;]*'unsafe-inline'/,
    `${count} inline style attributes depend on this directive`,
  );
});

test('the CSP still denies the dangerous things', () => {
  const csp = CONF.app.security.csp;
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]) {
    assert.ok(csp.includes(directive), `CSP should keep ${directive}`);
  }
  // eval is not needed: nothing in the tree uses eval or new Function, and a
  // policy that permits it would be a much wider hole than unsafe-inline.
  assert.doesNotMatch(csp, /'unsafe-eval'/, 'no eval is needed and none should be permitted');
  assert.doesNotMatch(ALL_SRC, /\beval\(|new Function\(/, 'nothing should be using eval');
});
