# Upgrade wave 1: the build chain

2026-09-25. The first phase of the upgrade work the user asked for —
performance, UI/UX and reliability, everything in scope including
dependencies (`docs/APP_UPGRADE_PLAN.md` is the app-side plan; this wave is
the foundation the later waves stand on).

It is a separate file rather than a `docs/BACKLOG.md` section because the
backlog is 66 KB and the editor used here cannot see its last few KB, so an
append would land in the wrong place. `docs/BACKLOG.md` points here.

**Three copies of one build, already drifted.** `linux.yml` and `release.yml`
each carried their own verbatim copy of checkout, node, rust, the Tauri apt
dependencies, `npm ci`, tsc, the node tests, the skill lint, the frontend
build, `cargo test`, clippy and the bundles. They had already diverged: only
the push workflow ran `check-skills` and clippy, and the release path could
therefore ship a tree the gate had never linted, or the reverse. All three are
now one implementation, `.github/workflows/desktop-build.yml`, called by both.
`release.yml` keeps only what is genuinely release-only — the tag-versus-
version check, staging, signing, publishing and the apt repository — and
stages from the shared build's artifact rather than rebuilding.

**Gates that were decoration are now gates.** `clippy` was
`continue-on-error: true`. It is now `-D warnings`, and the tree is clean
under it. Most of what it took to get there is mechanical
(`splitn().nth()` → `split_once()`, `sort_by` → `sort_by_key`, needless
borrows), plus one substantive change in `main.rs`: the close-to-tray handler
was a five-arm `match` on `WindowEvent` whose final arm was `_ => {}`, so it
read as handling several events when it handles exactly one. It is now an
`if let` on `CloseRequested`, which says what it does.

`too_many_arguments` is allowed crate-wide, with a comment saying why: a
Tauri command's parameters *are* the frontend's call signature, so bundling
them into a struct to satisfy the lint would only hide the contract the page
depends on. Every other clippy lint is a real gate.

Added: `npm audit --audit-level=high` and `cargo audit`, and
`cargo test`/`cargo clippy` now run `--locked`.

**Cargo.lock is committed.** It was ignored, on the argument that upstream
does not commit it either. That is right for a library and wrong for a
shipped binary: without it a transitive bump silently changes the `.deb` and
the AppImage people install, and a build is not reproducible from the source
tree alone. CI builds with `--locked`, so the lockfile and the manifest cannot
drift apart.

**Actions are pinned to commit SHAs** across all four workflows, each SHA
checked against GitHub as a real commit, so a compromised or force-moved tag
cannot change what a release build runs. The Rust toolchain deliberately
stays a moving `stable` selector: pinning the compiler would freeze out
security fixes, which is the one thing a build chain should not do.

## Two real defects found while verifying, both fixed

**1. The frontend build died of memory.** `vite build` ended in
`FATAL ERROR: Ineffective mark-compacts near heap limit` on a 2 GB machine.
The cause is the dependency set, not the Vite config: `monaco-editor` is 986
ESM modules / 24 MB and `mermaid`'s dist is 84 MB, so Rollup transforms
~180 MB of `node_modules` — even though *both are already lazy at runtime*
(`CodeEditor.tsx` and `diagram.ts` dynamic-import them, and nothing loads
until a file is opened for editing or a diagram is drawn). The build now asks
for the heap it needs: `node --max-old-space-size=4096`, passed to `node`
directly rather than as a shell env prefix, because upstream still builds on
Windows, where `VAR=value cmd` does not work.

Trimming monaco to `editor.api` plus a language subset would cut the build
cost substantially and was deliberately **not** done. `languageFor()`
discovers languages through `monaco.languages.getLanguages()` precisely so
that arbitrary local files open with the right highlighting; a subset would
silently degrade that instead of failing. The full barrel is the feature, and
the cost is confined to build time and to a chunk nothing loads until it is
needed.

**2. The release path could sign with a key no installed app trusts.** The
test that pins the updater contract failed the moment the key variable moved
into the shared build. That was the test working. It now asserts the wiring
where it lives *and* that `release.yml` still calls the shared build, so
re-inlining a build without the env fails — which is the whole point of it.

**The frontend now has a size ceiling** (`scripts/check-bundle-size.mjs`,
budget in `scripts/bundle-budget.json`). The frontend is embedded in the
binary, so its size is the download, the install and the time to the first
window, and nothing else in the build notices a dependency quietly doubling
it. `--write` re-records the budget, so raising it is a reviewable diff rather
than a constant someone edits in place.

## What was verified, and how

| Check | Result |
| :-- | :-- |
| `cargo test --locked` | 148 passed, 0 failed, 1 ignored (pre-existing) |
| `cargo clippy --locked --all-targets -- -D warnings` | clean |
| `npx tsc --noEmit` | clean |
| `node --test 'app/test/*.test.js'` | 105 passed, 0 failed (98 before) |
| `node scripts/check-skills.mjs` | 15 skills, 0 findings |
| all four workflows parse | ok |
| `app/test/desktop-ci.test.js` | 7 new tests, covering the items below |

The new test pins the one-build rule, the real gates, SHA pinning, the
committed lockfile, the size ceiling and the heap flag — and exercises the
size checker against a temporary `dist` in both directions, so the gate is
tested rather than merely present.

## Not verified here, and said plainly

`npm run build` could not complete in this 2 GB sandbox — it needs the heap
the fix now requests — so the size gate has never run against a *real*
`dist`. The initial budget (30 MB total, 12 MB largest asset) is an estimate
derived from the dependency sizes, not a measurement, and the budget file
says so in its own note.

**The first CI run on this branch should be treated as the measurement.** If
the real `dist` is much smaller than the estimate, tighten the ceiling with
`node scripts/check-bundle-size.mjs --write` and say so in a follow-up: a
budget set at 2× the truth catches nothing.

Whether the OOM was *only* the default heap is also unproven. The
`--max-old-space-size=4096` build has not been watched succeed on a 2 GB
machine, and 4 GB is more than such a machine has. On an ordinary machine
(16 GB, or a 7 GB CI runner) the flag is comfortably within reach.

## Worth an upstream PR

The user's call was "fix here, note for upstream". Each of these is a genuine
upstream improvement rather than a Linux-delta workaround, and all four are
things `freeopenai` would want on Windows too:

1. commit `Cargo.lock` (it is an application, not a library);
2. pin actions to commit SHAs, keeping the compiler itself a moving selector;
3. one shared build called by both the push and the release workflow;
4. make `clippy` a real gate instead of `continue-on-error`.

## Still open for later waves

From `docs/APP_UPGRADE_PLAN.md`, not started here: the skills store and
context-cost work (phase B), agents and runs (phase C), release and security
hardening (phase D), and the held follow-ups (phase E). The Linux-phase
checklist that still needs real Mint hardware is unchanged and remains in
`docs/BACKLOG.md`.
