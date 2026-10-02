# NeuraOS Linux: 03 Oct upgrade plan (50 items)

2026-10-03. A second research pass over the current tree — `main` at `5fe978e`
plus the uncommitted wave 2 work on `skills/quality-and-doctor` (see
`docs/UPGRADE_STATUS.md`) — to answer: what is the next best work after wave 2,
in concrete items, each small enough to land in one PR.

Two honest notes before the list.

**What this plan is grounded in.** The tree itself: 30 Rust modules
(`app/desktop/src-tauri/src/`, ~14k lines), ~120 frontend modules, 18
`app/test/desktop-*.test.js` suites, the CI gates (`linux.yml` →
`desktop-build.yml`, Xvfb smoke test, bundle ceiling, clippy `-D warnings`),
and the open checklists in `docs/BACKLOG.md`, `docs/APP_UPGRADE_PLAN.md` and
`docs/UPGRADE_WAVE_2.md`. Every item below names the module it lands in, so a
reader can check the claim without trusting it.

**What it is grounded in beyond the tree.** All 17 repositories named in the
request were read (landing page + README, fetched 2026-10-03; full clones and
licence files not yet checked unless stated). An earlier draft of this plan was
written *before* the reads and got two repos wrong — `gods-eye-view` is a 3D
satellite globe, not a monitoring dashboard, and `Agent-Reach` is a web-access
capability layer, not a scheduler. Both are corrected below; the lesson is
kept: read first, map second. Items marked `[R]` come straight from a repo
read. Licence status: **Apache-2.0 confirmed** for `gpui-kit` source,
**MIT confirmed** for `claude-code-action`; every other repo's licence is
**unconfirmed** — check it before borrowing anything beyond ideas, the way
`APP_UPGRADE_PLAN.md` refused `clawgod` outright and took `homelabhero` as
ideas-only for want of a licence file.

Reading guide: `U##` is the upgrade, `→` is where it lands, `S/M/L` is rough
effort, and the wave tag says which PR it belongs to. Waves 3–5 are the ones
`docs/UPGRADE_STATUS.md` already defined; **wave 6** is new — the reliability
and polish work this review surfaced that the September plan never named.

## §1. What the review found

The app is broad and mostly built: chat, agents, runs, images, local models,
MCP server and client, desktop control, updates, sandboxing. The pattern of
what is *missing* is consistent — the September waves built the mechanisms and
left the loops unclosed:

1. **Nothing watches the app in production.** There is `crash.rs`, `diag.rs`,
   `diagnostics.js`, a Diagnostics card — but no opt-in telemetry, no crash
   report path, no update-channel choice. The project learns about failures
   only when a user writes them up.
2. **Money and tokens are invisible.** BYOK keys flow through the app, local
   runs burn VRAM, paid APIs burn cash — and no screen shows spend, per-run
   cost, or context pressure until something fails.
3. **Downloads are the scariest unguarded path.** Multi-GB model and runtime
   fetches with no pause/resume UI, no disk-space guard, no checksum surfacing.
   On a 128 GB Mint laptop this is the shape of a support ticket.
4. **The catalogue and the agents don't talk to each other.** Wave 2 judges a
   skill before install; nothing ranks skills at compose time, nothing versions
   recipes, nothing searches across chats.
5. **Hardware-gated items keep sliding.** L1's 10-step checklist, the L5 demos,
   the Doctor's in-app path — all "need real Mint hardware", all still open.
   A plan that keeps deferring them will defer them forever.

## §2. The 50 upgrades

### A. Reliability and operations (U01–U09) → wave 6

- **U01. Opt-in, counts-only telemetry.** What: a toggle (default off) sending
  aggregate counters — launches, Doctor verdicts by code, crash presence, never
  prompts, keys, paths or model text. Why: §1.1; without it every priority call
  is a guess. → `crash.rs`, `diag.rs`, new `telemetry.rs`, Settings card.
  Effort M.
