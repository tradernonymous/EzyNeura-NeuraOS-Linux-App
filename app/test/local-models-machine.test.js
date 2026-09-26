// On the PC every chat model over ~3 GB was refused with "this machine
// reports 4 GB": WebKitGTK has no navigator.deviceMemory, so machine() fell
// back to 4 on a 15 GB box. And image-model repos (SDXL GGUFs) were offered as
// chat models that could never start.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../desktop/src/local-models.js');
require('../desktop/src/hf-models.js');
const localModels = globalThis.FreeAI4ULocalModels;
const hfModels = globalThis.FreeAI4UHfModels;

function withStorage(fn) {
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try { fn(); } finally { if (saved === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved; }
}

test('the shell-measured RAM replaces the webview\'s 4 GB guess', () => {
  withStorage(() => {
    assert.equal(localModels.machine().ramGb, 4, 'no measurement yet: the old fallback');
    localModels.rememberMachine(15);
    const m = localModels.machine();
    assert.equal(m.ramGb, 15);
    assert.equal(m.ramKnown, true);
    // A 7B Q4 (~4.4 GB) at 16k now fits a 15 GB machine instead of being refused.
    assert.equal(localModels.fit({ sizeGb: 4.4, context: 16384 }, m).fits, true);
    localModels.rememberMachine(0);
    assert.equal(localModels.machine().ramGb, 15, 'a bad reading does not erase a good one');
  });
});

test('an image model repo is told apart from a chat model repo', () => {
  assert.equal(hfModels.isImageModel({ pipeline_tag: 'text-to-image', tags: ['gguf'] }), true);
  assert.equal(hfModels.isImageModel({ pipeline_tag: 'image-to-image' }), true);
  // The prompt-writers the PC tried: tagged stable-diffusion, but text models.
  assert.equal(hfModels.isImageModel({ pipeline_tag: 'text-generation', tags: ['stable-diffusion', 'gguf'] }), false);
  assert.equal(hfModels.isImageModel({ tags: ['diffusers', 'sdxl'] }), true);
  assert.equal(hfModels.isImageModel({ tags: ['gguf', 'llama'] }), false);
  const card = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'components', 'LocalModelsCard.tsx'), 'utf8');
  assert.match(card, /hfModels\.isImageModel\(card\)/);
  assert.match(card, /Create → Image → On this PC/);
  assert.match(card, /localModels\.rememberMachine\(next\.gpu\.ram_gb\)/);
});
