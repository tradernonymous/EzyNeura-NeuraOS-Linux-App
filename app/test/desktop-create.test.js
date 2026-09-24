// Create (UI plan, phase 4): Design and Images in one screen with a mode
// switch, an Engine pill in two sections (This PC, Cloud), one Frame pill
// and one Export pill, an inspector that is absent until there is a page,
// and a gallery of starts. create.js is pure; the .tsx pins keep the shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const create = require('../desktop/src/create.js');

test('five modes: three open the studio with a frame, two the picture tools with a task', () => {
  assert.deepEqual(create.MODES.map((m) => m.id), ['page', 'deck', 'post', 'image', 'edit']);
  assert.deepEqual(create.MODES.filter((m) => m.screen === 'design').map((m) => m.viewport), ['desktop', 'deck', 'phone']);
  assert.deepEqual(create.MODES.filter((m) => m.screen === 'images').map((m) => m.task), ['generate', 'edit']);
  assert.equal(create.modeFor('design', { viewport: 'deck' }), 'deck');
  assert.equal(create.modeFor('design', { viewport: 'tablet' }), 'page');
  assert.equal(create.modeFor('images', { task: 'edit' }), 'edit');
  assert.equal(create.modeFor('images'), 'image');
  assert.equal(create.modeAt('nope'), null);
});

test('the gallery shows the screen\'s own starts first; every card has a mode and a sketch', () => {
  const design = create.cardsFor('design');
  assert.deepEqual(design.slice(0, 4).map((c) => c.id), ['landing', 'dashboard', 'deck', 'post']);
  assert.equal(create.cardsFor('images')[0].mode, 'image');
  for (const c of create.TEMPLATES) {
    assert.ok(create.modeAt(c.mode), c.id);
    assert.ok(c.sketch && c.label);
  }
  assert.equal(create.templateAt('retouch').brief, '', 'editing starts from a picture, not words');
  assert.match(create.templateAt('landing').brief, /\{\{the product\}\}/);
});

test('the Engine pill groups This PC before Cloud, and skips a group with nothing in it', () => {
  const rows = [{ id: 'flux', kind: 'server', ready: true }, { id: 'sd', kind: 'local', ready: false }, { id: 'puter', kind: 'browser' }];
  assert.deepEqual(create.engineGroups(rows).map((g) => [g.id, g.rows.map((r) => r.id)]), [['local', ['sd']], ['cloud', ['flux', 'puter']]]);
  assert.deepEqual(create.engineGroups([{ id: 'a', kind: 'server' }]).map((g) => g.id), ['cloud']);
  assert.deepEqual(create.engineGroups([]), []);
});

test('the screens wear it: the switch, the pills, the fold, the gallery', () => {
  const app = read('desktop', 'src', 'App.tsx');
  assert.match(app, /<CreateScreen initial=\{view\} \/>/);
  assert.ok(!/<DesignScreen \/>/.test(app) && !/<ImagesScreen \/>/.test(app));
  const screen = read('desktop', 'src', 'screens', 'CreateScreen.tsx');
  assert.match(screen, /className="create-switch"/);
  assert.match(screen, /viewportHint=\{current\.viewport/);
  assert.match(screen, /taskHint=\{current\.task/);
  const design = read('desktop', 'src', 'screens', 'DesignScreen.tsx');
  assert.match(design, /label="Frame"/);
  assert.ok(!/aria-label="Viewport"/.test(design), 'the five frame buttons are one pill');
  assert.match(design, /value: 'handoff', label: 'Handoff to Code'/);
  assert.ok(!/title="The page as one self-contained HTML file">HTML<\/button>/.test(design), 'HTML and PDF live in the Export pill');
  assert.match(design, /className="studio-project"/);
  assert.match(design, /no-inspector/);
  assert.match(design, /createLib\.cardsFor\('design'\)/);
  const images = read('desktop', 'src', 'screens', 'ImagesScreen.tsx');
  assert.match(images, /label="Engine"/);
  assert.match(images, /createLib\.engineGroups\(rows\)/);
  assert.match(images, /Settings → Local models/);
  const pill = read('desktop', 'src', 'components', 'SelectPill.tsx');
  assert.match(pill, /group\?: string;/);
  assert.match(pill, /dot\?: 'ok' \| 'warn' \| 'off';/);
  assert.match(pill, /className="select-group"/);
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.create-switch', '.create-card', '.create-gallery', '.select-group', '.studio-right.is-idle', '.studio-project > summary']) assert.ok(css.includes(sel + ' {'), `index.css has ${sel}`);
});
