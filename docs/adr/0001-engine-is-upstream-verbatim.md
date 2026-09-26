# 1. The engine is upstream, verbatim

Status: accepted · 2026-09

## Context

`app/desktop/src-tauri/engine/` is the NeuraOS engine (`server.js` and its
local dependency closure) imported from `tradernonymous/freeopenai`. It has
zero npm runtime dependencies by design. This repository must eventually
re-sync it with `scripts/sync-upstream.sh`.

## Decision

The engine is **never hand-edited here**. No bug fix, no Linux tweak and no
convenience change goes into `engine/` in this repository; a fix that
belongs to the engine goes upstream and arrives here through a re-sync at a
pinned commit (`UPSTREAM`). The same rule, softened, applies to
`app/shared/`, `app/design/` and `app/assets/branding/`.

## Consequences

- A re-sync is a file copy, not a merge: the Linux delta lives outside the
  synced trees, so `scripts/sync-upstream.sh` stays trivial and safe.
- Engine bugs are fixed twice in time — upstream first — never once here.
  That cost is preferred over carrying a fork only this repository knows.
- Anything the engine must expose to the Linux shell goes through the Rust
  glue (`engine.rs`), not through a patched `server.js`.
- A dependency is never added to the engine: "zero new runtime
  dependencies" is a property of the upstream design, kept by not touching
  it.