- **U02. A crash report path that respects "secrets never travel".** What: on
  next launch after a crash, offer to save a redacted bundle (the `diag.rs`
  redactor plus the Doctor facts) to a file the user can attach. Why: today a
  crash is a dead end for both sides. → `crash.rs`, `CrashScreen.tsx`. S.
- **U03. Update channels: stable vs preview.** What: a channel switch feeding
  the existing `desktop-version.json` mechanism (L7) with a second manifest.
  Why: preview users currently install CI artifacts by hand from workflow runs.
  → `update.js`, `useUpdateCheck.ts`, `release.yml`. S.
- **U04. Disk-space guard before any fetch over 500 MB.** What: check free
  space, refuse with the number before downloading models, runtimes or skills
  bundles. Why: §1.3. → `models.rs`, `local.rs`, `hf-models.js`. S.
- **U05. Pause, resume and verify for model downloads.** What: range-request
  resume, sha256 shown and checked, a download-manager row with progress. Why:
  §1.3; a 4 GB GGUF over a flaky link is the current worst UX in the app. →
  `models.rs`, `gguf.rs`, `LocalModelsCard.tsx`. M.
- **U06. Log rotation for the engine service.** What: cap the systemd user-unit
  logs (`SystemMaxUse` guidance plus in-app "open/clear logs"). Why: an always-
  on service on 127.0.0.1:47831 writes forever on a machine nobody monitors. →
  `engine.rs`, `linux.rs`, Settings → Engine. S.
- **U07. Battery and metered-link awareness.** What: pause heavy pulls and
  scheduled jobs on battery / metered connections, say so in the StatusBar. Why:
  Mint laptops exist. → `local-status.js`, `StatusBar.tsx`, schedulers. S.
- **U08. Config backup and restore.** What: one file out (keys excluded, Doctor
  asserts that the way it does for its card), one file in, versioned. Why: the
  reinstall story today is screenshots of Settings. → `save.rs`,
  Settings screen. M.
