#!/usr/bin/env bash
# Launch the built app on a virtual X server and capture a screenshot, so a
# UI change can be looked at without a real display -- see docs/BACKLOG.md,
# "A real screenshot, and what it found" (L2).
#
# Needs: xvfb, dbus-x11, scrot (and gnome-keyring, optionally, to also clear
# the "credential store unavailable" warning -- see BACKLOG for why that
# still won't fully resolve headlessly: creating the default keyring
# collection needs an interactive prompt no automation here can answer).
#
# Usage:
#   scripts/screenshot-smoke-test.sh [path-to-binary] [output.png] [wait-seconds]
#
# Defaults to the release build, /tmp/neuraos-screenshot.png, 6 seconds.

set -euo pipefail

BIN="${1:-app/desktop/src-tauri/target/release/freeai4u-desktop}"
OUT="${2:-/tmp/neuraos-screenshot.png}"
WAIT="${3:-6}"
DISPLAY_NUM=":97"

if [ ! -x "$BIN" ]; then
  echo "Not an executable: $BIN (build it first: cd app/desktop && npx tauri build)" >&2
  exit 1
fi
for tool in Xvfb dbus-launch scrot; do
  command -v "$tool" >/dev/null || { echo "Missing $tool (apt install xvfb dbus-x11 scrot)" >&2; exit 1; }
done

Xvfb "$DISPLAY_NUM" -screen 0 1360x900x24 &
XVFB_PID=$!
trap 'kill "$XVFB_PID" "${APP_PID:-}" "${DBUS_SESSION_BUS_PID:-}" 2>/dev/null || true' EXIT
sleep 1

export DISPLAY="$DISPLAY_NUM"
eval "$(dbus-launch --sh-syntax)"
command -v gnome-keyring-daemon >/dev/null && gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1 || true

"$BIN" >/tmp/screenshot-smoke-test.log 2>&1 &
APP_PID=$!
sleep "$WAIT"
# Still running after the wait: a binary that started and died is a failure
# whatever the screenshot shows (CI uses this as its gate, docs/BACKLOG.md L8).
if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "The app exited within ${WAIT}s. Its log:" >&2
  tail -n 40 /tmp/screenshot-smoke-test.log >&2
  exit 1
fi
scrot -o "$OUT"
echo "Screenshot: $OUT"
echo "App log: /tmp/screenshot-smoke-test.log"
