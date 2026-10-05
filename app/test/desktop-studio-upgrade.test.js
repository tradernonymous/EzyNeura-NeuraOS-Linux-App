// The studio upgrade (2026-10-06): what Figma, Adobe Express and the
// artifact-style tools do that the Design and Images tabs should too, and
// what each upgrade is pinned to.
//
//   Design: undo/redo (undo.js), presentation mode, the deck outline with
//           slide moving (outline.js), zoom, a live WCAG readout on the
//           page's tokens, project duplication.
//   Images: the Again reroll (image-run.js withSeed), a Steps control for a
//           local draw, quick actions on a drawn picture (image-adjust.js),
//           save-all-as-ZIP, and prompt reuse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

require('../desktop/src/design/outline.js');
require('../desktop/src/design/undo.js');
require('../desktop/src/image-adjust.js');
require('../desktop/src/image-run.js');
const outline = globalThis.FreeAI4UDesignOutline;
const undo = globalThis.FreeAI4UDesignUndo;
const adjust = globalThis.FreeAI4UImageAdjust;
const run = globalThis.FreeAI4UImageRun;

// ---- outline.js -------------------------------------------------------------

const DECK = '<main>'
  + '<section class="slide"><h1>First</h1><p>one</p></section>'
  + '<section class="slide"><section class="slide-inner"><h2>Second &amp; a bit</h2></section></section>'
  + '<section class="slide"><h1>Third</h1></section>'
  + '</main>';

test('outline: one title per slide, nested sections counted, entities decoded', () => {
  const rows = outline.outlineOf(DECK);
  assert.deepEqual(rows.map((r) => r.title), ['First', 'Second & a bit', 'Third']);
  assert.deepEqual(rows.map((r) => r.index), [0, 1, 2]);
  assert.equal(outline.outlineOf('<p>no deck here</p>').length, 0);
});

test('outline: a slide without a heading is called its first words, cut at a word', () => {
  const rows = outline.outlineOf('<section class="slide"><p>' + 'word '.repeat(30) + 'tail</p></section>');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].title.length <= outline.TITLE_MAX);
  assert.ok(rows[0].title.endsWith('…'));
  assert.ok(!rows[0].title.endsWith(' …'));
  assert.equal(outline.outlineOf('<section class="slide"><svg><path/></svg></section>')[0].title, 'Slide 1');
});

test('outline: moveSlide reorders and keeps every other byte', () => {
  const moved = outline.moveSlide(DECK, 2, 0);
  const titles = outline.outlineOf(moved).map((r) => r.title);
  assert.deepEqual(titles, ['Third', 'First', 'Second & a bit']);
  // Nothing lost: the same slides, just in another order.
  assert.equal(moved.replace(/\s+/g, '').length, DECK.replace(/\s+/g, '').length);
  // Moving down anchors after the target slide.
  assert.deepEqual(outline.outlineOf(outline.moveSlide(DECK, 0, 2)).map((r) => r.title), ['Second & a bit', 'Third', 'First']);
  for (const [from, to] of [[1, 1], [0, 3], [-1, 0], [0, -1], [5, 0]]) {
    assert.equal(outline.moveSlide(DECK, from, to), DECK, `${from}->${to} is not a move`);
  }
  assert.equal(outline.moveSlide('', 0, 1), '');
});

// ---- undo.js ----------------------------------------------------------------

test('undo: mark records the past and clears the redo future', () => {
  let s = undo.initial();
  assert.equal(undo.canUndo(s), false);
  s = undo.mark(s, 'a');
  s = undo.mark(s, 'b');
  assert.deepEqual(s.past, ['a', 'b']);
  assert.equal(undo.canRedo(s), false);
  const back = undo.undo(s, 'c');
  assert.equal(back.present, 'b');
  assert.ok(undo.canRedo(back.state));
  // A new change forgets the future, like every editor teaches.
  const marked = undo.mark(back.state, 'c');
  assert.equal(undo.canRedo(marked.state), false);
});

