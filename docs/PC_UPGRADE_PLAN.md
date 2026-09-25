# PC upgrade plan: coding on this Linux Mint machine

The machine-side half of the upgrade plan: Claude Code, a GUI for it, the
skills and plugins it loads, and how it works safely on this PC. The
NeuraOS app's half is `APP_UPGRADE_PLAN.md`.

Researched 2026-09-25 from `claude-skills-collection`,
`claude-reverse-skills`, `serversathome/homelabhero` and `0Chencc/clawgod`.
Anything marked **(confirm)** is to be checked against the official Claude
Code docs on the day it is set up, because those features move quickly.

## P1 — Claude Code and a desktop GUI for it

- **P1.1 Claude Code, native install.** The official installer puts
  `claude` in `~/.local/bin` and keeps it updated:

      curl -fsSL https://claude.ai/install.sh | bash
      claude doctor

  Plus `ripgrep` from apt. Never replace or patch the installed binary.
- **P1.2 The desktop GUI, via HomelabHero's web UI (the one you picked).**
  HomelabHero installs Claude Code plus claudecodeui (the npm package
  `@cloudcli-ai/cloudcli`), a browser UI with chat, files and a terminal,
  on port 3001. Its full installer is built for a fresh Ubuntu 26.04
  container: it creates the `hhagent` and `hhvault` users, adds a sudoers
  rule and a system service, and serves the UI on every network
  interface. On this PC, skip that and
  install only the web UI, directly on the PC, as your own user: bound to
  `127.0.0.1:3001` and run as a systemd user service. Claude Code gets a
  GUI in the browser (or as a Firefox web-app window), with nothing
  reachable from the LAN and no new users or sudoers rules. The
  installer's native-module fix applies: `npm install -g
  --allow-scripts=@cloudcli-ai/cloudcli,better-sqlite3,node-pty,bcrypt
  @cloudcli-ai/cloudcli`. HomelabHero's host broker and ops skills are
  not needed on a single PC; its ideas feed P3.3 and P5 instead.
- **P1.3 NeuraOS as the native desktop for Claude Code.** Code → Agents
  (ACP) already runs Claude Code in the open folder behind NeuraOS's
  approval cards and notification buttons. Setting it as the default agent
  gives a native window with no web server at all.
- **P1.4 Other official routes:** claude.ai/code in the browser (these
  cloud sessions), and the VS Code or JetBrains extension. An official
  Claude desktop build for Linux is **(confirm)**; community repackages
  are not recommended.

## P2 — the features you asked for, the supported way

ClawGod gets these by patching the Claude Code binary and removing its
safety checks. That is not done here. Most of the same features have an
official route, or NeuraOS supplies them:

| Wanted | Supported route on this PC |
| :-- | :-- |
| Agent teams, multi-agent | Subagents in `.claude/agents/` and `/agents`; the agent-teams setting **(confirm)**; NeuraOS Runs board for parallel runs |
| Auto mode | The official permission modes (Shift+Tab, `--permission-mode`, `defaultMode` in settings); auto mode's requirements **(confirm)** |
| Ultraplan, Ultrareview | The official commands where your plan includes them **(confirm)**; `/code-review` and `/security-review` meanwhile |
| Computer use | Officially macOS-first **(confirm)**. On Linux: NeuraOS's desktop-control tools (xdotool on X11, portals on Wayland, each behind an Allow card) exposed to Claude Code through `freeai4u-desktop --mcp` (see P6.2) |
| Debug logging, request dumps | `claude --debug`, verbose mode, and OpenTelemetry export **(confirm env vars)** |
| Hidden commands (`/teleport` and others) | The documented ones: `/teleport`, `/remote-control`, `/context`, `/cost`, `/hooks`, `/agents`, `/plugin`, `/mcp`, `/statusline` **(confirm list)** |
| Feature-flag overrides | Only what `settings.json` documents: `env`, `permissions`, `hooks`, `model`, `statusLine` |
| Any Anthropic-compatible endpoint, no OAuth | `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` or `apiKeyHelper`, per the LLM-gateway docs |
| 1-hour prompt cache | Only if the docs expose a setting **(confirm)** |
| Removing refusals, URL rules, confirmations | Not available, and not planned |

## P3 — skills and plugins for this PC

- **P3.1 Plugin bundles, not the whole catalogue.** Every installed skill's
  name and description cost context in every session, and the full
  collection costs about 56,000 tokens. Install bundles instead:

      /plugin marketplace add https://github.com/khalilbenaz/claude-skills-collection
      /plugin install claude-skills-cloud-ops   # ~5,900 tokens: Linux, systemd, CI
      /plugin install claude-skills-security    # ~1,800 tokens

  Add `claude-skills-dev` (about 18,600 tokens) only on days of heavy
  multi-language work. The skills are in French with English triggers.
- **P3.2 A personal Linux Mint pack** in `~/.claude/skills/`: English
  rewrites of `systemd-manager`, `bash-scripting-expert`,
  `linux-troubleshooter`, `linux-admin-guide` and `linux-security-hardener`
  (MIT, credited), trimmed to Mint, apt, Cinnamon and Wayland.
- **P3.3 PC-maintenance skills in HomelabHero's style**: triage first,
  then read-only vitals, then patch management, backup and restore,
  docker stacks, network diagnosis, and a security audit. Written fresh,
  because HomelabHero ships no licence.
- **P3.4 A capability catalogue** for this machine (`~/.claude/pc.md`,
  imported from `CLAUDE.md`): GPU, VRAM, runtimes, where the models live,
  the NeuraOS engine port. Every session starts knowing the box.
- **P3.5 Fewer permission prompts.** A read-only allowlist in
  `~/.claude/settings.json`, the way HomelabHero's ops brain allows only
  its read-only `hh` commands. Build it from real transcripts with
  `/fewer-permission-prompts`.

## P4 — this repository's own skills and hooks

Repo skills under `.claude/skills/` load in every Claude Code session on
this repository, locally and in the cloud.

- **P4.1 `verify`**: the whole local gate (tsc, `node --test`,
  `vite build`, `cargo test`, clippy on the touched files) and the shell
  traps learned the hard way (`pkill -f` kills the tool shell; no chained
  `sleep`).
- **P4.2 `run-app`**: the debug build under Xvfb against the mock engine,
  with a screenshot helper. The scratch mock server and screenshot scripts
  move into `scripts/dev/`.
- **P4.3 `steward`**: the PR conventions (draft first, merge after green,
  reset the branch onto main, commit trailers, never touch `engine/`,
  Windows must keep building).
- **P4.4 A SessionStart hook**: `npm ci` and `cargo fetch`, so a session
  starts with the gate runnable.
- **P4.5 A skill linter in CI** for P4.1 to P4.3: frontmatter keys, name
  matches the folder, description of at most 1024 characters on one line,
  a body of at most 500 lines, no dead links.

## P5 — working safely on this PC

HomelabHero's security model applies well to a desktop:

- **P5.1 Secrets out of the agent's reach.** API keys come from the
  keyring through `apiKeyHelper`, never from a file the agent can read or
  from the command line. The same broker pattern applies to SSH: the
  agent runs a named wrapper, and the wrapper reads the key.
- **P5.2 An audit log the agent cannot edit.** A PostToolUse hook appends
  every Bash command to a root-owned, append-only log.
- **P5.3 A sandbox for Bash**: Claude Code's own sandboxing on Linux
  (bubblewrap) **(confirm)**, the same tool NeuraOS already uses.
- **P5.4 Nothing listening on the LAN**: the web UI on `127.0.0.1` only,
  reached from other devices through Remote Control or an SSH tunnel.

## P6 — Claude Code and NeuraOS together

- **P6.1 NeuraOS as an MCP server** (already built):
  `claude mcp add neuraos -- freeai4u-desktop --mcp` gives Claude Code
  status, local models, chat on free models, image generation and open.
- **P6.2 Desktop control over MCP** (new): expose screen capture, click,
  type, key and scroll through the same server, each still behind
  NeuraOS's Allow card. This is Linux computer use without patching
  anything.
- **P6.3 Local models for side jobs**: a small local model behind an
  Anthropic-compatible gateway for summaries and commit messages, per the
  official LLM-gateway docs **(confirm)**. Main coding stays on Claude.

## Suggested order

1. **Today:** P1.1, P1.2 (web UI on localhost), P3.1, P6.1.
2. **This week:** P3.2, P3.4, P3.5, P4.1 to P4.4, P5.1, P5.4.
3. **Next:** P1.3, P3.3, P4.5, P5.2, P5.3, P6.2, P6.3.
