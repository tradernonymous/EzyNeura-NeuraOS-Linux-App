// The Create rebuild: two exclusive tabs -- Design and Image -- and what
// each side of them is pinned to.
//
//   Create: TABS over the five modes, one screen mounted at a time, the tab
//           moving the view the bar highlights, the sub-switch under it.
//   Design: quick-start chips over the brief, HTML in (a file onto the
//           canvas), link out (the page as a data: URL, nothing uploaded).
//   Image:  the workflow rail first, then the knobs (seed, negative prompt,
//           upscale) — the ComfyUI order, with buttons instead of nodes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const create = require('../desktop/src/create.js');
require('../desktop/src/image-run.js');
require('../desktop/src/design/systems.js');
const run = globalThis.FreeAI4UImageRun;
const systems = globalThis.FreeAI4UDesignSystems;

test('two tabs over the five modes, each tab with its own sub-switch', () => {
  assert.deepEqual(create.TABS.map((t) => t.id), ['design', 'image']);
  assert.deepEqual(create.TABS.map((t) => t.screen), ['design', 'images']);
  // Every mode belongs to exactly one tab, named after its screen.
  for (const m of create.MODES) {
    assert.equal(create.tabOf(m.id), m.screen === 'images' ? 'image' : 'design', m.id);
  }
  assert.deepEqual(create.modesForTab('design').map((m) => m.id), ['page', 'deck', 'post']);
  assert.deepEqual(create.modesForTab('image').map((m) => m.id), ['image', 'edit']);
  assert.equal(create.tabOf('nope'), 'design', 'an unknown mode lands on Design');
  // The new starts ride old modes: the gallery grew, the mode union did not.
  assert.deepEqual(create.MODES.map((m) => m.id), ['page', 'deck', 'post', 'image', 'edit']);
  for (const id of ['mobile', 'onepager', 'email']) {
    const card = create.templateAt(id);
    assert.ok(card && card.brief, `${id} has a brief`);
    assert.ok(create.modeAt(card.mode), `${id} rides mode ${card.mode}`);
  }
  // The design gallery keeps its own four first — the screens split by them.
  assert.deepEqual(create.cardsFor('design').slice(0, 4).map((c) => c.id), ['landing', 'dashboard', 'deck', 'post']);
  const designCards = create.cardsFor('design').filter((c) => create.modeAt(c.mode).screen === 'design');
  assert.ok(designCards.length >= 7, 'the Design tab offers every design start');
  assert.equal(create.cardsFor('images')[0].mode, 'image', 'the Image tab still opens with its own');
});

