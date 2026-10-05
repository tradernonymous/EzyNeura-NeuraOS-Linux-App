# Local video generation — a phase plan

**Status: planned, not built.** Nothing described here exists in the tree
today. This is the phase plan for adding local text-to-video and
image-to-video to NeuraOS, and it is written to be picked up the way the
other plans are: one numbered item at a time, each with something a test can
hold on to, and a real-Mint pass before the phase is called Done (the rule in
`docs/BACKLOG.md`).

## What ships today, and why it cannot do video

The Images path is complete and local:

- `app/desktop/src/components/LocalImagesCard.tsx` offers FLUX.2 [klein]
  4B/9B and Qwen-Image, downloaded one click from Hugging Face by
  `app/desktop/src/flux-setup.js`.
- `app/desktop/src-tauri/src/sd.rs` runs the person's own `sd-server`
  (stable-diffusion.cpp): it finds the binary, resolves a model **set** by
  role (diffusion + text encoder + VAE, `set_roles`/`set_in`), serves it on
  127.0.0.1, queues jobs and reports what the server says.
- `app/desktop/src/screens/ImagesScreen.tsx` gives that runner a "This PC"
  row that starts on a draw and stops on quit.

`sd-server` cannot draw video, and that is not a configuration gap.
stable-diffusion.cpp is an image pipeline: one latent, one VAE decode at the
end, and its ComfyUI-shaped refusals in `sd.rs` are all about image adapters
(PuLID, IP-Adapter, UNet-only GGUFs). There is no video path anywhere in the
app — a search of `app/desktop/src` and `app/desktop/src-tauri/src` for a
video runner, an `.mp4`, a frame count or ComfyUI finds only image code and
one storyboard *prompt* in `design/social.js`, which draws slides, not video.

So the phase is not "add a model to the existing runner". It needs a runner
that holds a temporal model across a full denoise and then emits frames.

## The runner decision

ComfyUI, run headless and driven over its HTTP + websocket API.

| Option | Why not |
| :-- | :-- |
| Wait for `sd-server` (stable-diffusion.cpp) video support | It does not exist. Building the video DiTs (Wan, LTX, CogVideoX) into sd.cpp is not a phase, it is an upstream project. |
| `diffusers` in a bespoke Python env | Doable, but it is a second framework beside the one the app already relies on for image, and every new model is bespoke glue. |
| A native Rust video pipeline | No maintained crate for these DiTs. Writing one is out of scope by a wide margin. |
| **ComfyUI** (headless, `--listen 127.0.0.1`) | Graph runner the video models already ship official workflows for; a documented API (`POST /prompt`, `GET /history/{id}`, `POST /interrupt`, websocket progress on `/ws`); GGUF quantization via the ComfyUI-GGUF node. |

ComfyUI is Python, so a runtime is unavoidable, but it is the runtime the
models are already packaged for, which is the whole point.

## The models worth targeting

Chosen against the tier the image path already serves (FLUX.2 [klein] 4B, the
"most GPUs take it" default). Licences must be confirmed before anything
ships, the way `LICENSE-NOTICE.md` already records for the skills.

| Model | Kind | Rough VRAM (GGUF) | Licence to confirm | Why it is on the list |
| :-- | :-- | :-- | :-- | :-- |
| **Wan 2.2 TI2V-5B** | text-to-video **and** image-to-video | ~8–12 GB | Wan 2.1 was Apache-2.0 | The best all-rounder at this size, with official ComfyUI workflows. The first target. |
| **LTX-Video 2B distilled** | text-to-video **and** image-to-video | ~6 GB | Lightricks (custom) | The low-VRAM and speed option: near-interactive on a mid card, softer output. The fallback for smaller GPUs. |
| **CogVideoX ~5B** | text-to-video | heavier, slower | Apache-2.0 (THUDM) | The established open option, but worse than Wan 5B for the same VRAM. Only if a licence rule rules Wan out. |

Not on the list: Z-Image and the Qwen-Image video relatives (heavier than the
tier this app targets), and any hosted video API (this is the local path).

## VRAM reality, stated up front

Video is much heavier than the image tier this app is built around. A single
FLUX.2 klein 4B draw fits in ~6–8 GB; a 5B video model at Q4 GGUF wants
~8–12 GB and produces a few seconds at 480p–720p. On a card under ~8 GB the
honest outcomes are LTX-Video at low resolution, or CPU offload that turns
seconds of video into minutes of waiting. The UI must say which is happening
rather than appear to hang, and the model picker must show the VRAM each
preset needs next to the card it detected — the same honesty the local
model list already practises.

## Phases

Each phase is one PR. Acceptance is what a test or a recorded run can point
at, not "it looked fine".

### V1 — ComfyUI as a managed runtime

- **V1.1 Reuse the runtime manager.** Add a `comfy` kind to
  `src-tauri/src/runtimes.rs` and its `runtime_install` / `runtime_facts`
  flow, exposing the same `runtime-download` progress event the llama.cpp
  download already emits. No second installer.
- **V1.2 Detect before installing.** Like `sd_find`, report an existing
  ComfyUI (a chosen folder, or a `comfy` on PATH) and prefer it. Offer the
  managed install only when nothing is found.
- **V1.3 A doctor line.** Report Python/torch/device, ComfyUI version, and
  whether the Wan/LTX custom nodes are present, with the one command to fix
  each — the shape `doctor` already uses elsewhere.
