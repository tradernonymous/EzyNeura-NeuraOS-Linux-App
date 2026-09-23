#!/usr/bin/env bash
# Re-copy desktop/, shared/, design/ and assets/branding/ from
# tradernonymous/freeopenai into app/, at the commit pinned in UPSTREAM (or a
# commit you pass as $1, which also rewrites UPSTREAM).
#
# What this does NOT do: re-apply the Linux delta. After syncing, re-apply
# docs/MASTER_PLAN.md section 2 (W1-W12) to whatever changed upstream, then
# run the phase checklist you are on before committing.
#
# Usage:
#   scripts/sync-upstream.sh                  # sync to the pinned commit
#   scripts/sync-upstream.sh <commit-or-ref>  # move the pin, then sync

set -euo pipefail
cd "$(dirname "$0")/.."

UPSTREAM_URL="https://github.com/tradernonymous/freeopenai.git"
CLONE_DIR="${FREEOPENAI_CLONE:-/tmp/freeopenai-sync}"

if [ "${1:-}" != "" ]; then
  echo "$1" > UPSTREAM.tmp
fi
PIN="$(grep -v '^#' UPSTREAM.tmp 2>/dev/null || grep -v '^#' UPSTREAM)"
PIN="$(echo "$PIN" | tr -d '[:space:]')"

if [ ! -d "$CLONE_DIR/.git" ]; then
  git clone --filter=blob:none "$UPSTREAM_URL" "$CLONE_DIR"
fi
git -C "$CLONE_DIR" fetch origin "$PIN" --depth 1 2>/dev/null || git -C "$CLONE_DIR" fetch origin
git -C "$CLONE_DIR" checkout --detach "$PIN"

RESOLVED="$(git -C "$CLONE_DIR" rev-parse HEAD)"
if [ "$RESOLVED" != "$PIN" ] && [ "${1:-}" = "" ]; then
  echo "warning: HEAD ($RESOLVED) does not match the requested pin ($PIN)" >&2
fi

mkdir -p app/assets
rsync -a --delete --exclude node_modules --exclude dist --exclude target \
  --exclude src-tauri/target --exclude src-tauri/gen \
  "$CLONE_DIR/desktop/" app/desktop/
rsync -a --delete "$CLONE_DIR/shared/" app/shared/
rsync -a --delete "$CLONE_DIR/design/" app/design/
rsync -a --delete "$CLONE_DIR/assets/branding/" app/assets/branding/

{
  echo "# The commit of tradernonymous/freeopenai this Linux port is synced from."
  echo "# scripts/sync-upstream.sh re-copies desktop/, shared/, design/ and"
  echo "# assets/branding/ from this commit into app/. Bump it deliberately, then"
  echo "# re-apply the Linux delta (see app/desktop/src-tauri/src/linux/ and"
  echo "# docs/MASTER_PLAN.md section 2) and re-run the checklist for the phase"
  echo "# you are on."
  echo "$RESOLVED"
} > UPSTREAM
rm -f UPSTREAM.tmp

echo "Synced app/{desktop,shared,design,assets/branding} to $RESOLVED"
echo "Now: re-apply the Linux delta (docs/MASTER_PLAN.md section 2), then:"
echo "  cd app/desktop && npm install && npm run build && cargo test --manifest-path src-tauri/Cargo.toml"
