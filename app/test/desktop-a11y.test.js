// Structural accessibility: landmarks, live regions, and the ARIA a keyboard
// or screen-reader user depends on.
//
// Why this is a source test and not a rendered one. Every claim below is about
// markup that tsc is happy with and that looks correct in a screenshot. A
// nested <main>, a live region that never updates, an aria-activedescendant
// pointing at an id that does not exist -- all of these compile, all of these
// look right, and all of them are invisible to a sighted reviewer. The only
// way to pin them without a DOM-testing dependency is to read the source,
// which is what desktop-look.test.js already does for the stylesheet.
//
// What is pinned is the *contract*, not the exact wording of the markup:
//  - one main landmark per window, and it is App's, since every screen renders
//    inside it (a nested <main> is invalid and splits the landmark);
//  - the chat transcript is a log, and a completed answer reaches a polite
//    live region -- the streamed answer was previously announced to nobody;
//  - the command palette's cursor is exposed, so arrowing through it moves a
//    real screen-reader position rather than only a CSS class;
//  - the visually-hidden helper actually stays in the accessibility tree.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'desktop', 'src');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const CSS = read('desktop', 'src', 'index.css');
const APP = read('desktop', 'src', 'App.tsx');
const MAIN = read('desktop', 'src', 'main.tsx');
const CHAT = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
const PALETTE = read('desktop', 'src', 'components', 'CommandPalette.tsx');
const TITLEBAR = read('desktop', 'src', 'TitleBar.tsx');

/** Every .tsx under src, so a landmark added anywhere is caught. */
function tsxFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// Strip JSX comments so a `<main>` mentioned in a comment is not counted.
function stripComments(source) {
  return source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

// ---- landmarks ------------------------------------------------------------

test('a skip link reaches the main landmark, and only the main landmark', () => {
  assert.match(APP, /<a className="skip-link" href="#main-content">/, 'App needs a skip link');
  // The href must resolve to a real id, or the link moves focus nowhere --
  // which looks like a working affordance and is not one.
  assert.match(APP, /<main className="main" id="main-content"/, '#main-content must exist on the main');
  // tabIndex={-1} makes the landmark focusable programmatically. Without it the
  // browser moves the scroll but focus stays in the skip link, so the next Tab
  // continues from the top of the document and the skip accomplished nothing.
  assert.match(APP, /<main className="main" id="main-content" tabIndex=\{-1\}>/, 'the main landmark must be focusable');
});

test('every mounted root gets a skip link, not just the main window', () => {
  // main.tsx mounts three roots: the app, the quick-ask window and the crash
  // screen. A skip link added only to App leaves the quick-ask window without
  // one, and that window is entirely a form.
  assert.match(MAIN, /import App from '\.\/App'/, 'main.tsx mounts App');
  assert.match(MAIN, /import QuickAsk from '\.\/screens\/QuickAsk'/, 'main.tsx mounts QuickAsk too');
  const quick = read('desktop', 'src', 'screens', 'QuickAsk.tsx');
  assert.match(quick, /<main\b/, 'QuickAsk needs a main landmark for a skip link to target');
  assert.match(
    quick,
    /<a className="skip-link" href="#([\w-]+)">/,
    'QuickAsk needs its own skip link',
  );
  // The target has to exist in the same document, or the link is decoration.
  const target = quick.match(/<a className="skip-link" href="#([\w-]+)">/)[1];
  assert.ok(
    quick.includes(`id="${target}"`),
    `QuickAsk's skip link points at #${target}, which does not exist`,
  );
  // And the target must be focusable, for the same reason App's main is.
  const at = quick.indexOf(`id="${target}"`);
  const tag = quick.slice(quick.lastIndexOf('<', at), quick.indexOf('>', at));
  assert.match(tag, /tabIndex=\{-1\}/, `#${target} must be focusable, or the skip moves focus nowhere`);
});

test('the skip link is hidden until focused, without leaving the tab order', () => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = bare.indexOf('.skip-link {');
  assert.ok(at >= 0, 'index.css must style .skip-link');
  const rule = bare.slice(at, bare.indexOf('}', at));
  assert.doesNotMatch(rule, /display:\s*none/, 'display:none would drop it from the tab order entirely');
  assert.doesNotMatch(rule, /visibility:\s*hidden/, 'visibility:hidden would too');
  assert.match(rule, /transform:\s*translateY\(-200%\)/, 'it should start off-screen, not absent');
  // And it must come back when focused, or the affordance is a trap.
  const focusAt = bare.indexOf('.skip-link:focus-visible');
  assert.ok(focusAt > 0, '.skip-link needs a :focus-visible rule');
  const focusRule = bare.slice(focusAt, bare.indexOf('}', focusAt));
  assert.match(focusRule, /transform:\s*translateY\(0\)/, 'focusing must bring the link into view');
  assert.match(focusRule, /outline:/, 'the link needs its own focus ring, since it is the first thing focused');
});