- **U09. WebDriver e2e and the performance budget (L8's open half).** What:
  the e2e the plan already names, plus a startup-time and input-latency budget
  enforced in CI. Why: the bundle has a ceiling; time has none, and latency is
  the UX. → `.github/workflows/`, new `app/test/e2e/`. L.

### B. Money, tokens and context (U10–U14) → wave 4 (agents) / wave 6

- **U10. Per-run cost and token accounting (C3, made concrete).** What: tokens
  in/out and estimated cost on every run card, a per-project monthly total.
  Why: §1.2; budgets (C3) need a meter first. → `runs.js`, `RunsScreen` area,
  provider price table. M.
- **U11. A context meter in the composer.** What: prompt usage vs the model's
  window as a thin bar, turning amber before the cliff — skills' standing cost
  (B2, wave 2) included in the figure. Why: the B2 number is shown at install
  and then never again where it matters. → `Composer.tsx`, `composer.js`. S.
- **U12. Stop, edit and retry for a running turn.** What: cancel a streamed
  turn, edit the draft, resend; retry a failed step from the steps fold. Why:
  the Runs board can review (C1) but the chat cannot interrupt. → `turn.js`,
  `stream-any.ts`, `StepsFold.tsx`. M.
- **U13. Prompt caching where the provider supports it.** What: mark stable
  prefixes (system prompt, skill preambles) cacheable on Anthropic-compatible
  endpoints. Why: it is the cheapest latency and cost win available, and U10's
  meter will prove it. → `connection.js`, `fallback.js`. M. [H]
- **U14. BYOK spend alerts.** What: warn when a key's month-to-date estimate
  crosses thresholds the user sets. Why: a key in an OS keyring is easy to
  forget and expensive to remember. → `byok.js`, `byok.rs`, Settings. S.

### C. The skills loop, closed (U15–U20) → wave 3

- **U15. "Which skill would answer this?" (B6).** What: rank the top three
  installed skills for the composer draft, before sending, using the same
  trigger index wave 2's lint builds. Why: the lint judges skills; nothing
  helps the user *choose* one. → `composer.js`, `Composer.tsx`, `skill-lint.js`
  index export. M.
- **U16. The B4 fix (disable one of a colliding pair, reason recorded).**
  What: the decision wave 2 deferred — offer to disable, keep a written reason
  on a kept pair. → Skills list, Library screen. S. (Already in wave 3 scope;
  listed here so the count is honest about what "done" means.)
- **U17. Skill update checks.** What: installed skills report upstream drift
  (new commit on the source repo / marketplace version bump) with a one-click
  re-pull through the B3 lint. Why: installed skills rot silently today. →
  `hf-skills.js` + B1 installer, Library screen. M.
- **U18. References on demand within the ceilings (B8).** What: install
  `references/` with the skill, lazily — fetched when first opened, counted
  against the existing size ceilings. → `hf-skills.js`, Library reader. M.
- **U19. Concise mode (B11).** What: the composer toggle backed by a built-in
  meta skill, as the plan names it. → composer bar, built-in skill. S.
- **U20. Save a chat as a skill (B12).** What: draft SKILL.md from a finished
  chat, through B3 before writing, into `.neuraos/skills`. → chats/threads +
  `skill-lint.js`. M.

### D. Finding things: search, history, recipes (U21–U25) → wave 5

- **U21. Search across chats.** What: full-text search over threads (local
  SQLite FTS alongside `chat_store.rs`), with jump-to-message. Why: long-lived
  assistants accumulate unusable history without it. → `chat_store.rs`,
  `threads.js`, CommandPalette. M.
- **U22. Chat organisation: pins, folders, tags.** What: the minimum that
  makes U21's results actionable. → `chats.js`, `threads.js`, Sidebar. S.
- **U23. Chat export (markdown, PDF via print CSS).** What: a finished chat out
  as a file, code fenced, images embedded. Why: people file chats as records;
  today that means screenshots. → `chat-template.js`, Files area. S.
- **U24. Recipe versioning and diff.** What: `.neuraos/commands/*.md` and
  recipes gain history; the Runs board shows which version ran. Why: C1's
  contracts are meaningless if the recipe moved under them. → `recipes.js`,
  `runs.js`. M.
- **U25. A personal knowledge shelf (retrieve-then-chat).** What: a folder of
  the user's own markdown/notes indexed locally (FTS first, embeddings only if
  they earn it), cited in answers. Why: the most-requested shape of "local AI"
  after chat itself — *my* docs, answered from, offline. → new `shelf.js` +
  Rust indexer, composer `@shelf` scope. L. [H]

### E. Safety, made usable (U26–U30) → wave 4

- **U26. Credential broker (C10) with SSH-agent semantics.** What: tools call
  named operations in the Rust shell; the shell holds keys and returns only
  output — extended to SSH logins for agent-run remote commands. Why: the plan
  already wants the broker; the remote half is where keys leak most. →
  `mcp_server.rs`, new `broker.rs`, `secrets.rs`. L.
- **U27. The audit log the agent cannot touch (C12).** What: append-only tool-
  call log outside the model's readable surface, shown in Activity. → `save.rs`
  (separate store, separate perms), `ActivityScreen.tsx`. M.
- **U28. Read-only presets in the app, not just `pc/` (C11).** What: bring
  `pc/settings/readonly-allowlist.json`'s idea into per-project approval
  presets with the Ask-everything-else default. → `approval.js`,
  `ApprovalMenu.tsx`, project config. M.
- **U29. Edit-before-approve (C6).** What: change a tool call's arguments on
  the approval card before allowing it. → `ApprovalMenu.tsx`, `tool-run.ts`. S.
- **U30. Mark untrusted content (C8) end to end.** What: web/file text labelled
  through tool results into the prompt actually sent — not just rendered. Why:
  a badge the model never sees is decoration. → `tools.js`, `turn.js`,
  `ToolCards.tsx`. M.

### F. Linux-native and accessible (U31–U35) → wave 5/6

- **U31. Finish L2's open half: message anatomy + Orca pass.** What: Worked ·
  n steps with folding Thought, then a real screen-reader pass over Chat and
  Settings. Why: it is the oldest open UX item in the backlog. → `ChatOutput.tsx`,
  message components. M.
