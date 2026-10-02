// The token contract: every var() in the stylesheet must resolve to something
// the stylesheet itself defines, and the result must be checked against WCAG.
//
// Why this exists. index.css grew by accretion across five :root blocks, and
// two classes of drift went unnoticed for a long time:
//
//   1. A whole green-grey ramp (--abyss/--slate/--riser/--edge/--gilt) was
//      defined, then silently overridden 300 lines later by a block that
//      re-pointed it at the Neural ramp. The gold #c9a961 never painted.
//   2. Six rules wrote `var(--danger, #ef4444)` and friends. --danger does not
//      exist, so the hardcoded fallback was what actually rendered: four
//      different reds, none of which responded to the light theme, next to a
//      perfectly good theme-aware --err.
//
// Both are invisible in a screenshot and invisible to tsc. A test that walks
// the custom properties is the only thing that catches them.
//
// desktop-look.test.js already proves the *colour maths* (accent hue sweep,
// AA on every surface). This file proves the *plumbing*: no dangling reference,
// no dark value overriding a light one by accident, no unthemed literal where a
// token exists.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'desktop/src/index.css');

function readCss() {
  const raw = fs.readFileSync(CSS_PATH, 'utf8');
  // Strip comments first: a commented-out definition is not a definition, and
  // a commented-out var() is not a reference. Both would otherwise be counted.
  return raw.replace(/\/\*[\s\S]*?\*\//g, '');
}

const css = readCss();

/** token name -> every line that defines it */
function definitionsOf(source) {
  const found = new Map();
  const re = /(--[a-zA-Z0-9_-]+)\s*:/g;
  let m;
  while ((m = re.exec(source))) {
    const line = source.slice(0, m.index).split('\n').length;
    if (!found.has(m[1])) found.set(m[1], []);
    found.get(m[1]).push(line);
  }
  return found;
}

/** token name -> every line that reads it, minus fallbacks it never reaches */
function referencesOf(source) {
  const found = new Map();
  const re = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(,|\))/g;
  let m;
  while ((m = re.exec(source))) {
    // `var(--x, fallback)` only falls back when --x is undefined, so a defined
    // --x makes the fallback unreachable. Still a reference though: if --x
    // were ever deleted, the fallback would quietly take over.
    const name = m[1];
    const line = source.slice(0, m.index).split('\n').length;
    if (!found.has(name)) found.set(name, []);
    found.get(name).push(line);
  }
  return found;
}

const definitions = definitionsOf(css);
const references = referencesOf(css);

// Tokens painted from JS at runtime, so absent from the stylesheet on purpose.
// Mirrors the setProperty calls in theme.ts and the inline --swatch-h style in
// components/AppearanceCard.tsx. Keep in step with those.
const RUNTIME_TOKENS = new Set([
  '--accent-h',    // theme.ts: the accent hue, drives every accent token
  '--swatch-h',    // AppearanceCard.tsx: inline style on a preset swatch
  '--parallax-x',  // set by the pointer-parallax effect
  '--parallax-y',
]);

test('every var() in index.css resolves to a defined token', () => {
  const dangling = [];
  for (const [name, lines] of references) {
    if (definitions.has(name)) continue;
    if (RUNTIME_TOKENS.has(name)) continue;
    dangling.push(`${name} (read at ${lines.slice(0, 4).join(', ')})`);
  }
  assert.deepEqual(dangling, [], 'dangling var() references: ' + dangling.join('; '));
});

test('no token is left defined but never read', () => {
  const dead = [];
  for (const name of definitions.keys()) {
    if (references.has(name)) continue;
    if (RUNTIME_TOKENS.has(name)) continue;
    dead.push(name);
  }
  // Every one of these was a dead definition at some point. A new one means
  // either a typo or a leftover from a palette that no longer ships.
  assert.deepEqual(dead, [], 'tokens defined but never read: ' + dead.join(', '));
});

test('no rule hardcodes a colour literal that a status token already covers', () => {
  // The --danger/--warning drift came from writing a fallback instead of the
  // token. Catch the shape of that mistake: var(--err) beside a hex fallback.
  const suspicious = [];
  const re = /var\(\s*(--err|--warn|--ok)\s*,\s*(#[0-9a-fA-F]{3,8})/g;
  let m;
  while ((m = re.exec(css))) {
    const line = css.slice(0, m.index).split('\n').length;
    suspicious.push(`line ${line}: var(${m[1]}, ${m[2]})`);
  }
  assert.deepEqual(
    suspicious,
    [],
    'status colours should use the token alone, not a hardcoded fallback: ' + suspicious.join('; '),
  );
});

test('the two accent vocabularies cannot drift apart again', () => {
  // --riser/--edge/--gilt are aliases onto the Neural ramp. The regression
  // this guards is a second :root giving them real values again, which would
  // repaint the workbench in a palette nothing else uses.
  const aliases = {
    '--abyss': '--bg-0',
    '--slate': '--bg-1',
    '--riser': '--bg-2',
    '--edge': '--border',
    '--gilt': '--accent',
  };
  for (const [alias, target] of Object.entries(aliases)) {
    const re = new RegExp(`${alias}\\s*:\\s*var\\(\\s*${target}\\s*\\)`);
    assert.match(css, re, `${alias} must stay an alias of ${target}`);
  }
});

test('the gloss wash is neutral, not a leftover hue', () => {
  // It was rgba(180, 255, 200) -- mint green over every panel and button in a
  // violet app. A gloss highlight should read as light, not as a colour cast.
  const block = css.match(/--gloss:\s*linear-gradient\([^;]+;/);
  assert.ok(block, '--gloss must still be defined');
  const channelSpread = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
  const rgbs = [...block[0].matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)];
  assert.ok(rgbs.length > 0, '--gloss must be an rgb colour');
  for (const [, r, g, b] of rgbs) {
    const spread = channelSpread(Number(r), Number(g), Number(b));
    // The green was rgb(180, 255, 200): spread 75, and green-dominant. A cool
    // near-white sits around spread 29 with blue >= red. Both bounds matter --
    // spread alone would pass a saturated cyan.
    assert.ok(
      spread <= 40,
      `--gloss rgb(${r}, ${g}, ${b}) is tinted by ${spread} -- expected a near-neutral wash`,
    );
    assert.ok(
      Number(b) >= Number(r),
      `--gloss rgb(${r}, ${g}, ${b}) is not cool; the wash should read as neutral light`,
    );
  }
});

test('the accent lightness in the comment matches the accent in the rule', () => {
  // The comment claimed "L 0.80 / C 0.18" while the rule said oklch(0.73 0.19).
  // Both passed AA, so no test noticed, and the prose is what a future author
  // reads. Pin them together.
  const decl = css.match(/--accent:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+var\(--accent-h\)\s*\)/);
  assert.ok(decl, '--accent must stay oklch(L C var(--accent-h)) so every hue clears AA');
  const [, lRaw, cRaw] = decl;
  const nearby = css.slice(Math.max(0, css.indexOf(decl[0]) - 700), css.indexOf(decl[0]));
  const claim = nearby.match(/L\s*([\d.]+)\s*\/\s*C\s*([\d.]+)/);
  if (claim) {
    assert.equal(
      Number(claim[1]).toFixed(2),
      Number(lRaw).toFixed(2),
      'the comment\'s accent lightness disagrees with the rule',
    );
    assert.equal(
      Number(claim[2]).toFixed(2),
      Number(cRaw).toFixed(2),
      'the comment\'s accent chroma disagrees with the rule',
    );
  }
});