// main.tsx renders exactly one of App or QuickAsk -- they are alternative roots
// for alternative windows, chosen by isQuickWindow(). So "one main per window"
// means one main per root, and each root must hold its own.
const ROOTS = ['App.tsx', path.join('screens', 'QuickAsk.tsx')];

test('each window root holds exactly one main landmark', () => {
  const owners = [];
  for (const file of tsxFiles()) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const opens = source.match(/<main[\s>]/g) || [];
    if (opens.length) owners.push([path.relative(SRC, file), opens.length]);
  }
  assert.deepEqual(
    owners.map(([file]) => file).sort(),
    [...ROOTS].sort(),
    'the only <main> elements should be the two window roots. Found: ' + JSON.stringify(owners),
  );
  // A second <main> anywhere is a nesting bug; <main> may not be nested, and
  // nested landmarks split the document for anyone navigating by them.
  for (const [file, count] of owners) {
    assert.equal(count, 1, `${file} has ${count} <main> elements`);
  }
});

test('App and QuickAsk are alternative roots, never rendered together', () => {
  // This is what makes the one-main-per-root rule sound. If a future change
  // mounted both, App's <main> would nest inside QuickAsk's and the invariant
  // would quietly stop meaning anything.
  assert.match(
    MAIN,
    /isQuickWindow\(\)\s*\?\s*<QuickAsk \/>\s*:\s*<App \/>/,
    'the root chooses one of the two windows',
  );
});

test('the screens that used to nest a <main> are labelled sections', () => {
  // A <section> with no accessible name is worse than a div: it shows up in
  // the landmark list as an unnamed region. Each one therefore carries a label.
  const expected = [
    ['screens/BuildScreen.tsx', 'build-main', 'Build detail'],
    ['screens/SettingsScreen.tsx', 'settings-main', 'Settings groups'],
    ['screens/DesignScreen.tsx', 'studio-centre', 'Design canvas'],
  ];
  for (const [file, className, label] of expected) {
    const source = stripComments(read('desktop', 'src', file));
    const at = source.indexOf(`className="${className}"`);
    assert.ok(at >= 0, `${file} still has .${className}`);
    const open = source.lastIndexOf('<', at);
    const tag = source.slice(open, source.indexOf('>', at) + 1);
    assert.match(tag, /^<section\b/, `${file}: .${className} should be a <section>, got ${tag.slice(0, 40)}`);
    assert.ok(
      tag.includes(`aria-label="${label}"`),
      `${file}: .${className} needs aria-label="${label}" so it is not an unnamed region`,
    );
  }
});

// ---- the visually-hidden helper ------------------------------------------

