---
name: verify
description: Run this repository's whole local gate before a push (tsc, node --test, vite build, cargo test, clippy) and read the failures the way CI would. Use before every commit that touches app/, and whenever CI is red.
allowed-tools: Bash(npx tsc *) Bash(node --test *) Bash(npm run build *) Bash(cargo test *) Bash(cargo clippy *)
---

# verify: the local gate

CI (`.github/workflows/linux.yml`) runs these in this order. Run the same,
from the repository root, and stop at the first red step.

```bash
cd app/desktop && npx tsc --noEmit && cd ../..
node --test 'app/test/*.test.js'
cd app/desktop && npm run build && cd ../..
cargo test --manifest-path app/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path app/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
node scripts/check-skills.mjs
```

Only the last two are not yet hard gates in CI (clippy is
`continue-on-error`); treat them as gates anyway.

## Faster loops

- One Rust module: `cargo test --bin freeai4u-desktop git::` (the module
  path prefix filters the tests).
- One frontend suite: `node --test app/test/desktop-git.test.js`.
- The frontend tests pin source text (they `readFileSync` a `.tsx` and
  `assert.match`), so a rename in the UI breaks a test on purpose: update
  the pin in the same commit.
- `npm ci` before anything if `app/desktop/node_modules` is missing; the
  SessionStart hook does this once per session.

## Shell traps learned here

- Never `pkill -f freeai4u` or `pkill -f node`: it matches the tool's own
  shell and kills the session. Kill by PID (`$!`) or by port
  (`fuser -k 8787/tcp`).
- No chained `sleep` to wait for a build; run it in the foreground with a
  long timeout, or in the background and read its log file.
- `cargo test` for the whole crate builds `generate_context!`, which needs
  `app/desktop/dist`: run `npm run build` first or the Rust step fails with
  a missing-dist error that has nothing to do with your change.
- Xvfb screenshots: see the `run-app` skill; do not launch the app from
  this gate.

## Reading a red CI

1. Which step: the step names in `linux.yml` match the list above.
2. Type-check red: the error names the file; the fix is almost always a
   `.d.ts` in `app/desktop/src/` out of step with a UMD module in
   `app/desktop/src/*.js`.
3. `node --test` red: the assertion prints the file and the pin that no
   longer matches. Decide whether the code or the pin is wrong.
4. Rust red on Linux only: check the `#[cfg(target_os = "linux")]`
   gating. Windows has no CI here; a non-Linux stub must still compile.
5. Smoke test red (`PANIC|FATAL` in the app log): the artifact
   `neuraos-smoke-screenshot-<sha>` shows the window; the log is in the
   step output.

Say "verified" only for a step that ran; name the ones that did not.
