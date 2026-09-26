# App upgrade plan: NeuraOS Linux

The NeuraOS app's half of the upgrade plan. The machine-side half (Claude
Code, its GUI, skills and safety on this PC) is `PC_UPGRADE_PLAN.md`.
Researched 2026-09-25; **built 2026-09-26** — every phase below is
implemented. What landed, what CI proved, and what is still unverified
is written down in `docs/UPGRADE_WAVE_2.md`. The five follow-ups
approved earlier (push/pull, amend/unstage, FLUX.2 first run, HF token
test, Qwen-Image) are phase E.

## What was researched, and what was taken

| Repository | What it is | Taken |
| :-- | :-- | :-- |
| `khalilbenaz/claude-skills-collection` (MIT) | 348 SKILL.md skills in 34 categories, French with English triggers, sold as seven Claude Code plugin bundles; build scripts lint every skill, lint routing between skills, estimate each bundle's context cost, and render HTML manuals | Most of the ideas below: bundles with a context cost, the skill linter, the routing linter, manuals, the Linux skills, concise mode, the agent patterns |
| `haikow/claude-reverse-skills` | Five reverse-engineering skills (radare2, IDA, APK, JS, general) with `.sh` + `.ps1` helper scripts and an installer that copies them into `~/.claude/skills` | Structure only: prerequisite tools listed per skill, scripts made executable on install, "Do not use when…" in the description, reference files read "after triage, not before", an output contract and a task-artifacts list per job. Its notes on unpacking Tauri apps feed the release hardening in D1 |
| `serversathome/homelabhero` (no licence file) | One command that turns an Ubuntu container into a Claude Code command centre: Claude Code plus a browser UI, ops skills, and a credential broker so the agent reaches hosts over SSH without ever reading a key | Ideas only, since there is no licence: the broker pattern (C10), read-only allowlist presets (C11), a doctor screen (D6), an audit log the agent cannot read (C12) |
| `0Chencc/clawgod` | A patch that replaces the official Claude Code binary and removes its safety guardrails | **Nothing.** It defeats safety measures and swaps a signed binary; NeuraOS does not borrow from it |

The reverse-engineering skills themselves are not adopted: APK, IDA and
Frida tooling has no place in a desktop assistant's defaults.

What NeuraOS already has, so the plan builds on it rather than beside it:
the engine parses SKILL.md with an auto-router and pinning (`chatlib.js`,
upstream, never hand-edited); `hf-skills.js` installs Hugging Face skills
into `.neuraos/skills` with size ceilings; the composer has a Skills chip;
`.neuraos/commands/*.md` are the project's own tasks; `evals.js` exists.

Phase A, this repository's own skills and session hook, moved to the PC
plan as P4, so the app phases start at B.

## Phase B — skills inside NeuraOS

- **B1 Install from any GitHub repo or plugin marketplace**, not only
  Hugging Face: read `.claude-plugin/marketplace.json` (`plugins[].skills`)
  or a plain `<name>/SKILL.md` layout, and offer its bundles.
- **B2 Show the context cost before installing.** Every installed skill's
  name and description ride in every prompt. Estimate
  `(name + description) / 4 + 12` tokens per skill, show it on the install
  button and as a running total, and warn past a budget.
- **B3 Lint on install.** Errors block: missing or unreadable frontmatter,
  unknown keys, `name` not the folder or not kebab-case, description over
  1024 characters or multi-line, empty body or over 500 lines, a dead
  relative link, a duplicate description. Warnings show: a short
  description, no quoted trigger, no English trigger.
- **B4 Lint routing across installed skills.** Two skills sharing two or
  more triggers, or a trigger as generic as "code" or "api", compete on
  every prompt. The Skills list flags the pair and offers to disable one;
  a kept pair carries a written reason.
- **B5 Negative triggers.** Show "Do not use when…" from the description
  on the card. Honouring it in routing belongs to the engine, so it goes
  upstream as a proposal rather than a local edit.