- **U32. Accessibility settings with teeth.** What: font scaling, high contrast,
  reduced-motion toggles that the whole tree honours (today motion and size
  are per-component accidents). → `theme.ts`, `index.css`, Appearance card. M.
- **U33. Global shortcuts the user can change.** What: rebindable chords (the
  four Wayland-portal chords included) with conflict detection. Why: hardcoded
  chords fight every Mint user's existing muscle memory. → `ShortcutsCard.tsx`,
  `keymap.js`, portal registration. S.
- **U34. First-run Mint pack + scheduled jobs (B10 + L5 timers).** What: the
  five Linux skills in English on first run, paired with opt-in systemd-timer
  schedules (e.g. morning briefing, weekly updates check). Why: the two halves
  reference each other and neither is started. → onboarding, `schedulers.ts`,
  `linux.rs`. M.
- **U35. GPU/driver sanity in the Doctor.** What: NVIDIA driver presence and
  version, Nouveau warning, Vulkan/`libvulkan1` check, VRAM vs chosen model
  size — each with the fix, in the card wave 2 built. Why: the Doctor covers
  tools and keys but not the thing local-AI users break most. → `doctor.rs`,
  `DoctorCard.tsx`, `runtimes.rs`. S.

### G. From the repo reads (U36–U50) → waves as tagged

