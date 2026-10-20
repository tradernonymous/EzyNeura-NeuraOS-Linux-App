# NeuraOS trim plan — compact, light, four pillars (2026-10-18)

Goal: maximum subtraction, minimum addition. Keep only what serves the four
pillars — **chat, tool calling, image generation, video generation** — and
make the result the fastest thing on the box. Every phase is one PR, one
`bundle-budget.json` re-record, one green CI. Nothing here is built yet.

Research basis: full weight map of this repo (frontend 54 307 lines, screens
11 430, components 9 425, Rust 16 387, engine 14 181 lines / 756 KB),
import-graph blast radii, `dist/assets` composition, and a same-day fetch of
upstream `leejet/stable-diffusion.cpp` master (2026-10-18) whose
`examples/server/api.md` + `routes_sdcpp.cpp` + `async_jobs.cpp` were read
directly. Where a claim could not be verified from source it is marked
**verify**.

---

## Phase 0 — verify gates (do first, cheap, blocking)

These are questions whose answer changes which later phases are legal. Answer
each before starting the phase that depends on it.

| # | Question | How to answer | Blocks |
| - | -------- | ------------- | ------ |
| 0.1 | Does the `sd-server` binary the user actually runs match master's `vid_gen` route, or is it an older build? | `GET /sdcpp/v1/capabilities` on the running server; look for `"vid_gen"` in `supported_modes`. The route is present on master today; a user-built binary from months ago may predate it. | Phase 5 |
| 0.2 | Which optional surfaces does Jack actually use? | Ask directly: voice type, desktop control, ACP, evals, recipes, parallel worktrees. Anything "no" is a Phase-3 deletion candidate. | Phase 3 scope |
| 0.3 | Is `feat/create-split-design-image` still wanted, or is it merged-by-another-route / abandoned? | `gh pr list` shows no open PR for it. If abandoned, delete the branch; if wanted, finish it before Phase 2 touches DesignScreen's mermaid path. | Phase 2, 3 |
| 0.4 | Does the app's `docs/BACKLOG.md` L3 "in progress" work conflict with any trim here? | Skim L3 rows; the local-mode work touches `LocalScreen`/`LocalModelsCard`, which Phase 2 also touches (CodeEditor). Sequence Phase 2 after L3 or coordinate. | Phase 2 |
| 0.5 | Is there a `UPSTREAM` file / sync script anywhere outside `app/desktop`? | Full-repo `find` — the prior research found none, and `AGENTS.md`/engine README still reference one. If truly gone, the docs lie and Phase 4 can proceed. | Phase 4 |

---

## Phase 1 — pure subtraction, zero feature loss

Delete or stop shipping things no pillar needs and nothing else depends on.
Each item is independently shippable; do them as one PR or several.

### 1a. Stop loading `katex` (≈1 MB dist chunk, zero app usage)

- `katex` is a transitive dependency of `mermaid` (confirmed in
  `node_modules/mermaid/package.json` deps). No file in `src/` imports it.
- `vite.config.ts` currently forces a `vendor-katex` manual chunk, which
  *guarantees* it ships. Remove that chunk entry; let Vite tree-shake it out
  (mermaid only pulls katex for its math diagram type, which this app never
  renders). If a residual import survives, `resolve.alias` katex → a stub.
- Verify: `dist/assets` no longer contains `vendor-katex*`; bundle budget
  total drops.

### 1b. Stop requiring `fcm-push.js` unconditionally

- `engine/server.js` line 33: `const { parseServiceAccount, sendPush } =
  require('./fcm-push.js');` — 6 KB module, silent no-op unless
  `FCM_SERVICE_ACCOUNT` is set. Desktop Linux never sets it.
- Lazy-require inside the (already no-op) push handler, or `#ifdef`-style
  guard: if `!process.env.FCM_SERVICE_ACCOUNT`, don't load the module at all.
- Keep `fcm-push.js` on disk for anyone who does set the env var; just stop
  paying the parse cost on every boot.

### 1c. Fix stale engine docs that claim an upstream sync exists

