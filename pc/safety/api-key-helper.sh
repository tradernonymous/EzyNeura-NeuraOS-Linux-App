#!/usr/bin/env bash
# P5.1 of docs/PC_UPGRADE_PLAN.md: Claude Code's apiKeyHelper. Prints the
# API key from the desktop keyring (Secret Service, the same store NeuraOS
# uses), so the key is never in a file, an env var, or a command line the
# agent can read. Only needed when using an API key / gateway instead of the
# claude.ai login.
#
# Store the key once (prompts, nothing echoed):
#   secret-tool store --label="Anthropic API key" service anthropic account claude-code
# Then in ~/.claude/settings.json:
#   "apiKeyHelper": "/home/you/.claude/api-key-helper.sh"
set -euo pipefail
exec secret-tool lookup service anthropic account claude-code
