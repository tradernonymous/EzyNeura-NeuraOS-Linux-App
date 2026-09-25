#!/usr/bin/env bash
# SessionStart hook (docs/PC_UPGRADE_PLAN.md P4.4): a session starts with the
# local gate runnable -- `npm ci` for app/desktop and `cargo fetch` for the
# shell -- and skips both when nothing changed. Never fails the session: a
# missing tool or no network prints one line and moves on.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" || exit 0

if command -v npm >/dev/null 2>&1; then
  if [ ! -f app/desktop/node_modules/.package-lock.json ] || [ app/desktop/package-lock.json -nt app/desktop/node_modules/.package-lock.json ]; then
    (cd app/desktop && npm ci --no-audit --no-fund >/dev/null 2>&1) && echo "npm ci: done" || echo "npm ci: failed (run it by hand: cd app/desktop && npm ci)"
  else
    echo "npm ci: up to date"
  fi
else
  echo "npm: not installed; the frontend gate needs Node 22+"
fi

if command -v cargo >/dev/null 2>&1; then
  (cargo fetch --manifest-path app/desktop/src-tauri/Cargo.toml >/dev/null 2>&1) && echo "cargo fetch: done" || echo "cargo fetch: failed (offline?)"
else
  echo "cargo: not installed; the Rust gate needs rustup's stable toolchain"
fi
exit 0
