# Where the upgrade stands, and what comes next

2026-09-25, corrected 2026-10-03. A handoff note: what is finished, what is
in flight, and the phases still to do. The plan itself is
`docs/APP_UPGRADE_PLAN.md` plus `docs/UPGRADE_PLAN_03OCT.md`; this file is
the *state* of them, so a new session can pick the work up without reading
every wave write-up.

## One-paragraph summary (2026-10-03 correction)

The September version of this note is obsolete: **a second session has since
landed the entire `APP_UPGRADE_PLAN` scope on `main`** — all of phase B
(skills, incl. B1 `gh-skills.js`, B12 `save-as-skill.js`), all of phase C
(agents, incl. the `broker.rs` credential broker), all of phase D (threat
model, ADRs, release-notes automation, secrets scan) and all of phase E —
with green Linux CI on every push, per `docs/UPGRADE_WAVE_2.md` on `main`
(which is a different, larger document than the same-named file this
session's wave-2 branch carried). The wave-2 branch `skills/quality-and-doctor`
was verified locally (cargo 157, node 172, tsc/clippy/build clean), pushed,
opened as PR #50, then **closed as superseded** rather than merged, per the
repo rule against duplicating another session's landed work. What remains is
**wave 6** (the 03 Oct plan's reliability + polish items, almost all
uncovered on `main`), the **release**, and Mint-hardware verification.

## Finished and merged

| Wave | PR | Contents |
| :-- | :-- | :-- |
| 1 — build chain | `#27` | single build, `cargo clippy` as a real gate, `Cargo.lock` committed and `--locked`, actions pinned to SHAs, bundle-size ceiling, frontend build that no longer dies of memory |

## Retired: the wave-2 branch (kept for the record, do not revive)

2026-10-03: everything below described the `skills/quality-and-doctor`
branch, which was closed via PR #50 (superseded). It is preserved here so a
reader understands what was salvaged and what was dropped. The salvaged
parts live on `wave6-reliability`: `docs/UPGRADE_PLAN_03OCT.md` (licences
confirmed), the `checkToken` split (adapted to `main`'s hf-auth), and this
file. Dropped as duplicates of `main`'s landed work: the skill lint, the
Doctor card, the Rust `doctor.rs` backend (`main` gathers Doctor facts via
its probe command instead — one gathering path, not two), and the E4
button wiring (rebuilt on `main`'s HfSignIn).

## In the working tree, uncommitted (wave 2) — historical

Branch `skills/quality-and-doctor`, based on `main` at `5fe978e`. Ten modified
files, twelve new ones, ~300 insertions in the diff plus the new files.

Modified: `app/desktop/src-tauri/src/main.rs`, `src/bridge.ts`,
`src/components/HfSignIn.tsx`, `src/hf-auth.{js,d.ts}`, `src/index.css`,
`src/screens/LibraryScreen.tsx`, `src/screens/SettingsScreen.tsx`,
`src/settings-groups.js`, `docs/BACKLOG.md`.

New: `src-tauri/src/doctor.rs`, `src/components/DoctorCard.tsx`,
`src/doctor.{js,d.ts}`, `src/skill-lint.{js,d.ts}`, `src/skill-prereqs.{js,d.ts}`,
`app/test/desktop-doctor.test.js`, `app/test/desktop-hf-token.test.js`,
`app/test/desktop-skills-quality.test.js`, `docs/UPGRADE_WAVE_2.md`.

What it is: **B2** (context cost shown before installing), **B3** (a lint that
blocks the install on the failures that mean a skill will never fire), **B5**
(the `Do not use when …` line surfaced on the card), **B7** (a skill's
prerequisites read and named, PATH lookup injected), **D6** (the Doctor card in
Settings → System, three states, a fix on every `bad`), **E4** (a **Test token**
button that verifies without saving).

### Pending tasks for wave 2, in order — retired 2026-10-03

The gates below were run and passed (cargo test 157/1 ignored, clippy
`-D warnings` clean after the `feature = "never"` fix, tsc clean,
node --test 172/172, check-skills 15/0, vite build green within budget),
the branch was pushed and PR #50 opened — then closed as superseded when
`main` proved to already contain the scope with green CI. The original
list is kept verbatim so the verification claim stays checkable.

1. **Re-run the gates.** Nothing here is verified as of this note (2026-09-25):
   `cd app/desktop && npx tsc --noEmit`, `node --test 'app/test/*.test.js'`,
   `cargo test --locked --manifest-path app/desktop/src-tauri/Cargo.toml`,
   `cargo clippy --locked --all-targets -- -D warnings` (from
   `app/desktop/src-tauri`), `node scripts/check-skills.mjs`, and
   `cd app/desktop && npm run build`.
2. **Fix whatever the gates say**, and re-run them. Do not paper over a failure
   by relaxing a test.
3. **Commit on the existing branch** — one commit, message explaining *why*
   (the app should say when something is wrong, in words you can act on), and
   the footer convention the repo uses.
4. **Push and open the PR** for `skills/quality-and-doctor`, and let
   `Linux / build` go green before merging.
5. **Reconcile the write-up's numbers with the real run.** `docs/UPGRADE_WAVE_2.md`
   claims 157 Rust / 172 node tests and a green CI run; if this session's
   numbers differ, fix the document before it ships — a write-up that
   overstates its own verification is worse than no write-up.
6. **Merge to `main`**, `git pull --rebase` first (another agent may have
   landed something), then start the next phase from a clean tree.

## Phases still to do

2026-10-03: waves 3–5 as defined here are **done on `main` by the second
session** (B1–B12, C1–C12, D1–D6, E1–E5, all green in Linux CI). The
wave-by-wave detail below is kept as the record of what was asked, but a
new session must diff against `main` before treating any row as open —
this note already did, and the remaining work is wave 6
(`docs/UPGRADE_PLAN_03OCT.md` §2F–G plus U01–U14) and the release.

From `docs/APP_UPGRADE_PLAN.md`, in the plan's own suggested order. Each is its
own branch, its own PR, green in CI before merge, and a write-up in
`docs/UPGRADE_WAVE_3.md`, `_4.md`, … in the same shape as waves 1 and 2.

### Wave 3 — the skills store (B1, B4, B8, B10, B11, B12, E1, E2)

The biggest of the remaining waves, and worth splitting into two PRs if it will
not fit a sitting: it is the catalogue, the composer and the Changes panel.

- **B1** install from any GitHub repo or plugin marketplace —
  `.claude-plugin/marketplace.json` (`plugins[].skills`) or a plain
  `<name>/SKILL.md` layout, offered as bundles. This is the item the whole
  wave hangs on.
- **B4** the *fix* for what wave 2 only flagged: two skills sharing two or more
  triggers compete on every prompt, so the Skills list offers to disable one,
  and a kept pair carries a written reason. Wave 2 ships the detection; this
  ships the decision.
- **B8** install a skill's `references/` folder with it, inside the existing
  size ceilings.
- **B10** a Linux Mint pack on first run: the five Linux skills in English,
  paired with the planned systemd-timer schedules (L5 in `MASTER_PLAN.md`).
- **B11** concise mode as a composer toggle, backed by a built-in meta skill.
- **B12** save a finished chat as a SKILL.md in `.neuraos/skills`, passed
  through B3 before it is written.
- **E1** push and pull from the Changes panel, remote host checked first.
- **E2** amend and unstage, discard behind a confirm.

### Wave 4 — agents and safety (C1–C4, C6, C8, C10–C12, D1, D2)

The security-flavoured wave. Two of these (C10, C12) are the reason the repo
rule "secrets never travel" is more than a slogan: the credential broker means
the model never holds a key, and the audit log is one the model's own tools
cannot read or rewrite.

- **C1** output contracts, ticked on the Runs board's "Needs review" column.
- **C2** run artifacts — logs, diffs, fetched pages — linked from the run card.
- **C3** a token budget per run, the spend on the card, an alert near the limit.
- **C4** retry with backoff, then the next free provider, visible in the steps fold.
- **C6** edit a tool call's arguments on the approval card before allowing it.
- **C8** mark text from web pages and files as untrusted in tool results.
- **C10** a credential broker: a tool that needs a key calls a named operation
  in the Rust shell, which reads the secret and returns only the output.
- **C11** read-only allowlist presets per project; Ask stays for everything else.
- **C12** an audit log the agent's tools cannot touch, shown in Activity.
- **D1** scan the built `.deb` and AppImage assets for tokens and keys in CI.
- **D2** `cargo audit` and `npm audit` as a CI job, non-gating first.

### Wave 5 — the rest (B5's routing half, B6, B9, C5, C7, C9, D3–D5, E3, E5)

- **B5** *honouring* the negative trigger in routing belongs to the engine,
  which is upstream and never hand-edited here — so it is an upstream proposal,
  not a local edit. The card half shipped in wave 2.
- **B6** rank the top three candidate skills for the composer's draft.
- **B9** render each SKILL.md as a readable page in Library, with a searchable
  offline catalogue.
- **C5** compare two models on the same task (the Activity-board compare still
  open under L6).
- **C7** local JSONL traces, one line per model and tool call, never sent anywhere.
- **C9** adversarial evals in `evals.js`.
- **D3** a threat model for desktop control and the `--mcp` server.
- **D4** release notes drafted from merged PRs in `release.yml`.
- **D5** decision records in `docs/adr/`, starting with "the engine is upstream
  verbatim".
- **E3** a FLUX.2 first-run offer on the Chat welcome screen.
- **E5** Qwen-Image on this PC (details in `BACKLOG.md`).

### Then: the release — in progress on `wave6-reliability`

The user asked for the version bumped and the release cut. That is the last
step of the whole run, not a phase of its own: once the waves that are in
scope are merged, bump the version in `app/desktop/src-tauri/tauri.conf.json`
and the packaging metadata, tag, and let `release.yml` build the `.deb` and the
AppImage. 2026-10-03: the version comes from `package.json` (single source
— `desktop-build.yml` reads it), so the bump is one file plus the tag.

## Carried forward, not yet done

From `docs/UPGRADE_WAVE_2.md`'s own honest list — small, but they are the
things a reader would otherwise assume were finished:

- **The Doctor and the token test have not been watched working in a running
  app.** The logic is unit-tested and the frontend builds, but `doctor_facts`
  shells out through Tauri; that path needs one click on real Mint hardware.
- **The prerequisite check in the catalogue is stubbed to "present"** — the
  parsing, the hints and the message are tested, the wiring to a real PATH
  probe is not. The Doctor already gathers the facts it needs, so this is a
  short job.
- **A dead relative link is only checked when the caller can check one** — the
  store has not fetched the sibling files, so the rule runs only with a
  `hasFile` supplied.
- **B7's executable bit on bundled `.sh` scripts is not done** — it needs a
  `chmod` through the shell and a decision about what it means for a file in a
  user's project; it was left rather than half-done.
- **The Linux-phase checklist that still needs real Mint hardware** is
  unchanged and lives in `docs/BACKLOG.md`.

## Rules this work does not bend

Carried from `AGENTS.md`, because a mid-run handoff is exactly when they get
skipped:

- **PR per phase**, and `git pull --rebase` before starting and before pushing.
  Check `docs/BACKLOG.md` and open PRs first — another session may have covered
  it, and building on top of their PR beats duplicating it.
- **Windows must keep building.** Every Linux-only addition behind
  `#[cfg(target_os = "linux")]` / `#[cfg(unix)]` / `#[cfg(not(windows))]`.
- **The bundled engine is upstream verbatim.** No hand edits, no new npm
  dependency, ever.
- **Secrets never travel** — not into a file, a log, a commit or a crash line.
- **Fix here, note for upstream.** Each wave lists what belongs in
  `tradernonymous/freeopenai` as a PR rather than as a Linux workaround.
- **Say "verified" only for a check that actually ran**, and name what did not.