- **B6 Which skill would answer this?** A preview in the composer that
  ranks the top three candidates for the draft before sending.
- **B7 Prerequisite doctor.** A skill that lists tools (`compatibility`,
  a Prerequisites section) gets them checked on PATH, each missing one
  with its `apt install` line or the app's one-click runtime; bundled
  `.sh` scripts get the executable bit, `.ps1` ones are skipped on Linux.
- **B8 References on demand.** Install a skill's `references/` folder with
  it, within the existing size ceilings.
- **B9 Manuals.** Render each installed SKILL.md as a readable page in
  Library with a searchable offline catalogue.
- **B10 A Linux Mint pack** offered on first run: the five Linux skills in
  English, paired with the planned systemd-timer schedules (L5).
- **B11 Concise mode** as a toggle on the composer bar, backed by a
  built-in meta skill.
- **B12 Save a chat as a skill.** Turn a finished chat into a SKILL.md in
  `.neuraos/skills`, passed through B3 before it is written.

## Phase C — agents and runs

- **C1 Output contracts.** A recipe states what its final report must
  contain. The Runs board's "Needs review" column ticks each item.
- **C2 Run artifacts.** Each run keeps its evidence (logs, diffs, pages
  fetched) in a folder linked from its card.
- **C3 Budgets.** A token budget per run, the spend on the card, and an
  alert near the limit.
- **C4 Retry with a fallback.** A failed step retries with backoff, then
  on the next free provider, visible in the steps fold.
- **C5 Compare two models** on the same task side by side (the
  Activity-board compare still open under L6).
- **C6 Edit before approve.** The approval card lets the person change a
  tool call's arguments before allowing it.
- **C7 Local traces.** One JSONL line per model call and tool call,
  viewable in Activity, never sent anywhere.
- **C8 Untrusted content marked.** Text from web pages and files is
  labelled untrusted in tool results, against prompt injection.
- **C9 Adversarial evals** added to `evals.js`.
- **C10 A credential broker for tools.** A tool that needs a key or an
  SSH login calls a named operation in the Rust shell; the shell reads
  the secret and returns only the output, so the model never holds it.
- **C11 Read-only presets for approvals.** Allow a list of known
  read-only commands once per project, the way HomelabHero allows only
  its read-only `hh` commands, and keep Ask for everything else.
- **C12 An audit log the agent cannot touch.** Every approved tool call
  appended to a log the model's tools cannot read or rewrite, shown in
  Activity.

## Phase D — release and security hardening

- **D1 Scan the built `.deb` and AppImage** frontend assets for tokens and
  keys in CI. A Tauri app's assets are easy to unpack, so nothing secret
  may be inside ("Secrets never travel").
- **D2 `cargo audit` and `npm audit`** as a CI job, non-gating first.
- **D3 A threat model** for desktop control and the `--mcp` server.
- **D4 Release notes** drafted from merged PRs in `release.yml`.
- **D5 Decision records** in `docs/adr/`, starting with "the engine is
  upstream verbatim".
- **D6 A doctor screen.** One check of everything NeuraOS depends on
  (engine, Node, runtimes, sd-server, git identity, keys present, ports),
  each failure with its fix, like `hh doctor`.

## Phase E — held follow-ups

- **E1 Push and pull** from the Changes panel, remote host checked first.
- **E2 Amend and unstage**, discard behind a confirm.
- **E3 FLUX.2 first-run offer** on the Chat welcome screen.
- **E4 Hugging Face token test** next to the paste field.
- **E5 Qwen-Image on this PC** (details in `BACKLOG.md`).

## Suggested order

1. **Wave 1, small and felt at once:** B2, B3, B7, D6, E4.
2. **Wave 2, the skills store:** B1, B4, B8, B10, B11, B12, E1, E2.
3. **Wave 3, agents and safety:** C1–C4, C6, C8, C10–C12, D1, D2.
4. **Wave 4, the rest:** B5, B6, B9, C5, C7, C9, D3–D5, E3, E5.

Every wave ships as its own PR, green in CI before merge.