- `AGENTS.md` and `engine/README.md` reference an `UPSTREAM` pin and
  `scripts/sync-upstream.sh`; both files are gone (verified: scripts dir has
  neither). The engine is de-facto standalone — recent commits ("standalone
  boot", "remove upstream/freeopenai links") confirm intent.
- Update the docs to say "standalone engine, no upstream sync". This is not
  cosmetic: it unblocks Phase 4's engine surgery, which would otherwise look
  like it re-pins something the next person thinks is auto-synced.

### 1d. Dead code sweep behind the existing gates

- Run `knip`/`ts-prune` once over `app/desktop/src` and delete what it
  flags with zero importers (the import-graph already shows whole modules
  like `runs.js` reachable only from `ActivityScreen` — if ActivityScreen is
  trimmed in Phase 3, the module goes too).
- No new runtime deps: knip/ts-prune are devDependencies only, and the
  engine keeps zero-deps.

**Expected dist delta:** −1 to −1.5 MB. **Node_modules delta:** −0 (katex
stays as a transitive of mermaid until Phase 2 potentially removes mermaid's
math path; the win here is dist + boot parse).

---

## Phase 2 — the single biggest subtraction: get rid of Monaco

### The fact

- `monaco-editor` is **112 MB** of `node_modules` and **10.3 MB of `dist`**
  (67% of the 15.4 MB bundle): `ts.worker.js` 5.8 MB, `vendor-editor` 2.2 MB
  (editor.main), plus json/css/html workers. `scripts/bundle-budget.json`
  spends its two largest entries (`largestAssetBytes` 6 806 525,
  `entryBytes` 1 387 595) almost entirely on Monaco's workers.
- Only **two** files reference it: `components/CodeEditor.tsx` (the whole
  Monaco lifecycle) and `screens/LocalScreen.tsx` (lazy-imports CodeEditor
  for one panel). No chat, no tool-call, no image, no video surface uses it.

### The subtraction

Replace `CodeEditor` with a plain `<textarea>` + a ~50-line syntax
highlighter overlay (or nothing — just a textarea). The Local screen's editor
is for peeking at/editing config and small files, not for being an IDE.

- Delete `components/CodeEditor.tsx`'s Monaco imports; ship a
  `SimpleEditor.tsx` (textarea, Ctrl-S via the existing `onSaved` prop,
  line-number gutter optional).
- Remove `monaco-editor` from `package.json`.
- Remove the `vendor-editor` manual chunk from `vite.config.ts`.
- Re-record `scripts/bundle-budget.json`: `totalBytes` should land near
  **9 MB** (from 19.9 MB ceiling / 15.4 MB actual), `largestAssetBytes` drops
  to whatever `vendor-diagram` or the main `index` chunk now is (~1.2 MB),
  `entryBytes` likewise. Tighten, don't just lower — the budget is the
  regression gate for every later phase.
- Dev-machine bonus: `node_modules` shrinks by ~112 MB; the
  `--max-old-space-size=4096` hack in the `build` script can likely drop back
  to default.

### What this is NOT

Not CodeMirror, not a different editor framework. Any replacement heavier
than a textarea is an addition, and additions are what this plan refuses.

**Expected dist delta:** −10 MB (65%). **Node_modules delta:** −112 MB.
**Build memory delta:** the reason the build needed a 4 GB heap goes away.

---

## Phase 3 — optional-surface removal (the "enough functions" cut)

These are complete verticals — frontend screen + its bridge exports + its
Rust command + its engine endpoints — that are **not** chat, tool calling,
image, or video. Each row below is severable. Column "entangled" is the one
that needs care: import-graph says some of these bleed into ChatScreen.

| Surface | Frontend | Rust | Engine | Entangled with | Verdict |
| ------- | -------- | ---- | ------ | -------------- | ------- |
| Desktop control (screen ask/hotkeys) | ~10 files, `desktopControl.ts`, `DesktopControlCard`, `CheatSheet`, `ShortcutsCard` | `desktop.rs` 769 | — | **ChatScreen** imports it | Delete whole vertical if 0.2 says unused; ChatScreen call sites behind a feature flag or removed |
| Voice type / whisper | 17 files (`voiceType.ts`, `dictate.ts`, `DictationCard`, …) | `whisper.rs` 434 | — | ChatScreen, App | Same — biggest single Rust cut after `sd.rs` |
| ACP (agent client protocol) | 4 files, `AcpScreen` | `acp.rs` 396 | agent-sessions | CodeScreen | Optional; CodeScreen keeps working without it |
| Evals | 10 files, `EvalsScreen` | — | evals endpoints | App (scheduler) | Clean: `evals.js` → schedulers + EvalsScreen only |
| Recipes | 17 files, `RecipesScreen` | — | recipes endpoints | **ChatScreen + Agents + Composer** (6 importers) | Hardest entanglement — extract ChatScreen's recipe hooks into a thin facade first, then delete |
| Parallel / worktrees | 14 files, `ParallelScreen`, `ActivityScreen` bits | — | worktrees endpoints | Activity + Parallel only (`runs.js`, `worktrees.js`, `parallel-compare.js` have no other importers) | Clean delete of Activity + Parallel + those three modules |
| Telemetry / crash bundle | bridge exports only | `telemetry.rs` 142, `crash.rs` 248 | — | StatusBar | Optional; keep crash.rs (reliability pillar), telemetry can go |
| FCM push (frontend + engine) | 0 files | — | `fcm-push.js` | none | Delete outright on Linux-target build; keep file for anyone who wires a service account |

Rules for every row:

1. Delete the screen from `App.tsx`'s lazy imports and `Sidebar.tsx`'s nav.
2. Delete the bridge exports; `bridge.ts` is 1488 lines / 147 exports — each
   vertical removed should take a visible bite.
3. Delete the Rust `#[tauri::command]` + its `invoke_handler` registration.
   `Cargo.toml` has **no feature flags today** (`default =
   ["custom-protocol"]` only) — either add a real `[features]` gate
   (`voice`, `desktop-control`, `acp`, `evals`) so Windows/CI can still build
   the full thing, or just delete outright since this repo owns the Linux
   delta only and the pillars don't need them.
4. Delete the engine route + its test.
5. Run the existing suites: `node --test app/test/*.test.js`, `cargo test`
   (181 passing today — expect the count to *drop*, which is fine; update
   the numbers in `docs/PERFORMANCE.md`).
6. Re-record `bundle-budget.json`.

**Expected dist delta:** −1 to −3 MB depending on how many rows Jack cuts.
**Rust binary delta:** potentially −2 000 lines (`desktop.rs` + `whisper.rs` +
`acp.rs` alone are 1 599).

---

## Phase 4 — engine trim (the 756 KB in the binary)

The bundled engine is `server.js` 310 KB + `chatlib.js` 269 KB +
`agent-sessions.js` 71 KB = 650 KB of the 756 KB total. It's zero-dependency
Node ≥24, loaded into the Tauri process. This phase is surgical, not a
rewrite.

- **Dead routes first.** Same technique as 1d: enumerate every `app.get`/
  `app.post` in `server.js`, grep the desktop frontend's `api.ts` for which
  are actually called (`/api/health`, `/api/llm/chat`, `/api/llm/fetch`,
  `/api/llm/images/*`, `/api/llm/limits`, `/api/llm/models`,
  `/api/llm/providers`, `/api/login`, `/api/logout`, `/api/memory`,
  `/api/session`, `/api/skills*`, `/api/workspace/*`, `/api/build/sessions*`,
  `/api/design/*`, `/api/github/*` — that's the known-used set). Anything
  not on the list and not used by an MCP client is a deletion candidate.
- **Provider surface.** 22 CCE-style providers is a lot of `if
  (provider === '…')` branches. The pillars need: local llama-server,
  Ollama, and whatever cloud provider Jack actually uses (probably one or
  two). Each unused provider branch is pure subtraction — but check
  `docs/MASTER_PLAN.md` first, because "22 providers" may be a deliberate
  product claim. If it is, leave them; they're cheap string branches, not
  modules.
- **`github.js` / auth.js.** Only kept if the `/api/github/*` design export
  path is used. If DesignScreen's "push to repo" is unused, both go.
- **Do not add a bundler, a transpiler, or a framework.** The engine's
  whole value is "one `node server.js`, zero `npm install`". Any step toward
  a build pipeline here is an addition.

**Expected binary delta:** −100 to −300 KB (the .deb is 15 MB; the engine is
a rounding error in the package but a real cost in boot parse time and in
"can a human still read this file" terms).

---

## Phase 5 — video on the runner we already have (reverse VIDEO_PLAN.md)

### What changed since VIDEO_PLAN.md was written

`docs/VIDEO_PLAN.md` says: *"sd-server cannot draw video, and that is not a
configuration gap… Wait for sd-server video support — it does not exist…
ComfyUI."* That was true when written. It is **not true today**.

Verified against `leejet/stable-diffusion.cpp` master, fetched 2026-10-18:

- `examples/server/routes_sdcpp.cpp` registers
  **`POST /sdcpp/v1/vid_gen`** (line ~705), next to `/sdcpp/v1/img_gen`, with
  the identical async-job contract: 202 + `{"id","status","poll_url"}`, then
  `GET /sdcpp/v1/jobs/{id}`, then `POST /sdcpp/v1/jobs/{id}/cancel`.
- `async_jobs.cpp` has `execute_vid_gen_job` calling
  `generate_video(runtime.sd_ctx, …)` and encoding the result with
  `create_video_from_sd_images_to_vector` into mp4/webm/avi, returned as
  base64 with `fps` and `frame_count`.
- `GET /sdcpp/v1/capabilities` reports `supported_modes: ["img_gen",
  "vid_gen"]` (when the loaded model is a video model) and
  `defaults_by_mode.vid_gen` with `video_frames`, `fps`, and
  `output_formats_by_mode.vid_gen` (`avi` is the default; mp4/webm also
  listed).
- Model families confirmed in upstream docs: Wan2.1 / **Wan2.2 TI2V-5B**
  (`-M vid_gen`), LTX-2.3 / LTX-2.5, HunyuanVideo 1.5, MiniMax-H3,
  LingBot-Video. Wan's `docs/wan.md` states: "Wan models require `-M
  vid_gen`… Library callers must use `generate_video()` instead of
  `generate_image()`."

### What the app already has

`app/desktop/src-tauri/src/sd.rs` already speaks this exact protocol for
images: `sd_start` POSTs to `/sdcpp/v1/img_gen`, `sd_job(id)` polls
`/sdcpp/v1/jobs/{id}`, `sd_cancel` hits `/sdcpp/v1/jobs/{id}/cancel`, and
the file header documents the whole API as "verified against
stable-diffusion.cpp's own". The poll loop, the job-id validation, the
cancel path, the `gpu_budget.rs` ledger — all of it is runner-agnostic.

### The addition (this is the "minimum addition" the plan allows)

1. **`sd.rs`: a `sd_vid_gen` command** — same shape as `sd_start`, POSTing
   to `/sdcpp/v1/vid_gen` with `prompt`, `video_frames`, `fps`,
   `output_format` (default `mp4` if the running binary advertises it,
   else whatever `capabilities.output_formats_by_mode.vid_gen[0]` says).
   Roughly +80 lines, no new crate, no new runtime.
2. **Capability probe.** `sd.rs` already calls `/sdcpp/v1/capabilities`
   (`sd_capabilities`, around line 1038). Extend the parsed struct to read
   `supported_modes` and hide/disable the video UI when `vid_gen` isn't in
   the list — which is exactly how the "user's binary is too old" case from
   0.1 gets handled without a crash.
3. **Frontend: a "Video" mode on `ImagesScreen`** (or a sibling
   `VideoScreen` if ImagesScreen is already too big at 1111 lines) — a
   prompt box, frame-count + fps sliders, a "This PC" runner row (reuse the
   existing sd-server row), and a job poll that shows progress the same way
   image jobs do. Output is a single encoded container (mp4/webm/avi), which
   the frontend can hand to a `<video>` tag or save via the existing save
   path.
4. **Model download path.** `flux-setup.js` already does one-click HF
   download for FLUX.2 klein and Qwen-Image. Add Wan2.2 TI2V-5B (GGUF, via
   QuantStack or whatever QuantStack-class repo upstream's `wan.md` points
   at) the same way. **No new downloader** — extend the existing one.
5. **Rewrite `docs/VIDEO_PLAN.md`.** The ComfyUI/Python decision is obsolete.
   Delete the "runner decision" table; state that video rides the same
   sd-server the app already runs, the same `sd.rs` job API, the same
   `gpu_budget.rs` ledger.

### What this phase explicitly does NOT do

- Does **not** add ComfyUI, a Python env, a `diffusers` install, a second
  framework, or a websocket client. Every one of those was on VIDEO_PLAN's
  old table; every one is an addition this plan refuses.
- Does **not** promise HunyuanVideo 1.5 or MiniMax-H3 on day one — those
  models are large; on a 4 GB 1050 Ti, Wan2.2 TI2V-5B at low frame counts is
  the realistic target, and even that will be slow. Say so in the UI the
  same way the image path already states VRAM reality.
- Does **not** build until 0.1 confirms the user's actual sd-server binary
  advertises `vid_gen`. If it doesn't, the phase becomes "prompt the user to
  update their sd-server" (the app already points them at `RELEASES_URL`),
  then retry.

**Expected dist delta:** +~30 KB (one more lazy screen chunk, same order as
`ImagesScreen`'s 28 KB). **Rust delta:** +~80 lines in `sd.rs`. This is the
one phase that adds, and it adds by extending the runner that already exists
rather than standing up a second one.

---

## Phase 6 — lock the budget so none of the above regresses

Every phase above must, in its own PR, re-record
`app/desktop/scripts/bundle-budget.json`. But the budget file alone doesn't
stop a *dependency* from creeping back. Add, once:

- **A `knip` (or `ts-prune`) CI step** that fails on new zero-importer
  modules. Dev-dependency only; engine stays zero-deps.
- **A dep-size tripwire**: a tiny script (no new npm package — `du` in a
  GitHub Action step is fine) that fails the PR if any single
  `node_modules/<pkg>` exceeds, say, 5 MB without an explicit allowlist
  entry. Monaco at 112 MB is how we got here; the tripwire is how we don't
  get a second one.
- **`docs/PERFORMANCE.md` numbers refreshed** after each phase — it
  currently claims cold start <2000 ms and a CI time of ~8 min; both should
  *improve* as Monaco and optional surfaces go, and the doc should say so.

---

## Suggested order and rough cumulative effect

| Phase | One-line | Dist Δ | Risk |
| ----- | -------- | ------ | ---- |
| 0 | Verify gates | — | none |
| 1 | katex, fcm-push, stale docs | −1.5 MB | very low |
| 2 | **Kill Monaco** | **−10 MB** | low (two call sites) |
| 3 | Optional surfaces | −1…−3 MB | medium (ChatScreen entanglement) |
| 4 | Engine dead routes | −100…−300 KB | low, needs care |
| 5 | Video on sd.rs | +30 KB | medium (needs 0.1, new UX) |
| 6 | Budget lock | — | none |

By end of Phase 2 alone, `dist` should sit near **5–6 MB** (from 15.4 MB)
and the bundle-budget ceiling can drop from 19.9 MB to ~9 MB — a number that
then becomes the hard gate nobody can quietly regress. After Phase 3, the
frontend source itself should be under ~45 000 lines (from 54 307), and the
Rust side under ~14 000 (from 16 387).

## What this plan refuses to do (and why)

- **No ComfyUI / Python / second video runtime.** sd.cpp does video now;
  the runner is already here.
- **No editor framework swap.** Monaco goes; a textarea comes. CodeMirror
  would be an addition.
- **No framework migration** (React → Preact/Solid, Tauri → something else).
  The pillars don't care and the rewrite cost is infinite.
- **No new npm or cargo dependencies** in any phase. Dev-dependencies for
  linting/trimming are fine; runtime deps must go down, not sideways.
- **No "while we're in here" features.** If a change doesn't subtract weight
  or serve chat / tool-calling / image / video, it belongs in a different
  plan (`docs/APP_UPGRADE_PLAN.md` still exists for that).
