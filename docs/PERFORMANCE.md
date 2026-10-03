# Performance budgets (U09)

2026-10-03. Every number the app is held to, where it is enforced, and what
was last measured. Borrowed from `gods-eye-view`'s `PERFORMANCE.md` (MIT):
a checked-in baseline beats a budget nobody wrote down. A budget here is a
CI gate or an in-app label, never a wish — wishes are listed at the bottom
as unwatched.

## The budgets

| Budget | Number | Enforced by |
| :-- | :-- | :-- |
| Cold start to chat-ready | under 2000 ms | in-app: `diagnostics.startupLabel` prints met/missed in Settings → Diagnostics |
| Frontend bundle total | `scripts/bundle-budget.json` (`totalBytes`, per-asset entries) | CI: `node scripts/check-bundle-size.mjs` in the shared build |
| Fresh-asset growth | over `assetGrowth` ratio/bytes needs the budget file updated in the same PR | same check (it diffs against the budget) |
| Linux CI build (compile, test, `.deb` + AppImage, Xvfb smoke) | no hard cap; watched at ~8 min (PR #51: 7m54s) | visible on every PR; a 2× regression is a review question |
| Rust clippy | zero warnings (`-D warnings`, all targets) | CI + local |
| Design-audit findings | at or below `DESIGN_AUDIT_BASELINE` (268 on 2026-10-03, direction down) | informational workflow until zero, then a gate |

## Last measured (2026-10-03, container — not Mint hardware)

- `vite build`: 1m21s with a 4G swapfile on a 2G box (the stock `npm run build`
  OOMs below ~4G; CI runners are fine). This is a build-machine fact, not an
  app budget.
- `cargo test`: 181 passed, 0 failed, 1 ignored in ~0.1s after compile.
- `node --test app/test/*.test.js`: green (see CI for the count; it moves).
- `check-bundle-size.mjs`: within budget.
- Startup marks on real Mint hardware: **unmeasured** — the label exists and
  the 2s target is asserted in `app/test/`, but nobody has read the line on
  the machines in `docs/MASTER_PLAN.md` §7. That reading is the remaining
  half of U09 and belongs to the hardware checklist, not to this file.

## Re-measuring

1. Settings → Diagnostics shows the start-up line after every launch.
2. `node scripts/check-bundle-size.mjs` after `npm run build`.
3. CI prints the Linux build duration on every run; compare against ~8 min.
4. If a budget is wrong (hardware moved on, a dependency ballooned), change
   the number **in the enforcing file** in the same PR as the code that
   needs it, and say why in the commit — the way the bundle budget works.

## Unwatched (admitted, not promised)

- Input latency (keystroke → echo) has no instrumentation; the first step is
  a mark pair in the composer, not a number in this table.
- Model tokens/s is reported per run where measured, with no fleet-wide bar.
- WebDriver e2e from the L8 plan is still open; when it lands, its timings
  feed this file.
