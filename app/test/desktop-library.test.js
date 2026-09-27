// UI plan P8 (Agents -> Library): the screen's own "LIBRARY" header row and
// tall Refresh button are gone -- the tab bar above it (SpaceSwitch) already
// reads "Library", and Refresh moved there as an icon (item 31). A brand-new
// screen (nothing signed in, installed, indexed or saved) collapses five
// separate "nothing here" placeholders into one block holding the two real
// actions instead (item 28). "Installed manuals" and "Skills" -- two names
// for the same idea -- became one ("Installed skills", item 29), and its
// stray checkmark glyph is gone (item 30). Source-text pins, like the rest of
// this suite: there is no React renderer here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('Library dropped its own header row; Refresh lives in the tab bar instead', () => {
  const lib = read('desktop', 'src', 'screens', 'LibraryScreen.tsx');
  assert.doesNotMatch(lib, /<header className="screen-header">/, 'no more LIBRARY heading row');
  assert.doesNotMatch(lib, /<h1>Library<\/h1>/);
  assert.match(lib, /'freeai4u:library-refresh'/, 'listens for the tab bar\'s refresh icon');
  assert.match(lib, /window\.addEventListener\('freeai4u:library-refresh', onRefresh\)/);

  const app = read('desktop', 'src', 'App.tsx');
  assert.match(app, /const LIBRARY_REFRESH_EVENT = 'freeai4u:library-refresh';/);
  assert.match(app, /actions=\{view === 'library' \?/, 'the refresh icon only shows while Library is the open tab');
  assert.match(app, /window\.dispatchEvent\(new Event\(LIBRARY_REFRESH_EVENT\)\)/);

  const spaceSwitch = read('desktop', 'src', 'components', 'SpaceSwitch.tsx');
  assert.match(spaceSwitch, /actions\?: ReactNode/, 'SpaceSwitch takes an actions slot for the open tab\'s own controls');
  assert.match(spaceSwitch, /\{actions && <div className="space-switch-actions">\{actions\}<\/div>\}/);

  const css = read('desktop', 'src', 'index.css');
  assert.match(css, /\.space-switch-actions \{ margin-left: auto;/, 'the actions slot is pushed to the far right of the tab bar');
});

test('one empty state replaces five, on a genuinely empty first launch', () => {
  const lib = read('desktop', 'src', 'screens', 'LibraryScreen.tsx');
  assert.match(lib, /const nothingYet = !hfSignedIn && !hfCatalogLoading && !loading/);
  assert.match(lib, /hfCatalog\.length === 0 && ghCatalog\.length === 0/);
  assert.match(lib, /Object\.keys\(installed\)\.length === 0 && skills\.length === 0 && chats\.length === 0/);
  assert.match(lib, /className="library-empty"/);
  assert.match(lib, /Nothing set up yet — sign in to Hugging Face to browse models, or install skills from a GitHub repository\./);
  // The two real actions -- HfSignIn and the GitHub install field -- are each
  // defined once and reused by both the empty state and the normal layout,
  // not duplicated.
  assert.match(lib, /const hfSignInBlock = \(/);
  assert.match(lib, /const ghInstallField = \(/);
  assert.equal((lib.match(/\{ghInstallField\}/g) || []).length, 2, 'reused by the empty state and the Skills column, not copy-pasted');
  assert.equal((lib.match(/\{hfSignInBlock\}/g) || []).length, 2, 'reused by the empty state and the signed-out HF card');

  const css = read('desktop', 'src', 'index.css');
  assert.match(css, /\.library-empty \{/);
});

test('Installed manuals and Skills became one name, and the stray checkmark is gone', () => {
  const lib = read('desktop', 'src', 'screens', 'LibraryScreen.tsx');
  assert.doesNotMatch(lib, /<h3[^>]*>[^<]*Installed manuals/, 'the heading itself is renamed to match "Skills" elsewhere on the same screen');
  assert.match(lib, /<h3 className="col-title">Installed skills \(\{Object\.keys\(installed\)\.length\}\)<\/h3>/);
  assert.doesNotMatch(lib, /<Icon name="check" size=\{14\} \/> Installed/, 'the decorative checkmark next to the count is gone');
  // The per-row "Manual" button is a different, still-correct label (it opens
  // the readable SKILL.md page) and is untouched by the section rename.
  assert.match(lib, /> Manual\s*<\/button>/);
});

test('the Installed skills section no longer sits flush against the screen edge', () => {
  const css = read('desktop', 'src', 'index.css');
  assert.match(css, /\.library-installed \{ margin: 14px 16px 16px; \}/, 'same 16px the .hf-section card above it already uses');
});

test('hf-signin is one rule, not two fighting over flex-direction', () => {
  const css = read('desktop', 'src', 'index.css');
  const matches = css.match(/^\.hf-signin \{/gm) || [];
  assert.equal(matches.length, 1, 'a second .hf-signin rule used to silently keep flex-direction: column from an untouched earlier rule');
  assert.match(css, /\.hf-signin \{ display: flex; flex-direction: row;/, 'row is explicit now, immune to rule order');
});