test('.sr-only stays in the accessibility tree', () => {
  // Comments are stripped first: a comment that names .sr-only (as the
  // skip-link rule's does, explaining why it is not .sr-only) would otherwise
  // be found first and the slice below would read the wrong rule entirely.
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = bare.indexOf('.sr-only');
  assert.ok(at >= 0, 'index.css must define .sr-only');
  const rule = bare.slice(at, bare.indexOf('}', at));
  // display:none and visibility:hidden both remove the element from the a11y
  // tree, which defeats the entire purpose of the class.
  assert.doesNotMatch(rule, /display:\s*none/, '.sr-only must not use display:none');
  assert.doesNotMatch(rule, /visibility:\s*hidden/, '.sr-only must not use visibility:hidden');
  // The clip that actually does the hiding.
  assert.match(rule, /clip-path:\s*inset\(50%\)|clip:\s*rect\(/, '.sr-only must clip itself');
  assert.match(rule, /position:\s*absolute/, '.sr-only must be taken out of flow');
  assert.match(rule, /width:\s*1px/, '.sr-only must be collapsed to 1px');
});

// ---- the chat transcript --------------------------------------------------

test('the transcript is a navigable log that does not re-announce history', () => {
  const scroller = CHAT.slice(CHAT.indexOf('className="chat-messages"'));
  const open = scroller.slice(0, scroller.indexOf('>'));
  assert.match(open, /role="log"/, '.chat-messages should be role="log"');
  assert.match(open, /aria-label="[^"]+"/, '.chat-messages needs a name');
  // role="log" implies aria-live="polite". Chat also streams token by token, so
  // an inherited polite region over the scroller would flood the speech queue
  // with partial words. Turning it off is what makes the log navigable-but-quiet.
  assert.match(
    open,
    /aria-live="off"/,
    '.chat-messages must set aria-live="off" so streaming does not flood the speech queue',
  );
});

test('a completed answer reaches a polite live region exactly once', () => {
  assert.match(
    CHAT,
    /className="sr-only"[^>]*role="status"[^>]*aria-live="polite"/,
    'the announcement region must be a polite status',
  );
  assert.match(CHAT, /aria-atomic="true"/, 'the announcement must be atomic so it is read whole');

  // The announcement is driven off the sending edge, not off the message list.
  // Watching `sending` is what covers all eight send paths in this file at once;
  // per-path hooks are eight copies and the eighth one rots.
  assert.match(
    CHAT,
    /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,200}?if \(sending\) return;/,
    'the announcement must be gated on the sending flag',
  );
  // Re-announcing an identical reply must not repeat itself.
  assert.match(CHAT, /announcedRef\.current/, 'the announcement needs a dedupe guard');
  assert.match(
    CHAT,
    /setAnnouncement\(''\)/,
    'the region must be emptied before the new text, or a repeated reply goes silent',
  );
});

test('announcements are length-capped, not spoken unbounded', () => {
  // Nothing in this app cancels the speech queue, so an unbounded announcement
  // of a long reply locks up speech and cannot be interrupted by sending.
  assert.match(CHAT, /const ANNOUNCE_LIMIT = \d+;/, 'an explicit cap belongs in ChatScreen');
  assert.match(CHAT, /text\.length <= ANNOUNCE_LIMIT/, 'announceText must honour the cap');
  assert.match(CHAT, /more characters in the transcript/, 'a capped announcement says so');
});

// ---- the command palette --------------------------------------------------

test('the palette cursor is exposed to a screen reader', () => {
  assert.match(
    PALETTE,
    /aria-activedescendant=\{results\.length \? optionId\(cursor\) : undefined\}/,
    'the combobox must point aria-activedescendant at the cursor',
  );
  assert.match(PALETTE, /const optionId = \(index: number\) =>/, 'option ids need one helper');
  // The id must be applied to the option itself, or the pointer resolves to
  // nothing and the attribute is worse than absent.
  assert.match(
    PALETTE,
    /id=\{optionId\(index\)\}/,
    'each option must carry the id aria-activedescendant names',
  );
  assert.match(PALETTE, /role="combobox"/, 'the input should be a combobox');
  assert.match(PALETTE, /aria-controls="palette-listbox"/, 'the combobox must name its listbox');
  assert.match(PALETTE, /aria-expanded="true"/, 'an open combobox is expanded');
});