- **V1.4 Bind to loopback only.** Start with `--listen 127.0.0.1`, never
  `0.0.0.0`, and stop it on quit beside `sd::shutdown`.

Acceptance: with no ComfyUI installed the row offers an install; with one
present it is adopted; a node-level test pins the loopback bind and the
shared runtime event.

### V2 — a video job runner

A new `src-tauri/src/video.rs`, deliberately shaped like `sd.rs` so the two
read the same to a maintainer.

- **V2.1 Prompt and poll.** `video_start` posts a workflow to `/prompt` and
  returns an id; `video_status` reads `/history/{id}`; `video_cancel` posts
  `/interrupt`.
- **V2.2 Progress that is true.** Subscribe to `/ws` and surface the
  sampler's own step count as "sampling n/N", not a fake progress bar.
- **V2.3 Roles, reused.** A video model is a set with the same role idea as
  `sd.rs` (diffusion + text encoder + VAE), so the folder rules and the
  set-picker are shared, not rewritten.
- **V2.4 Fetch and save.** Pull the output file, save it through the existing
  save path, and hand the gallery a path — never a blob in localStorage.

Acceptance: Rust unit tests for the request/response shapes and the id
validation (`valid_job_id` has a video twin); a recorded run on a real
machine for the rest.

### V3 — models, one click, with ceilings

- **V3.1 Presets.** Extend the `flux-setup.js` pattern with a video list
  (Wan 2.2 TI2V-5B GGUF first, LTX-Video 2B distilled second), each with its
  size and its detected-VRAM requirement shown before download.
- **V3.2 Download with ceilings.** Reuse the Hugging Face download and its
  size ceiling; a video model is gigabytes and the ceiling must be explicit,
  not "whatever".
- **V3.3 Disk guard.** Video models and outputs are large; refuse a download
  that will not fit, and show free space, the way the bundle-size gate
  already treats growth as something to be honest about.

Acceptance: node tests for preset selection and the "does it fit" decision;
one download verified by sha256 on a real machine.

### V4 — the UI

- **V4.1 A Video surface.** Either a tab on Images or a sibling screen, with
  the same "This PC" row semantics: the runner starts when a clip is
  requested and stops on quit.
- **V4.2 Prompt, duration, size, frames.** Every control maps to a workflow
  input; nothing is hidden behind "just works".
- **V4.3 Image-to-video.** Attach a first frame (from the gallery, a draw, or
  the screen) — the one capability that most sells local video, and both
  target models support it.
- **V4.4 Play, save, reuse.** The gallery plays the clip, saves it, and can
  feed it back as a first frame.

Acceptance: the screen renders with no engine and no GPU (the "This PC" row
must exist and explain itself, exactly as the image row does when it cannot
run); node tests for the control-to-workflow mapping.

### V5 — reliability and the resource story

- **V5.1 One heavy job at a time.** A mutex between draw and video so two
  VRAM-heavy jobs cannot overlap into an OOM.
- **V5.2 Cancel frees the card.** `video_cancel` plus the ComfyUI
  `/free`-style unload so a cancelled job's VRAM returns.
- **V5.3 Timeouts and crashes.** A bounded wait, a clear error when ComfyUI
  dies mid-job, and the crash report the app already writes.
- **V5.4 State survives a restart.** A clip's job id and status persist, so
  reopening the app does not orphan a running render.

Acceptance: Rust tests for the mutex and the timeout; a recorded
kill-mid-render run.

### V6 — verification and docs

- **V6.1 Evals.** Adversarial prompts for the video path in `evals.js`
  (prompt injection through a first frame's filename, a workflow that asks
  for a remote URL).
- **V6.2 The manual pass.** A hardware checklist for a real Mint machine,
  the way `docs/MASTER_PLAN.md` §7 does for L1 — CI cannot run a video model,
  and the phase is not Done until this is walked.
- **V6.3 Docs.** A `docs/` write-up of what landed and what is unwatched,
  linked from `docs/BACKLOG.md`.

## Non-goals

- Audio, lip-sync, and upscaling — later, if ever.
- A hosted video API. This is the local path beside the local image path.
- Training, fine-tuning, or LoRA training for video.
- Replacing ComfyUI with an in-app graph editor. Presets and the workflow
  inputs V4.2 exposes are the whole surface.

## Verification, honestly

CI cannot run a 5B video model: the ubuntu-22.04 runner has neither the
VRAM nor the time. So the split is the one the image path already uses — what
can be a unit test is one (workflow JSON, id validation, the mutex, the
"does it fit" decision, loopback-only bind), and everything that needs a GPU
is recorded on a real Mint machine and written down. The phase is not Done
on green CI alone.

## Open questions

1. Which ComfyUI distribution to standardise on for V1 — a `comfy-cli` venv,
   a portable build, or an AppImage-style bundle. This is the one decision
   that most affects install size and reproducibility, and it should be made
   with a real Mint machine in reach.
2. Whether Wan 2.2's licence and LTX-Video's licence both clear the bar
   `LICENSE-NOTICE.md` sets, before either is offered by default.
3. Whether the Video surface is a tab under Images or its own space in the
   sidebar. Leaning tab, because it shares the gallery and the "This PC" row.
