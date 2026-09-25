# pc/: this PC's Claude Code setup

The machine-side half of the upgrade plan (`docs/PC_UPGRADE_PLAN.md`),
as files you run on the Linux Mint PC. Nothing here runs in CI or in the
app; the repository carries it so the setup is written down, reviewed and
versioned like code.

| Step | What | Run |
| :-- | :-- | :-- |
| P1.1 | Claude Code (native installer) + ripgrep, bubblewrap, socat, secret-tool | `bash pc/install-claude-code.sh` |
| P1.2 | The browser GUI (claudecodeui) on `127.0.0.1:3001` as a user service | `bash pc/install-web-ui.sh` |
| P3.1 | Two plugin bundles from claude-skills-collection | in a session: `/plugin marketplace add khalilbenaz/claude-skills-collection` then `/plugin install claude-skills-cloud-ops@claude-skills-collection` and `claude-skills-security@...` (or the `extraKnownMarketplaces` block in `settings/user-settings.example.json`) |
| P3.2 + P3.3 | The Linux Mint pack (5 skills) and the pc-ops pack (7 skills) into `~/.claude/skills` | `bash pc/install-skills.sh` |
| P3.4 | `~/.claude/pc.md`, the capability catalogue, imported from `~/.claude/CLAUDE.md` | `bash pc/pc-md.sh` then add `@~/.claude/pc.md` to `~/.claude/CLAUDE.md` |
| P3.5 | The read-only allowlist and the deny list | merge `settings/readonly-allowlist.json` into `~/.claude/settings.json`; grow it with `/fewer-permission-prompts` |
| P5.1 | API key from the keyring (only with an API key or gateway, not the claude.ai login) | `secret-tool store --label="Anthropic API key" service anthropic account claude-code`; copy `safety/api-key-helper.sh` to `~/.claude/` and set `apiKeyHelper` |
| P5.2 | Append-only audit log of every Bash command an agent runs | `bash pc/safety/install-audit-log.sh`, then the `hooks` block it prints |
| P5.3 | The Bash sandbox's dependencies and the Mint 22 AppArmor profile | `bash pc/safety/sandbox-setup.sh`, then `/sandbox` in a session |
| P6.1 | NeuraOS as an MCP server for Claude Code | `claude mcp add neuraos -- freeai4u-desktop --mcp` (Settings → Connectors in NeuraOS copies it) |
| P6.2 | Desktop control over that MCP server | NeuraOS Settings → Desktop control → the second toggle |

`settings/user-settings.example.json` shows every setting in one
`~/.claude/settings.json`. Order for a first sitting: P1.1, P1.2, P3.1,
P6.1 (about an hour); the rest over the week.

## What is verified where

The scripts were syntax-checked and the skill packs linted in CI
(`node scripts/check-skills.mjs`). They were not run on a Mint machine
from this repository's cloud sessions, which have no desktop, no
systemd user session and no keyring: the first run on the PC is the
verification, and `docs/PC_UPGRADE_PLAN.md` says which claims came from
the Claude Code docs and which from the package's own files.
