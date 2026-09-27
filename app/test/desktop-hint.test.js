// Hint (components/Hint.tsx, docs/UI_UPGRADE_PLAN.md phase P2): the summary
// line stays on screen, the rest opens on click. This pins the component's
// own shape (source-text pins, like the rest of this suite -- there is no
// React renderer here) and, separately, that every literal summary=".." in
// the frontend actually stays under the cap the component advertises, so
// the always-visible line stays short by construction rather than by memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('Hint starts collapsed, and the toggle is wired to the expanded text', () => {
  const src = read('app', 'desktop', 'src', 'components', 'Hint.tsx');
  assert.match(src, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /aria-controls=\{id\}/, 'the toggle names the expanded text it opens');
  assert.match(src, /<span id=\{id\}/, 'the expanded text carries that same id');
  assert.match(src, /export const HINT_SUMMARY_MAX = \d+/);
});

test('every literal Hint summary stays under HINT_SUMMARY_MAX', () => {
  const hintSrc = read('app', 'desktop', 'src', 'components', 'Hint.tsx');
  const capMatch = hintSrc.match(/HINT_SUMMARY_MAX = (\d+)/);
  assert.ok(capMatch, 'Hint.tsx exports the cap');
  const cap = Number(capMatch[1]);

  const srcDir = path.join(ROOT, 'app', 'desktop', 'src');
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.tsx')) files.push(p);
    }
  })(srcDir);

  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<Hint\s+summary="([^"]*)"/g)) {
      if (m[1].length > cap) {
        offenders.push(`${path.relative(ROOT, file)}: "${m[1]}" (${m[1].length} chars, cap ${cap})`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('this pass migrated at least the largest static-text hints found', () => {
  // Not every settings-hint is a Hint candidate -- state text ("No key
  // set", a failing check) stays visible on purpose. This just pins that
  // the specific paragraphs docs/UI_UPGRADE_PLAN.md named as migrated
  // really were, so the doc and the code cannot drift apart silently.
  const sites = [
    ['app/desktop/src/screens/SettingsScreen.tsx', /<Hint summary="A rate-limited model is retried/],
    ['app/desktop/src/components/DoctorCard.tsx', /<Hint summary="One check of everything NeuraOS depends on\."/],
    ['app/desktop/src/components/LocalImagesCard.tsx', /<Hint summary="No LoRAs yet\."/],
    ['app/desktop/src/components/DesktopControlCard.tsx', /<Hint summary="Adds five tools/],
    ['app/desktop/src/components/DesktopControlCard.tsx', /<Hint summary="Adds two MCP tools/],
    ['app/desktop/src/components/ConnectorsCard.tsx', /<Hint summary="Claude Code, Gemini CLI, Codex/],
    ['app/desktop/src/components/DictationCard.tsx', /<Hint summary="The mic turns speech into text/],
  ];
  for (const [file, pattern] of sites) {
    assert.match(read(file), pattern, `${file} still uses the old plain <p className="settings-hint">`);
  }
});
