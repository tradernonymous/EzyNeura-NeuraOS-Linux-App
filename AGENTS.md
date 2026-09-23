# NeuraOS for Linux Mint — notes for an agent working in this repository

Read this before editing. The plan lives in `docs/MASTER_PLAN.md`; this file
is the rules that are easy to break without knowing them.

## What this is

A native NeuraOS desktop app for Linux Mint, built by importing the Tauri 2 +
React desktop app from `tradernonymous/freeopenai` (the upstream project) and
porting its Windows-only pieces to Linux. `UPSTREAM` pins the exact upstream
commit this was synced from; `scripts/sync-upstream.sh` re-syncs it.

| Where | What |
| :-- | :-- |
| `app/desktop/` | The imported Tauri 2 + React shell, with the Linux delta applied in place (mostly `#[cfg(target_os = "linux")]` blocks and `app/desktop/src-tauri/src/linux.rs`) |
| `app/desktop/src-tauri/engine/`, `src-tauri/src/engine.rs` | The bundled NeuraOS engine (`server.js` and its local dependency closure, zero npm runtime deps) and the Rust glue that finds a Node ≥24 and runs it locally (L3, "Local mode") — see `engine/README.md` |
| `app/shared/`, `app/design/`, `app/assets/branding/` | Imported unchanged from upstream: the keymap, design tokens, and the emblem |
| `docs/MASTER_PLAN.md` | The full plan: the porting audit (section 2), design, architecture, phases L0–L9, packaging, and what the user does themselves |
| `scripts/sync-upstream.sh` | Re-copies `desktop/`, `shared/`, `design/`, `assets/branding/` from upstream at a pinned or given commit |

## Commands

| Task | Command |
| :-- | :-- |
| Frontend deps | `cd app/desktop && npm install` |
| Type-check | `cd app/desktop && npx tsc --noEmit` |
| Build the frontend | `cd app/desktop && npm run build` |
| Rust tests | `cargo test --manifest-path app/desktop/src-tauri/Cargo.toml` |
| Build the `.deb` + AppImage | `cd app/desktop && npx tauri build --bundles deb,appimage` |
| Re-sync from upstream | `scripts/sync-upstream.sh [commit]` |

Build dependencies (already on this machine; a fresh one needs):
`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev libdbus-1-dev patchelf`.

## Rules that bite

- **More than one agent works on this repo.** `git pull --rebase` before
  starting and before pushing. Prefer a PR over pushing straight to `main`
  for anything that will take more than one sitting, so a second session
  finds it before duplicating the work rather than after. Before starting
  a phase, check `docs/BACKLOG.md` and any open PRs — if another session's
  PR already covers it (even partially), read it and build on top rather
  than redoing it; merge it in first if its CI is green. `docs/BACKLOG.md`
  itself merges cleanly almost always (it's append-heavy); a real
  conflict there is a sign two sessions edited the same row; take both
  facts, not one.
- **This repo owns the Linux delta only.** Don't restructure files upstream
  also owns beyond what a phase's checklist in `docs/MASTER_PLAN.md` calls
  for — the next `sync-upstream.sh` has to re-apply the same delta cleanly.
  When a fix belongs upstream (most of the `W1`–`W12` cfg-gating), it should
  eventually go there as a PR so the delta shrinks to nothing; note that in
  the commit rather than doing it silently.
- **Windows must keep building.** Every Linux-only addition goes behind
  `#[cfg(target_os = "linux")]` / `#[cfg(unix)]` / `#[cfg(not(windows))]` as
  the case fits — never edit Windows-only code paths (`mod mica`,
  `webview2.rs`, the `#[cfg(windows)]` branches) except to gate them. There
  is no Windows CI here to catch a regression; read the code twice instead.
- **No Snap.** Mint disables snapd by policy. Packaging is `.deb` (through
  the project's own apt repo, eventually), AppImage, and later Flatpak —
  see `docs/MASTER_PLAN.md` section 8.
- **Zero new runtime dependencies on the bundled engine.**
  `app/desktop/src-tauri/engine/` is upstream's `server.js` and its own
  local files, synced verbatim (`scripts/sync-upstream.sh`) — never hand-
  edited here, and never given an npm dependency it didn't already have.
- **Providers only through official free tiers or the user's own keys.**
  Same rule as upstream, unchanged by the platform.
- **Secrets never travel.** Not into a file, a log, a commit, or a crash
  log line. BYOK keys and the HF token go through the OS keyring
  (`sync-secret-service` on Linux — Secret Service over D-Bus, not the
  `linux-native` keyutils backend, which does not survive a reboot).
- A user-supplied URL is parsed with `new URL()` and its host checked on
  **every** redirect hop, not just the first — carried over from upstream.
- Every phase in `docs/MASTER_PLAN.md` section 7 ends with `cargo test` +
  `npx tsc --noEmit` + `npm run build` green, then the phase's own checklist
  walked on real Mint hardware before it's called done.
- Say "verified" only for a check that actually ran; name what did not.

## Attribution

Never put a model identifier in a commit message, PR title/body, or code
comment — attribution lines are supplied by the harness, not written by hand.
