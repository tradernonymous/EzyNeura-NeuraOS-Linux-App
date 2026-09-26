// E3 (upgrade plan): the FLUX.2 offer appears where the app begins — the
// empty chat — and only while setup is genuinely unfinished. flux-setup.js is
// pure (the same module LocalImagesCard drives), so the offer's decision is
// tested here without a shell; the .tsx pins keep the card honest about the
// shell calls, the dismissal, and the trip to Images.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const setup = require('../desktop/src/flux-setup.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('the offer is made exactly while a step is left, and ends when the server runs', () => {
  // A fresh machine: nothing set up, so next() finds the server step.
  const fresh = setup.next(setup.steps({}, {}));
  assert.ok(fresh, 'an untouched PC is offered the setup');
  assert.equal(fresh.id, 'server', 'the first thing needed is the sd-server');

  // Everything done: server on disk, a FLUX.2 model chosen, server ready.
  const done = setup.next(setup.steps(
    { found: true, binary: '/opt/sd-server', model: '/m/flux-2-klein-4b' },
    { state: 'ready' },
  ));
  assert.equal(done, null, 'a finished setup is never offered again');

  // Mid-setup (server built, model not yet): still an offer, at the model step.
  const mid = setup.next(setup.steps({ found: true, binary: '/opt/sd-server' }, { state: 'stopped' }));
  assert.ok(mid, 'a half-finished setup keeps the offer alive');
  assert.equal(mid.id, 'model');
});

test('the card asks the shell once, hides without one, and remembers Not now', () => {
  const card = read('desktop', 'src', 'components', 'Flux2OfferCard.tsx');
  assert.match(card, /freeai4u\.flux2\.dismissed/, 'the dismissal has its own key');
  assert.match(card, /if \(!hasShell\(\)\) \{ setChecked\(true\); return; \}/, 'no shell: no offer, no calls');
  assert.match(card, /call<any>\('sd_find'\)/, 'it asks what is on disk');
  assert.match(card, /call<any>\('sd_status'\)/, 'it asks what is running');
  assert.match(card, /flux\.next\(flux\.steps\(facts \|\| \{\}, status \|\| \{\}\)\)/, 'the pure module decides');
  assert.match(card, /localStorage\.setItem\(DISMISS_KEY, '1'\)/, 'Not now lasts past this session');
  // The three steps themselves live in Images (LocalImagesCard's job).
  assert.match(card, /view: 'images'/, 'Set up in Images takes you there');
  assert.match(card, /import '\.\.\/flux-setup\.js'/, 'the UMD module is loaded for its side effect');
});

test('the offer sits on the empty chat, after the Mint pack', () => {
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  const at = chat.indexOf('<Flux2OfferCard />');
  assert.ok(at > 0, 'ChatScreen renders the offer');
  assert.ok(at > chat.indexOf('<MintPackCard'), 'below the pack card, not above it');
  const css = read('desktop', 'src', 'index.css');
  for (const sel of ['.first-run-offer', '.first-run-offer-hint', '.first-run-offer-actions']) {
    assert.ok(css.includes(sel), `index.css has ${sel}`);
  }
});