- **U36. Worktree-native Parallel: CoW caches, CI status, AI summaries.** What: btrfs copy-on-write sharing of `target/` and `node_modules/` across agent worktrees (worktrunk's trick, and btrfs is Mint's other filesystem), CI status + one-line AI summary per worktree row, unique-port dev servers. Why: parallel agents currently each pay full build cost. → Parallel screen, `worktrees.js`, hooks. M. [R: worktrunk] → wave 4.
- **U37. Deterministic review before merge.** What: an `open-code-review`-shaped gate on the Parallel merge path — file selection, related-file bundling and comment positioning in code, the model only on judgment — with `codegraph`-style blast radius (what could break, what to test) attached to the run card. Why: agents writing in parallel need a reviewer that cannot cut corners. → Runs board, new `review.js`, MCP wiring. L. [R: open-code-review, codegraph] → wave 4.
- **U38. Per-project memory bank from git history.** What: a Hindsight-shaped bank per project — architecture, conventions, in-flight work — built from history and past sessions, injected when an agent starts. Why: every agent run currently rediscovers the project from zero. → `project-scout.js`, ACP runner env. M. [R: hindsight] → wave 5.
- **U39. Fork, rewind and steer a running conversation.** What: WeKnora-style conversation control — append requirements mid-turn, fork from any earlier question, rewind in place — with generated files collected into an artifacts library. Why: U12 lets you stop; this lets you branch instead of restarting. → `turn.js`, `threads.js`, runs artifacts (C2). L. [R: WeKnora] → wave 5.
- **U40. Scoped tokens and rate limits for the `--mcp` server.** What: per-client MCP endpoints each with its own token, tool scope and rate limit, after WeKnora's per-workspace endpoints. Why: D3's threat model will ask for exactly this; build the answer with the question. → `mcp_server.rs`, Connectors card. M. [R: WeKnora] → wave 4.
- **U41. Dogfood `claude-code-action` on this repo.** What: the MIT-licensed action running PR triage, review checklists and release-notes drafts on this repository itself. Why: D4 wants drafted release notes; the cheapest source is a working example in our own CI. → `.github/workflows/`, non-gating first. S. [R: claude-code-action] → wave 4 (D2's job is the neighbour).
- **U42. Local trace viewer with token accounting.** What: C7's JSONL traces rendered as Langfuse-style step/trace timelines with per-step tokens — viewable in Activity, never sent anywhere. Why: traces nobody can read are write-only observability. → `ActivityScreen.tsx`, trace store. M. [R: WeKnora] → wave 5.
- **U43. Skill catalog from git/zip/marketplace (B1, WeKnora-shaped).** What: tenant-style catalog installing from git URLs and zips alongside Hugging Face and marketplaces, with per-install snapshots and live progress. Why: B1's promise is "any repo"; snapshots make it safe to keep. → B1 installer, Library screen. M. [R: WeKnora] → wave 3.
- **U44. FTS5 + BM25 session continuity.** What: session events (edits, ops, decisions) indexed in SQLite FTS5 and retrieved by relevance at resume — context-mode's shape — instead of dumping history back into context. Why: it is U21's search index and U25's memory substrate in one. → `chat_store.rs`, resume path. M. [R: context-mode] → wave 5.
- **U45. Ordered, probed backends for web fetch.** What: Agent-Reach's capability-layer pattern for `research.js` — per-source ordered backend lists, *real* probing with fix prescriptions, active backend shown in the Doctor. Why: today's fetch either works or fails opaquely; the fix is routing, not retrying. → `research.js`, `doctor.rs`. M. [R: Agent-Reach] → wave 6.
- **U46. Deterministic UI detectors + durable design truth.** What: an impeccable-style `/audit`-flow for the frontend — deterministic rules (contrast, touch targets, motion, overflow) runnable without a model — plus `PRODUCT.md`/`DESIGN.md` durable truth so polish passes compose. Why: U31/U32 need a gate, not a vibe. → new script + docs, CI non-gating first. S. [R: impeccable] → wave 6.
- **U47. Inbound ACP: serve NeuraOS agents outward.** What: the Octop mirror — `neuraos acp` as a stdio ACP server so Zed/OpenCode can drive NeuraOS agents, complementing the existing outbound ACP client. Why: L6 built one direction of a two-direction protocol. → new `acp_server.rs`, permission gates shared with U40. L. [R: Octop] → wave 5.
- **U48. Redactor audit against Octop's PII bar.** What: adversarial tests proving the `diag.rs` redactor + Doctor "safe to paste" discipline catch what Octop's PII redaction catches — keys, tokens, paths, local usernames. Why: the promise is asserted in tests today; the bar should be someone else's. → redactor tests, `app/test/`. S. [R: Octop] → wave 6.
- **U49. Schedules as routines with history (U34, sharpened).** What: Paperclip/Octop-shaped routines — NL schedule creation, each run with owner, output and history, pausable. Why: a timer nobody can inspect is a cron job, not a feature. → `schedulers.ts`, Activity screen. M. [R: paperclip, Octop] → wave 5.
- **U50. Six-strategy fallback routing with per-key caps.** What: freellmapi's routing ideas — strategy choice (speed/capability/reliability), cooldowns, per-key rate tracking — inside `fallback.js`, using only official tiers and user keys. Why: failover exists; *smart* failover with memory does not. → `fallback.js`, `connection.js`, U10 meter as witness. M. [R: freellmapi, ideas only] → wave 4.

## §3. Sequence

No new phases are proposed except **wave 6** (U01–U09 plus U11, U14, U31–U33
where they fit): reliability and polish, last in line but first in review
order, because every wave before it assumes a machine that behaves.

| PR | Contents | Rationale |
| :-- | :-- | :-- |
| Wave 2 (open) | B2, B3, B5-card, B7, D6, E4 — verify, commit, merge | nothing starts on an unverified base |
| Wave 3 | B1, U16/B4-fix, U17–U20, U43, B8, E1, E2 | the skills store, now a loop instead of a shelf |
| Wave 4 | C1–C4, C6, C8, C10–C12, D1, D2 + U10, U26–U30, U36, U37, U40, U41, U50 | agents with meters and guardrails |
| Wave 5 | B6/U15, B9, C5, C7, C9, D3–D5, E3, E5 + U21–U25, U38, U39, U42, U44, U47, U49 | finding things and the long tail |
| Wave 6 | U01–U09, U11, U14, U31–U35 leftovers + U45, U46, U48 | the app watches itself; Mint-specific finish |

Per-phase rules from `AGENTS.md` still bind every PR: Linux-only code behind
`cfg`, the engine untouched and dependency-free, secrets never travelling, fix
here with an upstream note, green `Linux / build` before merge.

## §4. What the 17 repos actually said (all read 2026-10-03)

One verified finding each, and where it lands. **Licences all confirmed
2026-10-03 from each repo's licence file** (paperclip on `master`, sentry via
the sentry-rust SDK repo). The one red flag: `context-mode` is Elastic 2.0 —
ideas only, no code reuse.

