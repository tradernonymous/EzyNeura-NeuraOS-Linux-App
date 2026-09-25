# PC upgrade plan: coding on this Linux Mint machine

The machine-side half of the upgrade plan: Claude Code, a GUI for it, the
skills and plugins it loads, and how it works safely on this PC. The
NeuraOS app's half is `APP_UPGRADE_PLAN.md`.

Researched 2026-09-25 from `claude-skills-collection`,
`claude-reverse-skills`, `serversathome/homelabhero` and `0Chencc/clawgod`;
every claim about Claude Code below was checked against the official docs
the same day (sandboxing, permissions and modes, agent teams, computer
use, hooks, skills, memory, plugin marketplaces, settings reference, LLM
gateways, setup). **Built** means the files are in this repository (see
`pc/README.md`); **on the PC** means a step only the machine can take.

## Pending on the PC

The order for a first sitting, about an hour; nothing here can be done
from a cloud session (no desktop, no systemd user session, no keyring):

1. `bash pc/install-claude-code.sh`, then `claude` once to sign in.
2. `bash pc/install-web-ui.sh`, then open `http://127.0.0.1:3001`.
3. In a session: `/plugin marketplace add khalilbenaz/claude-skills-collection`,
   `/plugin install claude-skills-cloud-ops@claude-skills-collection`,
   `/plugin install claude-skills-security@claude-skills-collection`.
4. `claude mcp add neuraos -- freeai4u-desktop --mcp` (NeuraOS Settings →
   Connectors copies the exact line for the installed path).

Over the week: `bash pc/install-skills.sh`, `bash pc/pc-md.sh` plus the
`@~/.claude/pc.md` line in `~/.claude/CLAUDE.md`, the allowlist from
`pc/settings/readonly-allowlist.json`, `bash pc/safety/install-audit-log.sh`,
`bash pc/safety/sandbox-setup.sh` then `/sandbox`, and the second toggle in
NeuraOS Settings → Desktop control when Claude Code should see the screen.
Then report back what each script printed: that is the verification this
repository cannot do.

## P1 — Claude Code and a desktop GUI for it

- **P1.1 Claude Code, native install.** *Built:* `pc/install-claude-code.sh`
  runs the official installer (`curl -fsSL https://claude.ai/install.sh |
  bash`, self-updating, launcher in `~/.local/bin`), installs `ripgrep`,
  `bubblewrap`, `socat` and `libsecret-tools` from apt, and runs `claude
  doctor`. The docs also offer a signed apt repository
  (`downloads.claude.ai/claude-code/apt/stable`) if Update Manager should
  own the updates instead. Never replace or patch the installed binary.
- **P1.2 The desktop GUI, via HomelabHero's web UI (the one you picked).**
  *Built:* `pc/install-web-ui.sh` + `pc/web-ui.service`. HomelabHero's
  installer is for a fresh Ubuntu container (`hhagent`/`hhvault` users, a
  sudoers rule, a system service on every interface); on this PC only the
  web UI is installed, as your user, from npm
  (`@cloudcli-ai/cloudcli`, claudecodeui, AGPL-3.0, Node 22+) with the
  native-module flag HomelabHero found necessary
  (`--allow-scripts=@cloudcli-ai/cloudcli,better-sqlite3,node-pty,bcrypt`),
  as a **systemd user service** with `HOST=127.0.0.1` and
  `SERVER_PORT=3001` (the package's own variable names; its default `HOST`
  is `0.0.0.0`, which is why the script checks the bind after starting
  it). A Firefox "Install as web app" gives it a window. No VM, nothing on
  the LAN, no new users. HomelabHero's broker and ops skills are not needed
  on one PC; their ideas went into P3.3 and P5.
- **P1.3 NeuraOS as the native desktop for Claude Code.** *Already in the
  app:* Code → Agents (ACP) runs Claude Code in the open folder behind
  NeuraOS's approval cards and notification buttons.
