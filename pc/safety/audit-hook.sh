#!/usr/bin/env bash
# P5.2 of docs/PC_UPGRADE_PLAN.md: a PostToolUse hook that appends every
# Bash command Claude Code ran to an append-only log the agent cannot edit.
# stdin is the hook's JSON (tool_name, tool_input.command, cwd, session_id).
# Installed by pc/safety/install-audit-log.sh; never blocks a command.
set -u
LOG="${CLAUDE_AUDIT_LOG:-/var/log/claude-code/commands.log}"
input="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
[ "$tool" = "Bash" ] || exit 0
line="$(printf '%s' "$input" | jq -r '[(now | todate), .session_id, .cwd, (.tool_input.command // "")] | @tsv')"
printf '%s\n' "$line" >> "$LOG" 2>/dev/null || true
exit 0
