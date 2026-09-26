# Upgrade wave 2: the plan, phase by phase

2026-09-26. Everything `docs/APP_UPGRADE_PLAN.md` still had open — its
phases B (skills), C (agents and runs), D (release and security
hardening) and E (the five held follow-ups) — built and pushed to `main`.
The wave-1 build chain (`docs/UPGRADE_WAVE_1.md`) is the foundation these
stand on.

It is a separate file for the reason wave 1 was: `docs/BACKLOG.md` passed
a thousand lines, so an append lands where an editor can still see it.
The backlog points here.

## What landed, by phase

**B — skills inside NeuraOS (all twelve).** B1 install from any GitHub
repo or marketplace (`56f37f6`), B2 context cost before installing, B3
lint on install, B4 routing collisions across skills (`544c89d`), B5
"Do not use when…" from the description, B6 the composer's *would answer
this* preview, B7 the prerequisite doctor, B8 references installed with
the skill, B9 every installed skill's manual page (`566325f`), B10 the
five-skill Linux Mint pack on the empty chat, B11 Concise mode with a
real meta skill behind the pill (`7038412`), B12 save a finished chat as
a skill. The lint is the gate for every path in: same rules whether a
skill arrives from Hugging Face, GitHub or a hand-written file.

**C — agents and runs (all twelve).** C1 output contracts ticked against
the run's own report, C2 run artifacts in `.neuraos/runs` with a Save
evidence button, C3 budgets with the spend on the card (`3c1ae34`); C4
retry with backoff and a fallback, visible in the steps fold, and C11
read-only presets per project (`92d538e`, `afc9120`); C6 edit the
arguments before approving and C8 untrusted content marked where it
arrives (`2a1d452`); C12 the audit log the model's tools cannot read
(`eb13622`); C7 one local trace line per model and tool call, C9 the
adversarial evals (`e487f8d`); C5 the Activity board comparing parallel
worktree runs, collisions listed first (`3f37e15`); C10 the credential
broker (`99fd4e1`).

**D — release and security hardening (all six).** D1 the built `.deb`
and AppImage scanned for tokens and keys in CI (`c3c18f7`, fixed in
`705a092` — see below); D2 `npm audit` and `cargo audit` (wave 1); D3
`docs/THREAT_MODEL.md` for desktop control and the `--mcp` server, D4
release notes drafted from merged PRs in `release.yml`, D5 four decision
records in `docs/adr/` (`3f8cacc`); D6 the doctor screen (earlier wave).

**E — the five held follow-ups (all five).** E1 push and pull from the
Changes panel with the remote checked first, E2 amend and unstage (both
earlier); E3 the FLUX.2 first-run offer on the empty chat (`7d84490`);
E4 the Hugging Face token test next to the paste field (earlier); E5
Qwen-Image on this PC (`5159903`).

## The three pieces worth reading twice

**C10, the credential broker.** A tool that needs an SSH login or an API
secret names a *saved profile* — `ssh_run(target, command)` and
`http_auth(name, path)` — and `broker.rs` in the shell reads the secret
from the OS keyring, runs the operation, and returns only the output. A
stored private key exists as a 0600 file for exactly the length of the
call, argv is a list (no local shell ever parses it), and an HTTP request
may only go to the address saved with the credential: every redirect hop
is re-checked against that host, so a secret cannot be aimed elsewhere.
Settings → Credentials saves, tests and removes profiles; the index the
card keeps holds names and one display line, never a value. Both tools
show an Allow card every time and their output is marked untrusted.

**C5, the Activity board compares the parallel runs.** Each worktree run
records its `git diff --numstat` when it ends — success or not — because
the worktree may be discarded a minute later. The board renders one
column per run and one row per file, files touched by more than one run
sorted to the top, and Merge on the Parallel screen marks the winner in
the same table.

**E5, Qwen-Image.** The stepper's model step became the *Image model*
step with FLUX.2 and Qwen-Image side by side; the Comfy-Org split repo
lands the 20B model, its VAE and the Qwen2.5-VL 7B encoder as one set,
with the sizes said before anything downloads. `sd.rs family_of` brings
the family's own numbers (cfg 2.5, euler, flow shift 3 — taken from
stable-diffusion.cpp's own `docs/qwen_image.md` example) and
Edit-2511 gets `--model-args qwen_image_zero_cond_t=true` only when the
weights say so. The set matcher gained a *precision family*: fp8 with
fp8, nvfp4 with nvfp4, an unquantized safetensors with bf16 — which also
fixed a real bug the Qwen repo exposed (below).

## Three defects found while building, all fixed here

1. **The secrets scanner read libraries as secrets** (`705a092`). A
   mangled Rust symbol in the compiled binary matched the HF token
   pattern, and the AppImage's bundled libgnutls/libgio carry PEM test
   vectors. The fix gives the token patterns a real word boundary, skips
   third-party `.so` files, and fixes the AppImage extraction path that
   had made that half of the scan silently find nothing (ENOENT).
2. **The set matcher would have downloaded two encoders** (`5159903`).
   `qwen_2.5_vl_7b`, `…_fp8_scaled` and `…_nvfp4` are one encoder in
   three spellings; the stem rule called them three parts, so every
   downloaded set would have carried both a full and a quantized copy.
   NVFP4 joined the stem rule, and parts are now matched by precision
   family instead of by raw quant string — which also stopped a bf16
   model from being paired with whichever encoder was merely smallest.
3. **The broker needed two CI rounds to compile** (`d941b09`,
   `f84817a`). There is no local Rust toolchain on this machine, so the
   first push failed on a sibling-module path and two `Option` unwraps,
   and the second on one of its own test fixtures. CI is the compiler
   here; both rounds are in the history with what they caught.

## Verified where

- **Every push's Linux CI run is green**, the last (`36223336659`)
  covering the final tree: `npm audit`, tsc, the node tests, the skill
  lint, the frontend build, `cargo audit`, `cargo test --locked`,
  `clippy -D warnings`, rustfmt, the bundle-size check, the dist secrets
  scan, the `.deb` + AppImage build, and the Xvfb smoke test.
- **On this machine:** `npx tsc --noEmit` clean; `node --test` 247/247;
  `npm run build` `EXIT=0`; `check-bundle-size` within budget;
  `check-dist-secrets` clean against the fresh dist (181 files).
- **What was NOT verified, plainly:** no real Mint hardware run (the
  §7 checklist stands as this repo's remaining work); no GPU draw of
  FLUX.2 or Qwen-Image from this container; no live SSH host or API
  credential pushed through the broker (the argv/profile/path rules are
  unit-tested, the call itself is not); no live remote exercised by the
  Changes-panel push/pull; and the Hugging Face file names and sizes are
  read from the repo listing **when the box is looked up**, not at build
  time — the container cannot reach huggingface.co to compare.