test('Create wears the two tabs: one screen at a time, the view follows', () => {
  const screen = read('desktop', 'src', 'screens', 'CreateScreen.tsx');
  assert.match(screen, /create\.TABS\.map/);
  assert.match(screen, /role="tablist"/);
  assert.match(screen, /className="create-switch"/, 'the switch keeps its class');
  assert.match(screen, /create-modes/, 'the sub-switch under the tabs');
  assert.match(screen, /create\.modesForTab\(tab\)/, 'a tab shows only its own modes');
  assert.match(screen, /NAVIGATE_EVENT/, 'the tab moves the view the bar highlights');
  assert.match(screen, /viewportHint=\{current\.viewport/);
  assert.match(screen, /taskHint=\{current\.task/);
  // Only one half is ever mounted: exclusivity is the render, not a style.
  assert.match(screen, /current\.screen === 'design'/);
  assert.match(screen, /<DesignScreen [\s\S]*: <ImagesScreen/);
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.create-tab {', '.create-modes {', '.images-rail {', '.flow-btn {']) {
    assert.ok(css.includes(sel), `index.css has ${sel}`);
  }
});

test('the Design tab: quick starts, a file in, a link out', () => {
  const design = read('desktop', 'src', 'screens', 'DesignScreen.tsx');
  // Claude Design's "idea to visual in minutes": every start is a chip.
  assert.match(design, /className="brief-chips"/);
  assert.match(design, /className="brief-chip"/);
  assert.match(design, /setBrief\(card\.brief\)/);
  // A design file in: HTML onto the canvas as one version, project or not.
  assert.match(design, /const importHtml = /);
  assert.match(design, /accept="\.html,\.htm,text\/html"/);
  assert.match(design, /commit\(text, `Imported: \$\{file\.name\}`\)/);
  // A link out: the page IS the link (a data: URL), nothing uploaded; too
  // big for one link and the HTML goes on the clipboard instead, said so.
  assert.match(design, /const copyLink = async/);
  assert.match(design, /data:text\/html;base64,/);
  assert.match(design, /1_500_000/);
  assert.match(design, /Nothing was uploaded/);
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.brief-chip {', '.import-html {']) assert.ok(css.includes(sel), `index.css has ${sel}`);
});

test('the Image tab: the workflow rail first, then the knobs', () => {
  const images = read('desktop', 'src', 'screens', 'ImagesScreen.tsx');
  assert.match(images, /className="images-rail"/);
  assert.match(images, /FLOWS = \[/);
  // Every workflow names the task it does; the rail picks it.
  for (const [id, task] of [
    ['txt2img', 'generate'], ['img2img', 'edit'], ['inpaint', 'edit'],
    ['variation', 'generate'], ['enhance', 'generate'],
  ]) {
    assert.ok(new RegExp(`id: '${id}'[\\s\\S]{0,160}task: '${task}'`).test(images), `${id} does ${task}`);
  }
  // The rail owns draw vs change now: no second Task pill above it.
  assert.ok(!/label="Task"/.test(images), 'the rail is the task');
  // This PC's knobs, and they reach the plan.
  assert.match(images, /id="images-seed"/);
  assert.match(images, /negativePrompt: negativeText/);
  assert.match(images, /imageRun\.withSeed\(plan, Number\(seed\)\)/);
  assert.match(images, /isLocal && /, 'the knobs are shown only when This PC can take them');
  // Enhance shares the per-card controls, and upscales on this canvas.
  assert.match(images, /<QuickControls/);
  assert.match(images, /const upscaleJob = /);
  assert.match(images, /imageSmoothingQuality/);
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.enhance-panel {', '.seed-row {', '.rail-foot {', '.neg-prompt {']) {
    assert.ok(css.includes(sel), `index.css has ${sel}`);
  }
  const icons = read('desktop', 'src', 'components', 'Icon.tsx');
  for (const name of ['brush', 'sliders']) assert.ok(new RegExp(`  ${name}: '`).test(icons), `Icon draws ${name}`);
});

test('a negative prompt rides a local draw, a seed pins it', () => {
  const local = { id: 'local', kind: 'local', ready: true, model: 'flux.gguf' };
  const plan = run.drawPlan(local, { prompt: 'a cat', size: 'square', negativePrompt: 'dog' });
  assert.equal(plan.route, 'local');
  assert.equal(plan.body.negativePrompt, 'dog');
  assert.equal(run.drawPlan(local, { prompt: 'a cat', size: 'square' }).body.negativePrompt, '', 'not asked, none sent');
  const pinned = run.withSeed(plan, 7);
  assert.equal(pinned.body.seed, 7);
  assert.equal(pinned.body.negativePrompt, 'dog', 'the seed does not drop the negative');
  assert.ok(pinned.notes.some((n) => /seed 7/.test(n)), 'the card says the seed it used');
});

test('the Design tab offers This PC: the row is always there and a stopped server starts on Generate', () => {
  const design = read('desktop', 'src', 'screens', 'DesignScreen.tsx');
  assert.match(design, /import \{ hasShell, writeLocalFile, localModelStatus, localModelStart \} from '\.\.\/bridge';/);
  assert.match(design, /import '\.\.\/local-models\.js';/);
  assert.match(design, /localModels\.providerRow\(status\)/, 'the same row Chat shows');
  assert.match(design, /setInterval\(read, 15000\)/, 'polled: models come and go while the app is open');
  // Always offered, the way the image tab offers This PC: stopped says so in
  // its note instead of vanishing.
  assert.match(design, /Local model \(This PC\)/, 'the row exists before the server does');
  assert.match(design, /not running — Generate starts it/);
  assert.match(design, /if \(!provider && providers\.some\(\(p\) => p\.id === 'local'\)\) setProvider\('local'\)/, 'This PC first when nothing is chosen');
  // The engine's own 'local' wins the id, the rule Chat keeps.
  assert.match(design, /const engineOwnsLocal = engineRows\.some\(\(p\) => p\.id === 'local'\)/);
  // Down, then up: the last file it ran, else the first saved model, and the
  // turn waits on the load rather than failing on an empty base URL.
  assert.match(design, /const ensureLocal = async/);
  assert.match(design, /localModelStart\(\{ repo: '', file: status\.file \}\)/);
  assert.match(design, /ensureUnsloth\(entry\)/);
  assert.match(design, /Nothing to start on this PC/, 'nothing to start is said in words');
  assert.match(design, /provider === 'local' && !engineOwnsLocal/, 'the model list and the stream key off the row');
  assert.match(design, /streamLocalChat\(local\.baseUrl, body\.model \|\| local\.model/, 'the model comes from the server that came up');
  // Generate stays clickable for a stopped server -- that is the point.
  assert.match(design, /\(!model && !\(provider === 'local' && !engineOwnsLocal\)\)/);
});

test('Service, Model and System live on the toolbar, not behind the Project fold', () => {
  const design = read('desktop', 'src', 'screens', 'DesignScreen.tsx');
  // The fold closes the moment a project is open, which is exactly when the
  // model has to be seen -- so the pickers moved to the toolbar.
  const spacer = design.indexOf('toolbar-spacer');
  assert.ok(spacer > 0);
  for (const label of ['label="Service"', 'label="Model"', 'label="System"']) {
    const at = design.indexOf(label);
    assert.ok(at > spacer, `${label} is after the spacer, in the toolbar`);
  }
  assert.ok(!/studio-pickers/.test(design + read('desktop', 'src', 'index.css')), 'the hidden block is gone, CSS with it');
});

test('a design system imports from another app: ZIP, HTML, JSON, or the plain files', () => {
  const design = read('desktop', 'src', 'screens', 'DesignScreen.tsx');
  assert.match(design, /accept="\.md,\.css,\.txt,\.zip,\.json,\.html,\.htm"/);
  assert.match(design, /zip\.readEntries\(/, 'another app\'s export ZIP is opened here');
  assert.match(design, /systemsLib\.jsonTokens\(raw\)/, 'a JSON token export becomes declarations first');
  // The tokens themselves stay pure and node-tested.
  const css = systems.jsonTokens(JSON.stringify({
    color: { accent: '#12Ab34', deep: { $value: '#000000' } },
    font: { sizes: { base: '16px' } },
    ref: { bad: '{color.accent}' },
    badjson: 'x',
  }));
  assert.match(css, /--color-accent: #12Ab34;/);
  assert.match(css, /--color-deep: #000000;/, '$value leaves are the value');
  assert.match(css, /--font-sizes-base: 16px;/, 'camelCase keys become kebab');
  assert.ok(!/\{color\.accent\}/.test(css), 'a reference means nothing without its file');
  assert.equal(systems.jsonTokens('not json at all'), '', 'unparseable text is empty, not a guess');
  // The CSS path still reads an HTML export's <style> block as-is.
  const sys = systems.importSystem('<style>:root { --brand: #336699; }</style>');
  assert.equal(sys.tokens['--brand'], '#336699');
});

test('a dropdown panel is portaled to the body and clamped, never off-screen', () => {
  const pill = read('desktop', 'src', 'components', 'SelectPill.tsx');
  assert.match(pill, /createPortal/, 'the panel is not inside the narrow column');
  assert.match(pill, /function clampPanel/, 'x and y are clamped to the viewport');
  assert.match(pill, /btn\.top - 6 - panel\.offsetHeight/, 'no room below? it opens above');
  // The panel lives outside the box, so the outside-click check has to know it.
  assert.match(pill, /panelRef\.current\?\./);
  assert.match(pill, /document\.addEventListener\('scroll', move, true\)/, 're-placed when the column scrolls');
  const css = read('desktop', 'src', 'index.css');
  assert.match(css, /\.select-panel \{[^}]*position: fixed;/);
  assert.match(css, /\.select-panel \{[^}]*max-height: calc\(100vh - 16px\);/);
  assert.match(css, /\.select-panel \{[^}]*z-index: 1000;/);
});

// The one that bit first: a placement effect that fires on every render must
// write the SAME reference when nothing moved, or React loops until the
// window dies (#185). Pinned so a "cleanup" of place() cannot bring it back.
test('placing the panel does not loop: same numbers, same reference', () => {
  const pill = read('desktop', 'src', 'components', 'SelectPill.tsx');
  assert.match(pill, /setAt\(\(prev\) => \(prev && prev\.top === next\.top && prev\.left === next\.left \? prev : next\)\)/);
});