- **P1.4 Other official routes:** claude.ai/code in the browser (these
  cloud sessions), the VS Code or JetBrains extension, and the official
  Claude Desktop app, which the docs now list for Linux too
  (`/docs/en/desktop-linux`); it is a second GUI option to P1.2, not a
  replacement for it. Community repackages are not recommended.

## P2 — the features you asked for, the supported way

ClawGod gets these by patching the Claude Code binary and removing its
safety checks. That is not done here. Checked against the docs:

| Wanted | Supported route on this PC |
| :-- | :-- |
| Agent teams, multi-agent | Subagents in `.claude/agents/` and `/agents`; agent teams are experimental, on with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `env` (the example settings file keeps it `0`: with it on, any named subagent becomes a teammate); NeuraOS's Runs board for parallel runs |
| Auto mode | The documented permission modes: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`; Shift+Tab cycles, `--permission-mode` sets one session, `permissions.defaultMode` the default (`auto` and `bypassPermissions` only from user or managed settings). Auto mode is a server-side classifier on a claude.ai plan |
| Ultraplan, Ultrareview | `/code-review ultra` (cloud review) and `/security-review` exist; no `/ultraplan` command is documented. Plan mode is the planning tool |
| Computer use | In the CLI: macOS only, Pro/Max, the `computer-use` built-in MCP server. On Linux: **built** as P6.2, NeuraOS's own tools over MCP |
| Debug logging, request dumps | `claude --debug`; OpenTelemetry export through the documented `OTEL_*` variables (user or managed settings only, not project settings) |
| Hidden commands | The documented ones exist: `/teleport`, `/remote-control`, `/context`, `/cost`, `/hooks`, `/agents`, `/mcp`, `/sandbox`, `/plugin`, `/doctor`, `/fewer-permission-prompts`, `/model`, `/config`, `/statusline` |
| Feature-flag overrides | Only what the settings reference documents: `env`, `permissions`, `hooks`, `model`, `statusLine`, `sandbox`, `promptCacheTtl`, `autoUpdatesChannel`, `attribution` and the rest |
| Any Anthropic-compatible endpoint, no OAuth | `ANTHROPIC_BASE_URL` plus a credential (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `apiKeyHelper`), per the gateway docs; with a credential set, the claude.ai subscription is not used and the key's owner is billed |
| 1-hour prompt cache | `"promptCacheTtl": "1h"` in settings (in the example file) |
| Removing refusals, URL rules, confirmations | Not available, and not planned |

## P3 — skills and plugins for this PC

- **P3.1 Plugin bundles, not the whole catalogue.** *On the PC.* Every
  installed skill's name and description cost context in every session,
  and the full collection costs about 56,000 tokens. The marketplace is
  `claude-skills-collection` (its `marketplace.json` name), so the install
  ids are `claude-skills-cloud-ops@claude-skills-collection` (about 5,900
  tokens: Linux, systemd, CI) and `claude-skills-security@…` (about
  1,800). `claude-skills-dev` (about 18,600) only for heavy multi-language
  days. The example settings file registers the marketplace through
  `extraKnownMarketplaces` and enables both through `enabledPlugins`. The
  skills are in French with English triggers.
- **P3.2 A personal Linux Mint pack.** *Built:* `pc/skills/linux-mint/`,
  five skills (systemd-manager, bash-scripting, mint-troubleshooter,
  mint-admin, mint-hardening), English, trimmed to Mint, apt, Cinnamon,
  Timeshift, X11 and Wayland; MIT, credited. `pc/install-skills.sh` copies
  them to `~/.claude/skills/`.
- **P3.3 PC-maintenance skills in HomelabHero's style.** *Built:*
  `pc/skills/pc-ops/`: pc-triage first, then read-only pc-vitals, then
  pc-patch, pc-backup, pc-docker, pc-network and pc-security-audit, each
  separating what runs without a prompt from what asks. Written fresh,
  because HomelabHero ships no licence.
- **P3.4 A capability catalogue.** *Built:* `pc/pc-md.sh` writes
  `~/.claude/pc.md` (GPU and VRAM, runtimes, model folders, the local
  servers' ports, the rules of the box); import it with `@~/.claude/pc.md`
  in `~/.claude/CLAUDE.md`, the documented import syntax.
- **P3.5 Fewer permission prompts.** *Built:*
  `pc/settings/readonly-allowlist.json`, a read-only allowlist plus a deny
  list for `~/.ssh`, `~/.gnupg`, `.env` files and destructive commands, in
  the documented rule syntax (`Bash(git log *)`, `Read(~/.ssh/**)`); grow
  it from real transcripts with `/fewer-permission-prompts`.

## P4 — this repository's own skills and hooks

*Built.* Repo skills under `.claude/skills/` load in every Claude Code
session on this repository, locally and in the cloud.

- **P4.1 `verify`**: the whole local gate and the shell traps learned here.
- **P4.2 `run-app`**: the debug build under Xvfb against the real bundled
  engine (`scripts/dev/engine.sh`), with `scripts/dev/screenshot.sh`.
- **P4.3 `steward`**: the PR conventions (draft first, merge after green,
  reset the branch onto main, never touch `engine/`, Windows must keep
  building).
- **P4.4 A SessionStart hook** (`.claude/settings.json`, matcher
  `startup`): `npm ci` and `cargo fetch`, skipped when already fresh, never
  failing the session.
- **P4.5 A skill linter in CI**: `scripts/check-skills.mjs` on
  `.claude/skills/` and both packs (frontmatter, kebab-case name equal to
  the folder, a one-line description of at most 1024 characters, a body of
  at most 500 lines, links that resolve, trigger collisions), as a
  `linux.yml` step and a node test.

## P5 — working safely on this PC

HomelabHero's security model applies well to a desktop:

- **P5.1 Secrets out of the agent's reach.** *Built:*
  `pc/safety/api-key-helper.sh`, an `apiKeyHelper` that reads the key from
  the Secret Service keyring (`secret-tool`), for the case of an API key
  or gateway; the claude.ai login needs none. The same wrapper pattern
  applies to SSH.
- **P5.2 An audit log the agent cannot edit.** *Built:*
  `pc/safety/audit-hook.sh` (a `PostToolUse` hook on `Bash`, reading the
  documented `tool_input.command` from stdin) appending to a root-owned,
  `chattr +a` file that `install-audit-log.sh` creates.
- **P5.3 A sandbox for Bash.** *Built:* `pc/safety/sandbox-setup.sh`
  installs bubblewrap and socat (what the docs name for Linux) and the
  AppArmor `bwrap` profile Mint 22's Ubuntu 24.04 base needs; then
  `/sandbox`, or `"sandbox": {"enabled": true}` in settings (in the
  example file, with `autoAllowBashIfSandboxed` and an `allowedDomains`
  list).
- **P5.4 Nothing listening on the LAN.** *Built into P1.2:* the web UI on
  `127.0.0.1` with a post-start check; other devices reach it through an
  SSH tunnel or Remote Control.

## P6 — Claude Code and NeuraOS together

- **P6.1 NeuraOS as an MCP server** (already built):
  `claude mcp add neuraos -- freeai4u-desktop --mcp` gives Claude Code
  status, local models, chat on free models, image generation and open.
- **P6.2 Desktop control over MCP.** *Built:* `neuraos_screenshot` (an
  image result plus its size, the coordinate space) and `neuraos_desktop`
  (click, type, key, move, scroll) on the same server, through the same
  checks as the Chat tools. Off until the second toggle in Settings →
  Desktop control writes its marker file; the per-call Allow is Claude
  Code's own MCP prompt, since the `--mcp` process has no window. Linux
  computer use with nothing patched.
- **P6.3 Local models for side jobs.** *Dropped:* the gateway docs state
  that routing Claude Code to non-Claude models through a gateway is not
  supported. The supported way to hand a summary or a commit message to a
  local model from Claude Code is the `neuraos_chat` MCP tool, which P6.1
  already provides.
