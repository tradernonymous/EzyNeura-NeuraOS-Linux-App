# 2. The Linux delta lives in place, behind cfg gates

Status: accepted · 2026-09

## Context

The upstream Tauri app targets Windows (Mica, WebView2, Windows-only
commands). Linux Mint needs `#[cfg(target_os = "linux")]` code —
`linux.rs`, portal/EGL/Wayland handling, `.deb`/AppImage packaging — but
this repository still shares most files with upstream and must keep
**Windows building** with no Windows CI here to catch a regression.

## Decision

- The Linux delta is applied **in place** in the imported tree, as
  isolated `#[cfg(target_os = "linux")]` / `#[cfg(unix)]` blocks and one
  `linux.rs` module — never as forked copies of upstream files
  (`main_wine.rs`-style duplication).
- Windows-only paths (`mod mica`, `webview2.rs`, `#[cfg(windows)]`
  branches) are **gated, not rewritten**.
- Frontend/platform additions that upstream could share are plain edits,
  written so the next `sync-upstream.sh` re-applies the same delta cleanly,
  and the ones that fix upstream behaviour are destined for a PR *there*.

## Consequences

- `git diff` against the pinned upstream commit shows the whole Linux
  story as reviewable hunks.
- A change that touches both worlds must be read twice; there is no
  Windows CI in this repository, so "it compiles" is a claim only Linux CI
  makes.
- The delta shrinks over time as fixes land upstream, which is the point.
