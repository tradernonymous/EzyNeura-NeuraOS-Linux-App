// Images on this PC: the frontend's half of the FLUX.2 rules, and the
// parts of sd.rs they lean on. The shell decides a model's steps and cfg
// (sd.rs family_of), reads a set's roles (role_of) and edits FLUX.2 by
// reference; the frontend's job is to leave steps to it and to hand the
// downloader's set folder back as the model. Both halves are pinned here so
// neither can drift on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

require('../desktop/src/images.js');
require('../desktop/src/hf-models.js');
const images = globalThis.FreeAI4UImages;
const hfModels = globalThis.FreeAI4UHfModels;

const sdRs = () => read('desktop', 'src-tauri', 'src', 'sd.rs');
const card = () => read('desktop', 'src', 'components', 'LocalImagesCard.tsx');

test('a local request carries steps only when the caller asked for a number', () => {
  const draw = images.localRequest({ prompt: 'a cat', size: 'square' });
  assert.equal(draw.steps, null, 'the shell picks the model family\'s own steps');
  assert.equal(images.localRequest({ prompt: 'a cat', steps: 12 }).steps, 12);
  assert.equal(images.localSteps('0'), null);
  assert.equal(images.localSteps(7.6), 8);
  const local = { id: 'local', kind: 'local', label: 'This PC', ready: true, model: 'flux-2-klein-4b' };
  const edit = images.editRequest(local, { prompt: 'make it red', source: 'data:image/png;base64,QUJD', size: 'square' });
  assert.equal(edit.route, 'local');
  assert.equal(edit.body.steps, null);
  assert.equal(edit.body.initImage, 'data:image/png;base64,QUJD');
});

test('the shell knows the FLUX families, and applies them to the job', () => {
  const source = sdRs();
  assert.match(source, /pub fn family_of\(model: &Path\) -> Option<Family>/);
  assert.match(source, /"FLUX\.2 \[klein\]", cfg: 1\.0, steps: 4/);
  assert.match(source, /"FLUX\.2 \[klein\] base", cfg: 4\.0, steps: 20/);
  assert.match(source, /"FLUX\.2 \[dev\]", cfg: 1\.0, steps: 20/);
  // txt_cfg is api.md's name for the cfg scale; the family fills sample_steps only when absent.
  assert.match(source, /body\["sample_params"\]\["guidance"\] = serde_json::json!\(\{ "txt_cfg": family\.cfg \}\)/);
  assert.match(source, /body = with_family\(body, family_of\(&model\)\);/);
  // FLUX.2 edits by reference (ref_images), never image-to-image.
  assert.match(source, /name\.contains\("edit"\) \|\| name\.contains\("kontext"\) \|\| is_flux2\(&name\)/);
});

test('the shell reads a FLUX.2 set: the ae VAE and the Qwen3 encoder are parts, not the model', () => {
  const source = sdRs();
  assert.match(source, /stem == "ae" \|\| stem\.ends_with\("_ae"\) \|\| stem\.ends_with\("-ae"\)/);
  assert.match(source, /"qwen_3_",\s*"qwen3_",\s*"qwen3-",\s*"qwen3\.",/);
  // And a set folder is a model the card can choose (the downloader hands the folder back).
  assert.match(source, /if source\.is_dir\(\) \{\s*if set_in\(&source\)\.is_none\(\)/);
  assert.match(card(), /await call\('sd_use_model', \{ path: folder \}\)/);
});

test('the Comfy-Org split layout is offered as one set, and FLUX.2 [klein] is one click away', () => {
  const repo = {
    id: 'Comfy-Org/flux2-klein-4B',
    siblings: [
      { rfilename: 'split_files/diffusion_models/flux-2-klein-4b.safetensors', size: 8_000_000_000 },
      { rfilename: 'split_files/text_encoders/qwen_3_4b.safetensors', size: 8_100_000_000 },
      { rfilename: 'split_files/vae/flux2-vae.safetensors', size: 330_000_000 },
      { rfilename: 'README.md', size: 4_000 },
    ],
  };
  const offer = hfModels.imageOffer(repo);
  assert.equal(offer.rows.length, 1);
  const row = offer.rows[0];
  assert.equal(row.files.length, 3, 'the diffusion model with its VAE and text encoder');
  assert.ok(row.set, 'lands in its own folder');
  assert.equal(row.size, 16_430_000_000);
  const source = card();
  assert.match(source, /repo: 'Comfy-Org\/flux2-klein-4B'/);
  assert.match(source, /repo: 'Comfy-Org\/flux2-klein-9B'/);
  assert.match(source, /suggestions=\{FLUX2_SUGGESTIONS\}/);
});