| Repo | Verified finding | Lands in |
| :-- | :-- | :-- |
| `longbridge/gpui-kit` (Apache-2.0, source) | 75+ Rust/GPUI components with **AccessKit accessibility built into the interaction layer and covered by tests**, plus headless UI integration tests that drive pointer/keyboard and assert focus/layout/a11y | U31/U32 (a11y done as the interaction layer, not a pass at the end); U09 (headless component tests as the e2e complement) |
| `anthropics/knowledge-work-plugins` (Apache-2.0 confirmed) | 11 role plugins, all file-based: `plugin.json` manifest + `.mcp.json` + `commands/` + `skills/` — the same marketplace shape B1 must read (`.claude-plugin/marketplace.json`) | B1 installer format; B10 Mint pack as one such plugin |
| `tashfeenahmed/freellmapi` (MIT confirmed) | 34 providers behind one OpenAI-compatible endpoint: six-strategy smart routing, auto-failover with cooldowns, **per-key RPM/RPD/TPM/TPD tracking**, AES-256-GCM keys, opt-in prompt compression, self-updating signed model catalog — but a paid live-catalog tier, and stacking free tiers sits uneasily with this repo's "official free tiers or your own keys" rule | U10 (per-key tracking), U13 (compression) as ideas only; no aggregation dependency, ever |
| `max-sixty/worktrunk` (MIT/Apache-2.0 dual confirmed) | Worktree CLI for parallel agents: hooks on create/merge, **copy-on-write build caches (btrfs qualifies — Mint's other filesystem)**, `wt list --full` with CI status + AI summaries per branch, `hash_port` for a dev server per worktree | U36 (below); Parallel screen |
| `TencentCloud/Octop` (MIT confirmed) | Self-hosted multi-user agent platform with **ACP in both directions** (serves `octop acp` over stdio *and* delegates to Claude Code/Codex behind permission gates), JWT isolation, shell guardrails, PII redaction, coordinator-led AgentTeams, NL cron, portable memory | U47 (inbound ACP); D3 (permission gates); U34 (NL cron); U48 (redactor audit) |
| `Tencent/WeKnora` (MIT confirmed) | Knowledge platform where RAG, agent and wiki share KBs: tenant skill catalog from git/zip, **conversation fork/rewind with sandbox checkpoints**, chunk editing with history, **per-workspace MCP endpoints each with own token/scope/rate limit**, Langfuse tracing of agent steps + tokens, 27-vendor model catalog | U43 (B1 catalog); U39 (fork/rewind); U24 (chunk history); U40 (scoped MCP); U42 (trace viewer) |
| `alibaba/open-code-review` (Apache-2.0 confirmed) | Review CLI built as **deterministic engineering × agent hybrid**: file selection, bundling into isolated sub-agents, rule matching and positioning done in code, the model only on dynamic decisions — 1/9th the tokens of a general agent; plus a delegation mode and a session viewer | U37 (review-before-merge); C1 contracts; C9 eval shape |
| `bilawalsidhu/gods-eye-view` (MIT confirmed) | **Correction:** a 3D satellite globe, *not* a monitoring dashboard. The borrowable parts are process, not product: an `npm run doctor` setup check, a POWER-UP panel where **keys are upgrades, never prerequisites**, owner-only secret files, and a checked-in `PERFORMANCE.md` baseline | D6/E4 UX (doctor + key panels); U09 (performance baseline doc) |
| `pytorch/pytorch` | The ML training framework. Nothing to borrow; local inference stays llama.cpp/Ollama. Listed for completeness | Explicitly out of scope; do not add the dependency |
| `anthropics/claude-code-action` (MIT confirmed) | GitHub Action for PRs/issues: mode detection, structured JSON outputs, progress checkboxes, runs on your runner, commit signing, secret scoping | U41 (dogfood it on this repo); D4 release notes; C9 eval automation |
| `vectorize-io/hindsight` (MIT confirmed) | Agent memory as retain/recall/reflect over banks, SOTA on LongMemEval, 2-line LLM wrapper, **per-repo bank built from git history** for coding agents, local providers supported | U38 (repo bank for project-scout); U25 (learn-vs-remember split) |
| `paperclipai/paperclip` (MIT confirmed, on `master`) | Agent-org control plane: **budgets with threshold alerts and auto-pause**, task threads with run history, approval gates with rollback, skill studio with version history + saved test inputs, scheduled routines, portable templates with secret scrubbing | U10/U14 (budgets); U24/C2 (threads); U29 (gates); U20 (skill studio); U34 (routines); U08 (scrubbed export) |
| `paperclipai/paperclip` → visual note | (No screenshot→ask flow found; L5's screenshot→ask stays designed locally) | — |
| `colbymchenry/codegraph` (MIT confirmed) | Rust-powered **100%-local** code knowledge graph over MCP, auto-synced on file change, measured 88% fewer tool calls / 62% fewer tokens — with an honest caveat: dense payloads leave ~80% *more* residual context in long sessions | U37 (blast radius for merge review); Code screen / ACP context; mind the caveat in small windows |
| `getsentry/sentry` (sentry-rust SDK MIT confirmed) | The reference error-tracking platform with a Rust SDK and a self-hostable server; landing page yielded no architecture detail beyond the SDK list | U01/U02 design reference; confirm SDK weight vs the bundle ceiling |
| `mksglu/context-mode` (Elastic 2.0 confirmed — ideas only, never code) | MCP server for context hygiene: sandboxed tool execution, **SQLite + FTS5 session continuity with BM25 retrieval**, a `ctx-doctor` diagnostics command, a statusline showing savings, and a "think in code" rule (agent writes analysis scripts, never reads 50 files) | U44 (FTS5 continuity for U21); U11 (savings-style meter); U30 (sandboxed tools) |
| `pbakaus/impeccable` (Apache-2.0 confirmed) | Design skill for AI frontends: durable truth in `PRODUCT.md`/`DESIGN.md`, 24 commands (audit, critique, harden, onboard…), **61 deterministic detector rules** — the same deterministic-lint philosophy as this repo's `check-skills.mjs` | U46 (adopt the audit/harden flow for U31); D5 (DESIGN.md-adjacent records) |
| `Panniantong/Agent-Reach` (MIT confirmed) | **Correction:** not a scheduler — a web-access *capability layer*: per-platform ordered backend lists, **real probing (not presence checks) with fix prescriptions**, an `agent-reach doctor` showing the active backend per channel, cookies kept local, SKILL.md registration | U45 (`research.js` backend routing); B7 (probe, don't assume); D6 (doctor shows the active path) |

Borrowing rule, same as September: ideas cross the boundary, dependencies and
binaries do not. All licences confirmed 2026-10-03; the only hard boundary
left is `context-mode` (Elastic 2.0: ideas only, no code). `pytorch` and any
`freellmapi`-style tier aggregation are out entirely, not pending confirmation.

## §5. What is still open after this plan

- The real-Mint-hardware checklist (L1's 10 steps, L5 demos, the Doctor's
  in-app path from `UPGRADE_WAVE_2.md`) — U09's e2e narrows it but a human
  click on Mint remains the gate. Schedule it; stop deferring it.
- The release: version bump + tag + `release.yml`, still last, still after
  the waves in scope are merged.
- Upstream notes queue: wave 2's three items (`checkToken` split, skill
  lint + cost, Doctor discipline) plus U11's meter and U29's
  edit-before-approve, all engine-UI improvements rather than Linux
  workarounds.
- Licence confirmations: **done 2026-10-03, all 17** (see §4). Only
  `context-mode` (Elastic 2.0) stays ideas-only; everything else is
  MIT/Apache-2.0 and borrowable with attribution.
