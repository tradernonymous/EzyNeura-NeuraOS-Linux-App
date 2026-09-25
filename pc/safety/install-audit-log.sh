#!/usr/bin/env bash
# Sets up the append-only audit log for pc/safety/audit-hook.sh:
# root-owned directory, a log file you can append to but not truncate
# (chattr +a), and the hook wired into ~/.claude/settings.json.
set -euo pipefail
sudo apt-get install -y -qq jq e2fsprogs >/dev/null
sudo install -d -m 0755 /var/log/claude-code
sudo touch /var/log/claude-code/commands.log
sudo chown root:"$(id -gn)" /var/log/claude-code/commands.log
sudo chmod 0620 /var/log/claude-code/commands.log
sudo chattr +a /var/log/claude-code/commands.log
install -m 0755 "$(dirname "$0")/audit-hook.sh" "$HOME/.claude/audit-hook.sh"
echo "log: /var/log/claude-code/commands.log (append-only; 'sudo chattr -a' to rotate)"
echo "Add to ~/.claude/settings.json (pc/settings/user-settings.example.json shows it in place):"
cat <<'JSON'
  "hooks": {
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/home/YOU/.claude/audit-hook.sh", "timeout": 5 } ] }
    ]
  }
JSON
