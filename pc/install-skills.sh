#!/usr/bin/env bash
# P3.2 + P3.3 of docs/PC_UPGRADE_PLAN.md: copy the two skill packs into
# ~/.claude/skills (personal skills, every project). Re-runnable: an
# existing copy is replaced, a skill you removed from the repo is left.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/skills"
mkdir -p "$DEST"
for pack in linux-mint pc-ops; do
  for skill in "$HERE"/skills/"$pack"/*/; do
    name="$(basename "$skill")"
    rm -rf "${DEST:?}/$name"
    cp -r "$skill" "$DEST/$name"
    echo "installed /$name"
  done
done
node "$HERE/../scripts/check-skills.mjs" "$DEST" >/dev/null 2>&1 && echo "lint: ok" || echo "lint: node not found or a finding; run node scripts/check-skills.mjs $DEST"
echo "Restart Claude Code (or /reload-plugins is not needed: skills are read live). Try /pc-triage."