test('undo: undo/redo round-trips and refuses nonsense', () => {
  let s = undo.initial();
  s = undo.mark(s, 'a');
  s = undo.mark(s, 'b');
  const back = undo.undo(s, 'present');
  assert.equal(back.present, 'b');
  const fwd = undo.redo(back.state, back.present);
  assert.equal(fwd.present, 'present');
  assert.deepEqual(fwd.state.past, ['a', 'b']);
  assert.equal(undo.undo(undo.initial(), 'x'), null);
  assert.equal(undo.redo(s, 'x'), null);
  assert.equal(undo.undo(s, ''), null, 'nothing to put back');
  assert.equal(undo.mark(s, ''), s, 'an empty page is not a step');
  assert.equal(undo.mark(s, 'b'), s, 'marking the same page twice is not a step');
  // The stack is bounded.
  for (let i = 0; i < undo.MAX + 5; i += 1) s = undo.mark(s, 'page-' + i);
  assert.equal(s.past.length, undo.MAX);
});

// ---- image-adjust.js --------------------------------------------------------

test('adjust: a quarter turn swaps the output sides, negatives wrap', () => {
  assert.deepEqual([adjust.turnsOf(-1), adjust.turnsOf(5), adjust.turnsOf(2)], [3, 1, 2]);
  const right = adjust.plan({ width: 400, height: 300, rotate: 1 });
  assert.deepEqual([right.width, right.height], [300, 400]);
  assert.equal(right.angle, Math.PI / 2);
  const left = adjust.plan({ width: 400, height: 300, rotate: -1 });
  assert.equal(left.angle, (3 * Math.PI) / 2, 'a turn to the left, wrapped to 3 quarters — the same picture as -90°');
  assert.deepEqual([left.width, left.height], [300, 400]);
  assert.deepEqual([adjust.plan({ width: 400, height: 300 }).width, adjust.plan({ width: 400, height: 300 }).height], [400, 300]);
});

test('adjust: the crop is the largest centred rectangle of the ratio asked', () => {
  assert.deepEqual(adjust.cropRect(1000, 1000, 1, 1), { x: 0, y: 0, width: 1000, height: 1000 });
  assert.deepEqual(adjust.cropRect(1000, 500, 1, 1), { x: 250, y: 0, width: 500, height: 500 });
  assert.deepEqual(adjust.cropRect(1000, 500, 16, 9), { x: 55, y: 0, width: 889, height: 500 });
  assert.deepEqual(adjust.cropRect(500, 1000, 4, 5), { x: 0, y: 187, width: 500, height: 625 });
  assert.deepEqual(adjust.cropRect(10, 10, 16, 9), { x: 0, y: 2, width: 10, height: 6 });
});

test('adjust: filters are 0-300 percent, said only when asked for', () => {
  assert.equal(adjust.filterString(null), '');
  assert.equal(adjust.filterString({ brightness: 100, contrast: 100, saturation: 100 }), '');
  assert.equal(adjust.filterString({ brightness: 120 }), 'brightness(1.2)');
  assert.equal(adjust.filterString({ contrast: 50, saturation: 200 }), 'contrast(0.5) saturate(2)');
  assert.equal(adjust.percent(500), 300);
  assert.equal(adjust.percent('nonsense'), 0);
  assert.equal(adjust.percent(33.4), 33);
});

test('adjust: flips compose with rotation and crops; the label says what was done', () => {
  const p = adjust.plan({ width: 800, height: 600, rotate: 1, flipH: true, crop: { w: 1, h: 1, label: '1:1' }, adjust: { brightness: 110 } });
  assert.deepEqual([p.width, p.height], [600, 600], 'crop first, then the turn swaps the sides');
  assert.equal(p.sx, -1);
  assert.equal(p.filter, 'brightness(1.1)');
  assert.match(adjust.label({ rotate: 1, flipH: true, crop: { w: 1, h: 1, label: '1:1' }, adjust: { brightness: 110 } }), /rotated 90° right, flipped horizontally, cropped to 1:1, adjusted/);
  assert.equal(adjust.label({}), 'unchanged');
  const spec = { width: 100, height: 100, rotate: 2 };
  assert.deepEqual([adjust.plan(spec).src.width, adjust.plan(spec).src.height], [100, 100]);
});

