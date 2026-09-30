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
  // And files downloaded anywhere can be moved into a set folder by the shell.
  assert.match(source, /pub fn sd_import_set\(app: tauri::AppHandle\)/);
  assert.match(read('desktop', 'src-tauri', 'src', 'main.rs'), /sd::sd_import_set,/);
  assert.match(card(), /call<[^>]*>\('sd_import_set'\)/);
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
  assert.match(source, /suggestions=\{\[\.\.\.FLUX2_SUGGESTIONS, \.\.\.QWEN_SUGGESTIONS\]\}/);
});

test('Qwen-Image lands as one set with exactly one encoder per row (E5)', () => {
  const repo = {
    id: 'Comfy-Org/Qwen-Image_ComfyUI',
    siblings: [
      { rfilename: 'split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors', size: 20_430_000_000 },
      { rfilename: 'split_files/diffusion_models/qwen_image_bf16.safetensors', size: 40_861_000_000 },
      { rfilename: 'split_files/diffusion_models/qwen_image_nvfp4.safetensors', size: 19_769_000_000 },
      { rfilename: 'split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors', size: 20_430_000_000 },
      { rfilename: 'split_files/text_encoders/qwen_2.5_vl_7b.safetensors', size: 16_584_000_000 },
      { rfilename: 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors', size: 9_384_000_000 },
      { rfilename: 'split_files/text_encoders/qwen_2.5_vl_7b_nvfp4.safetensors', size: 6_114_000_000 },
      { rfilename: 'split_files/vae/qwen_image_vae.safetensors', size: 253_000_000 },
      { rfilename: 'README.md', size: 4_000 },
    ],
  };
  const offer = hfModels.imageOffer(repo);
  assert.equal(offer.rows.length, 3, 'one row per diffusion model sd-server can load');
  const byName = {};
  offer.rows.forEach((r) => { byName[r.label] = r; });
  const encoderOf = (label) => byName[label].files.find((f) => f.name.includes('qwen_2.5_vl')).name;
  for (const row of offer.rows) {
    assert.equal(row.files.filter((f) => f.name.includes('qwen_2.5_vl')).length, 1,
      `${row.label}: exactly one encoder — the three spellings are one group, not three parts`);
    assert.equal(row.files.filter((f) => f.name.includes('vae')).length, 1, 'one VAE');
  }
  // The part that matches the model's precision, not merely the smallest.
  assert.equal(encoderOf('qwen_image_fp8_e4m3fn.safetensors'), 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors');
  assert.equal(encoderOf('qwen_image_2512_fp8_e4m3fn.safetensors'), 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors');
  assert.equal(encoderOf('qwen_image_bf16.safetensors'), 'split_files/text_encoders/qwen_2.5_vl_7b.safetensors');
  // FP4 has per-block scales stable-diffusion.cpp aborts on: never offered.
  assert.equal(byName['qwen_image_nvfp4.safetensors'], undefined);
  assert.ok(offer.rows.every((r) => r.files.every((f) => !/fp4/i.test(f.name))), 'no FP4 part in any set');
  // Smallest first: an fp8 set (~30 GB) before the bf16 one.
  assert.ok(offer.rows[0].size < 31_000_000_000 && offer.rows[2].size > 50_000_000_000, 'the smallest row is offered first');
  const source = card();
  assert.match(source, /repo: 'Comfy-Org\/Qwen-Image_ComfyUI'/);
  assert.match(source, /about 30 GB as fp8/, 'the size is said before the download');
});

test('a local failure says what sd-server said, never "[object Object]"', () => {
  const view = images.localJobView({ status: 'failed', error: { message: 'failed to decode init image', code: 'bad_request' } });
  assert.equal(view.error, 'failed to decode init image');
  assert.equal(images.localJobView({ status: 'failed', error: 'out of memory' }).error, 'out of memory');
  assert.equal(images.localJobView({ status: 'failed' }).error, 'The local server could not draw that.');
  assert.equal(images.errorText(new Error('boom')), 'boom');
  assert.equal(images.errorText({ code: 7 }), '{"code":7}');
  assert.doesNotMatch(images.errorText({ error: { detail: 'x' } }), /object Object/);
});

test('a local edit keeps the photo\'s shape at about one megapixel (the 4 GB card)', () => {
  // The PC's photo: 3072x4096 became a 2048x2048 square that needed 4.2 GB.
  assert.deepEqual(images.localEditSize(3072, 4096), { width: 832, height: 1152 });
  const s = images.localEditSize(3072, 4096);
  assert.ok(s.width * s.height <= 1024 * 1024, 'within one megapixel');
  assert.ok(Math.abs(s.width / s.height - 3072 / 4096) < 0.05, 'same aspect ratio, not a square');
  assert.deepEqual(images.localEditSize(4000, 2000), { width: 1408, height: 704 });
  assert.deepEqual(images.localEditSize(512, 768), { width: 512, height: 768 }, 'never upscaled');
  assert.equal(images.localEditSize(0, 100), null);
  const plan = images.editRequest(images.localRow({ found: true, model: 'flux-2-klein-4b', running: true }), {
    prompt: 'make the sky orange', source: 'data:image/png;base64,AAAA', sourceWidth: 3072, sourceHeight: 4096,
  });
  assert.equal(plan.route, 'local');
  assert.equal(plan.body.width, 832);
  assert.equal(plan.body.height, 1152);
});

test('an image model can be deleted from the card, with a second click to confirm', () => {
  const src = card();
  assert.match(src, /call<[^>]*>\('sd_delete_model', \{ path \}\)/);
  assert.match(src, /if \(deleteAsk !== path\) \{ setDeleteAsk\(path\); return; \}/, 'the first click only arms it');
  assert.match(src, /'Sure\? Delete' : 'Delete'/);
  assert.match(src, /chosenPath\.startsWith\(facts\.models_dir \+ '\/'\)/, 'offered only for a model inside sd-models');
  const rs = sdRs();
  assert.match(rs, /pub fn sd_delete_model/);
  assert.match(rs, /"--vae-tiling"\.to_string\(\)/, 'a single-file model encodes in tiles too');
  assert.match(read('desktop', 'src-tauri', 'src', 'main.rs'), /sd::sd_delete_model,/);
});

test('a picture saves through the native dialog, opens large, and can be removed', () => {
  const screen = read('desktop', 'src', 'screens', 'ImagesScreen.tsx');
  // <a download> does nothing in the Linux webview: Save goes through save_file_dialog.
  assert.match(screen, /savePictureUrl\(job\.url, job\.ts\)/);
  assert.doesNotMatch(screen, /imageRun\.savePicture\(/);
  assert.match(screen, /className="image-preview" role="dialog"/);
  assert.match(screen, /e\.key === 'Escape'\) setPreview\(null\)/);
  assert.match(screen, /setGallery\(\(prev\) => prev\.filter\(\(j\) => j\.ts !== job\.ts\)\)/);
  const chat = read('desktop', 'src', 'screens', 'ChatScreen.tsx');
  assert.doesNotMatch(chat, /imageRun\.savePicture\(/, 'Chat pictures save the same way');
  const save = read('desktop', 'src', 'files', 'save.ts');
  assert.match(save, /export async function savePictureUrl/);
  assert.match(save, /invoke\('save_file_dialog'/);
});

test('LoRAs: kept per machine, sent by name with a clamped strength, never as prompt tags', () => {
  require('../desktop/src/image-run.js');
  const run = globalThis.FreeAI4UImageRun;
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  assert.deepEqual(run.readLoras(storage), []);
  run.writeLoras([{ name: 'style.safetensors', multiplier: 5 }, { name: '' }], storage);
  assert.deepEqual(run.readLoras(storage), [{ name: 'style.safetensors', multiplier: 2 }], 'clamped, blanks dropped');
  const body = { prompt: 'a cat', width: 512, height: 512 };
  const job = run.withLoras(body, [{ name: 'style.safetensors', multiplier: 0.8 }], ['style.safetensors']);
  assert.deepEqual(job.loras, [{ name: 'style.safetensors', multiplier: 0.8 }]);
  assert.equal(job.prompt, 'a cat', 'no <lora:> tag: sd-server ignores them');
  assert.equal(run.withLoras(body, [{ name: 'gone.safetensors', multiplier: 1 }], ['other.safetensors']).loras, undefined, 'a LoRA no longer there is dropped');
  const src = card();
  assert.match(src, /call<[^>]*>\('sd_import_loras'\)/);
  assert.match(src, /'sd_delete_lora', \{ name \}/);
  const rs = sdRs();
  assert.match(rs, /"--lora-model-dir"/);
  assert.match(rs, /pub fn sd_loras/);
  assert.match(read('desktop', 'src-tauri', 'src', 'main.rs'), /sd::sd_import_loras,/);
});

// 2026-09-29: free services only, and none whose pictures came back
// low-quality. The engine is upstream and untouched; the rows are dropped on
// the way to the picker. This PC, once set up, is the default: the best
// pictures this app can get for free, and the only free route that edits.
test('the picker hides NVIDIA, OpenAI, Gemini and Pollinations, whatever the engine reports', () => {
  const rows = images.providerChoices({ providers: [
    { id: 'pollinations', label: 'Pollinations (Free)', ready: true },
    { id: 'cloudflare', label: 'Cloudflare Workers AI', ready: true },
    { id: 'nvidia', label: 'NVIDIA', ready: true },
    { id: 'openai', label: 'OpenAI', ready: false },
    { id: 'gemini', label: 'Gemini', ready: true },
    { id: 'openrouter', label: 'OpenRouter', ready: false },
  ] });
  assert.deepEqual(rows.filter((r) => r.kind === 'server').map((r) => r.id), ['cloudflare', 'openrouter']);
  assert.ok(rows.some((r) => r.kind === 'browser'), 'Puter still rides along');
});

test('This PC is the default once it is set up; a ready server otherwise', () => {
  const server = { id: 'cloudflare', kind: 'server', ready: true };
  const ready = images.localRow({ found: true, binary: '/x/sd-server', model: '/m/flux.gguf' });
  const half = images.localRow({ found: true, binary: '/x/sd-server', model: '' });
  assert.equal(images.chosen('', [ready, server]).id, 'local');
  assert.equal(images.chosen('', [half, server]).id, 'cloudflare');
  assert.equal(images.chosen('cloudflare', [ready, server]).id, 'cloudflare', 'an explicit pick still wins');
});

// A lone SD 1.5 / SDXL checkpoint published without its VAE: the shell names
// the VAE (sd_vae_for), moves the checkpoint into its own folder
// (sd_set_from_model), the card downloads the VAE beside it with `set` and
// picks the folder -- "Add files as a set" without the file picker.
test('the card offers to fetch and pair the VAE a lone checkpoint lacks', () => {
  const card = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'components', 'LocalImagesCard.tsx'), 'utf8');
  assert.match(card, /call<VaeChoice \| null>\('sd_vae_for', \{ path: chosenPath \}\)/);
  assert.match(card, /call<\{ folder: string; dir: string; path: string \}>\('sd_set_from_model', \{ path: chosenPath \}\)/);
  assert.match(card, /localModelDownload\(\{ repo: vae\.repo, file: vae\.file, kind: 'image', set: moved\.folder \}\)/);
  assert.match(card, /await call\('sd_use_model', \{ path: moved\.dir \}\)/, 'the folder is the model once the VAE is in it');
  assert.match(card, /get \{vae\.label\} and pair it/);
  const rs = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src-tauri', 'src', 'sd.rs'), 'utf8');
  assert.match(rs, /pub fn vae_for\(model: &Path, bytes: u64\) -> Option<VaeChoice>/);
  assert.match(rs, /"stabilityai\/sdxl-vae", "sdxl_vae\.safetensors"/);
  assert.match(rs, /"stabilityai\/sd-vae-ft-mse-original", "vae-ft-mse-840000-ema-pruned\.safetensors"/);
});

// The PC's screen: a LoRA repo's files listed as image models to download
// (then picked, then failing to start), and each row's note wrapped one word
// per line in the Create column.
test('a LoRA repo is offered as LoRAs, into the LoRA folder, never as a model', () => {
  const hf = require('../desktop/src/hf-models.js');
  const card = {
    id: 'someone/portrait-illustration',
    tags: ['diffusers', 'lora', 'text-to-image', 'base_model:adapter:black-forest-labs/FLUX.1-dev'],
    siblings: [
      { rfilename: 'portrait-illustration.safetensors', size: 172 * 1024 * 1024 },
      { rfilename: 'README.md', size: 2000 },
      { rfilename: 'sample.png', size: 90000 },
    ],
  };
  assert.deepEqual(hf.loraBase(card), { base: 'black-forest-labs/FLUX.1-dev' });
  const offer = hf.imageOffer(card);
  assert.equal(offer.rows.length, 1);
  assert.equal(offer.rows[0].lora, true);
  assert.match(offer.rows[0].note, /LoRA for black-forest-labs\/FLUX\.1-dev/);
  assert.equal(hf.loraBase({ id: 'x/sdxl', tags: ['text-to-image', 'diffusers'] }), null, 'a model repo is not one');

  const card_ = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'components', 'LocalImagesCard.tsx'), 'utf8');
  assert.match(card_, /const kindOf = \(row: HubOfferRow\) => \(row\.lora \? 'lora' as const : kind\)/);
  assert.match(card_, /kind: kindOf\(row\),/);
  assert.match(card_, /row\.lora \? 'Download as LoRA' : 'Download'/);
  assert.match(card_, /if \(row\.lora\) \{[\s\S]{0,300}setLoraTick/, 'a LoRA download never becomes the model');
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'bridge.ts'), 'utf8');
  assert.match(bridge, /export type DownloadKind = 'text' \| 'image' \| 'voice' \| 'lora';/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'index.css'), 'utf8');
  assert.match(css, /\.local-row \{[^}]*flex-wrap: wrap;/, 'the size and button drop under the note instead of squeezing it');
  assert.match(css, /\.local-row-main \{[^}]*flex: 1 1 200px;/);
});
