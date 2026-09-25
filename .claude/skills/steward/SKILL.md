---
name: steward
description: This repository's pull-request conventions for an agent driving a change to green and merged - branch, commit trailers, draft PR, CI, merge, and the branch reset afterwards. Use before opening or updating a PR here.
---

# steward: how a change ships here

## Before writing code

- `git fetch origin main && git merge origin/main` (or rebase your own
  unpushed branch). More than one agent works on this repo; check
  `docs/BACKLOG.md` and the open PRs for the same work first.
- Read `AGENTS.md`. The rules that bite: never edit
  `app/desktop/src-tauri/engine/` (upstream, synced verbatim, zero new
  runtime deps); Windows must keep building (`#[cfg(target_os = "linux")]`
  around every Linux-only addition, a stub for the other side); providers
  only via free tiers or the user's own keys; secrets never in a file,
  log, commit or crash line.

## The PR

1. Run the `verify` skill. Push nothing red.
2. Commit with a subject in the imperative and a body that says why; the
   attribution trailers come from the harness. Never a model identifier in
   a commit, PR or code comment.
3. Push with `git push -u origin <branch>`; open the PR as a **draft**,
   body ending with the harness's attribution lines.
4. Subscribe to the PR's activity; wait for the `Linux` workflow.
5. Green: mark ready, merge (merge commit, not squash: the branch history
   is the record), then wait for the `main` run to finish green too.
6. Reset the working branch onto main so the next change starts clean:
   `git fetch origin main && git checkout -B <branch> origin/main &&
   git push --force-with-lease -u origin <branch>`.

## Red CI

- Read the failing step's log before touching anything (the `verify`
  skill lists what each step means).
- A test never gets skipped, disabled or loosened to pass; fix the code or
  the pin, and say which in the commit.
- No empty commits to re-run CI; a real fix re-runs it.

## Docs that travel with a change

- `docs/BACKLOG.md`: append a dated entry for anything finished, held,
  or discovered. It merges cleanly because it is append-heavy; keep it so.
- `README.md`: only when a user-visible feature changed.
- Screenshots in `docs/assets/screens/` come from
  `scripts/screenshot-tour.sh`, never hand-cropped.