test('the listbox contains only groups, options and presentation wrappers', () => {
  // role="listbox" may hold options and groups. A bare <div> between them is
  // an unlabelled child of a widget that does not allow one, which drops the
  // row out of the list in some screen readers.
  const at = PALETTE.indexOf('role="listbox"');
  assert.ok(at >= 0, 'the palette needs a listbox');
  const body = PALETTE.slice(at, PALETTE.indexOf('</div>\n\n      {', at) || PALETTE.length);
  for (const role of ['role="group"', 'role="presentation"', 'role="option"']) {
    assert.ok(body.includes(role), `expected ${role} inside the listbox`);
  }
  assert.doesNotMatch(
    body,
    /<div key=\{entry\.id\}>/,
    'a wrapper <div> with no role inside a listbox hides its row',
  );
});

test('the palette input keeps focus so activedescendant is meaningful', () => {
  // aria-activedescendant only works if focus stays in the input. If a later
  // edit autofocuses the first option, the attribute becomes a lie.
  assert.match(PALETTE, /ref=\{inputRef\}/, 'the input holds the palette focus');
  // Focus is moved in a timer after paint rather than with autoFocus, so the
  // palette is typable the instant it opens. What matters here is only that the
  // focus target is the input.
  assert.match(
    PALETTE,
    /inputRef\.current\?\.focus\(\)/,
    'opening the palette must focus the input, not the first option',
  );
  assert.doesNotMatch(PALETTE, /autoFocus/, 'autoFocus would fight the after-paint focus');
});

// ---- the titlebar ---------------------------------------------------------

test('the titlebar names its theme toggle once, and plainly', () => {
  // The old label composed to "Toggle theme to light theme".
  assert.match(
    TITLEBAR,
    /`Switch to \$\{toDark \? 'dark' : 'light'\} theme`/,
    'the toggle label should name its target once',
  );
  assert.doesNotMatch(TITLEBAR, /Toggle theme to/, 'the doubled-word label is gone');
  assert.doesNotMatch(TITLEBAR, /focusState/, 'no dead state');
});

test('the titlebar renders the brand once', () => {
  const brands = TITLEBAR.match(/titlebar-brand/g) || [];
  assert.equal(brands.length, 1, `expected one brand, found ${brands.length}`);
  // It belongs inside the drag region, which is the only part of the bar that
  // drags the window.
  assert.match(
    TITLEBAR,
    /className="titlebar-drag"[\s\S]{0,200}?className="titlebar-brand"/,
    'the brand should sit inside the drag region',
  );
});

test('titlebar glyphs come from the shared icon set', () => {
  // Inline SVGs bypassed the 24x24 / 1.6px grid and had no size rules, so they
  // rendered at their default intrinsic size inside a 32px bar.
  assert.match(TITLEBAR, /^import Icon from '\.\/components\/Icon';/m, 'Icon should be imported');
  assert.doesNotMatch(TITLEBAR, /<svg/, 'no inline SVG in the titlebar');
  assert.match(TITLEBAR, /<Icon name="brand"/, 'the brand mark comes from the set');
  assert.match(TITLEBAR, /<Icon name=\{toDark \? 'sun' : 'moon'\}/, 'the toggle uses sun/moon');
});

test('the brand mark is not the same glyph as the light-mode toggle', () => {
  const icon = read('desktop', 'src', 'components', 'Icon.tsx');
  const paths = Object.fromEntries(
    [...icon.matchAll(/^\s{2}(\w+):\s*'?([\dA-Za-z.,\s-]+?)'?,\s*$/gm)].map((m) => [m[1], m[2].trim()]),
  );
  assert.ok(paths.brand, 'Icon must define a brand glyph');
  assert.ok(paths.sun, 'Icon must define sun');
  assert.ok(paths.moon, 'Icon must define moon');
  // A logo drawn as the same sun as the "switch to light" control makes the
  // brand look like a button.
  assert.notEqual(paths.brand, paths.sun, 'brand must not be the sun glyph');
  assert.notEqual(paths.brand, paths.moon, 'brand must not be the moon glyph');
  // And the grid the file's own header comment promises.
  assert.match(icon, /strokeWidth=\{1\.6\}/, 'icons keep the 1.6px stroke');
});