// ---- image-run.js: the Steps passthrough ------------------------------------

test('drawPlan: a caller\'s step count reaches a local job, and only a local job', () => {
  const local = { id: 'local', kind: 'local', ready: true, model: 'flux.gguf' };
  const asked = run.drawPlan(local, { prompt: 'a cat', size: 'square', steps: 28 });
  assert.equal(asked.body.steps, 28);
  const auto = run.drawPlan(local, { prompt: 'a cat', size: 'square' });
  assert.equal(auto.body.steps, null, 'no ask, no steps: the shell picks the model\'s own');
  const again = run.withSeed(asked, 4242);
  assert.equal(again.body.seed, 4242);
  assert.ok(again.notes.some((n) => /seed 4242/.test(n)));
  // The images.js rule underneath is unchanged: a number is kept, junk is not.
  const images = globalThis.FreeAI4UImages;
  assert.equal(images.localRequest({ prompt: 'x', steps: 12 }).steps, 12);
  assert.equal(images.localRequest({ prompt: 'x', steps: 7.6 }).steps, 8);
});

// ---- the screens wear it -----------------------------------------------------

test('the Design screen: Present, Undo/Redo with the shortcuts, zoom, outline, contrast, duplicate', () => {
  const design = read('desktop', 'src', 'screens', 'DesignScreen.tsx');
  assert.match(design, /function PresentOverlay/);
  assert.match(design, /sandbox="allow-scripts" srcDoc=\{artifact\.inject\(html\)\}/, 'presentation runs the same sandboxed frame, never same-origin');
  assert.match(design, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); onClose\(\); \}/);
  assert.match(design, /onClick=\{doUndo\} disabled=\{!undoLib\.canUndo/);
  assert.match(design, /'y'\)\) \{ e\.preventDefault\(\); doRedo\(\); \}/, 'Ctrl+Y is redo too');
  assert.match(design, /label="Zoom"/);
  assert.match(design, /outlineLib\.outlineOf/);
  assert.match(design, /outlineLib\.moveSlide\(clean, from, to\)/);
  assert.match(design, /className="deck-outline" role="listbox"/);
  assert.match(design, /brand\.contrastReport\(ink, paper\)/);
  assert.match(design, /className="token-contrast"/);
  assert.match(design, /duplicateProject/);
  assert.match(design, /designUpdateProject\(p\.id, \{/);
  const undoSrc = read('desktop', 'src', 'design', 'undo.js');
  assert.match(undoSrc, /root\.FreeAI4UDesignUndo = api/);
  const outlineSrc = read('desktop', 'src', 'design', 'outline.js');
  assert.match(outlineSrc, /root\.FreeAI4UDesignOutline = api/);
});

test('the Images screen: Again, Steps, quick actions, save-all, prompt reuse', () => {
  const images = read('desktop', 'src', 'screens', 'ImagesScreen.tsx');
  assert.match(images, /imageRun\.withSeed\(last\.plan\)/);
  assert.match(images, /label="Steps"/);
  assert.match(images, /steps: steps === 'auto' \? undefined : Number\(steps\)/);
  assert.match(images, /onClick=\{runAgain\}/);
  assert.match(images, /adjustLib\.plan\(specOut\)/);
  assert.match(images, /ctx\.filter = plan\.filter/);
  assert.match(images, /nothing was sent anywhere/, 'the quick-action note says where the edit happened');
  assert.match(images, /onClick=\{saveAllZip\}/);
  assert.match(images, /setPrompt\(job\.prompt\)/, 'Use prompt puts the words back');
  const adjustSrc = read('desktop', 'src', 'image-adjust.js');
  assert.match(adjustSrc, /root\.FreeAI4UImageAdjust = api/);
});

test('index.css carries the new surfaces', () => {
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.design-present {', '.deck-outline {', '.token-contrast {', '.images-gallery-bar {', '.image-quick {']) {
    assert.ok(css.includes(sel), `index.css has ${sel}`);
  }
});
