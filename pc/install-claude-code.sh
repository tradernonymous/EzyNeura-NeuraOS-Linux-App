#!/usr/bin/env bash
# P1.1 of docs/PC_UPGRADE_PLAN.md: Claude Code on this Linux Mint PC, the
# official native way, plus the tools its sandbox and search want.
# Re-runnable. Never patches or replaces the installed binary.
set -euo pipefail

echo "== apt: ripgrep (search), bubblewrap + socat (the Bash sandbox), libsecret-tools (the keyring CLI)"
sudo apt-get update -qq
sudo apt-get install -y -qq ripgrep bubblewrap socat libsecret-tools curl git

if command -v claude >/dev/null 2>&1; then
  echo "== claude is already installed: $(claude --version)"
  claude update || true
else
  echo "== installing Claude Code (native installer, auto-updates itself)"
  curl -fsSL https://claude.ai/install.sh | bash
fi

# ~/.local/bin is where the installer puts the launcher; Mint's default
# ~/.profile adds it to PATH only if it exists at login.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "note: open a new terminal (or: export PATH=\"\$HOME/.local/bin:\$PATH\") so 'claude' is found" ;;
esac

echo "== claude doctor"
"$HOME/.local/bin/claude" doctor || true
echo
echo "Next: run 'claude' once in a project to sign in, then pc/install-skills.sh and pc/install-web-ui.sh."
