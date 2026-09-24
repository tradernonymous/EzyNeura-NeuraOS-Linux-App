#!/usr/bin/env bash
# The README's screenshots: launch the built app on a virtual X server, walk
# the spaces with their own shortcuts, and save one PNG per view. The same
# setup as screenshot-smoke-test.sh, plus xdotool for the key presses.
#
# Usage:
#   scripts/screenshot-tour.sh [path-to-binary] [out-dir]
#
# Defaults to the release build and docs/assets/screens.
set -euo pipefail

BIN="${1:-app/desktop/src-tauri/target/release/freeai4u-desktop}"
OUT="${2:-docs/assets/screens}"
DISPLAY_NUM=":96"

[ -x "$BIN" ] || { echo "Not an executable: $BIN" >&2; exit 1; }
for tool in Xvfb dbus-launch scrot xdotool; do
  command -v "$tool" >/dev/null || { echo "Missing $tool (apt install xvfb dbus-x11 scrot xdotool)" >&2; exit 1; }
done
mkdir -p "$OUT"

Xvfb "$DISPLAY_NUM" -screen 0 1360x900x24 &
XVFB_PID=$!
trap 'kill "$XVFB_PID" "${APP_PID:-}" "${DBUS_SESSION_BUS_PID:-}" 2>/dev/null || true' EXIT
sleep 1
export DISPLAY="$DISPLAY_NUM"
eval "$(dbus-launch --sh-syntax)"

"$BIN" >/tmp/screenshot-tour.log 2>&1 &
APP_PID=$!
sleep 10
kill -0 "$APP_PID" 2>/dev/null || { echo "The app exited. Its log:" >&2; tail -n 40 /tmp/screenshot-tour.log >&2; exit 1; }

# With NEURAOS_ENGINE_URL set, point the app at that engine first (the
# connect screen's field, then Test + save), so the spaces are reachable.
if [ -n "${NEURAOS_ENGINE_URL:-}" ]; then
  xdotool mousemove 600 418 click 1; sleep 0.4
  xdotool key --clearmodifiers ctrl+a; sleep 0.2
  xdotool type --delay 8 -- "$NEURAOS_ENGINE_URL"; sleep 0.3
  # Tab lands on "Test + save"; Return presses it.
  xdotool key --clearmodifiers Tab; sleep 0.2
  xdotool key --clearmodifiers Return
  sleep 8
fi

shot() { # name [key]  -- a key chord (the top bar's own shortcut), then a capture
  local name="$1"; local key="${2:-}"
  if [ -n "$key" ]; then xdotool key --clearmodifiers "$key"; sleep 0.8; fi
  # The pointer parks in the far corner so no hover menu is open in the capture.
  xdotool mousemove 1330 880; sleep 2.5
  scrot -o "$OUT/$name.png"
  echo "wrote $OUT/$name.png"
}

# A page the top bar reaches through Ctrl+K: type its name, Return.
go() { xdotool key --clearmodifiers ctrl+k; sleep 0.8; xdotool type --delay 20 -- "$1"; sleep 0.6; xdotool key --clearmodifiers Return; sleep 1.2; }

# The spaces are Alt+1..4 (Sidebar.tsx NAV_ITEMS); the window sits at the
# top-left of the virtual screen at its default 1360x900. Chat first, with
# a new chat in the home folder so the screen is not an empty state.
xdotool key --clearmodifiers alt+1; sleep 1
xdotool key --clearmodifiers ctrl+n; sleep 1.2
# The picker asks where the chat lives: the first row is NeuraOS home.
xdotool key --clearmodifiers Return; sleep 1.5
shot chat
# A first message, so the chat is not an empty state: the composer, Return,
# and time for an answer from the engine's free router.
if [ -n "${NEURAOS_TOUR_CHAT:-}" ]; then
  xdotool type --delay 10 -- "In three short lines, what makes Linux Mint a good home for local AI?"; sleep 0.5
  xdotool key --clearmodifiers Return
  xdotool mousemove 1330 880
  sleep 30
  scrot -o "$OUT/chat-reply.png"; echo "wrote $OUT/chat-reply.png"
fi
shot code alt+2
shot create alt+3
shot agents alt+4
go "Runs"; shot activity
shot settings ctrl+comma
xdotool key --clearmodifiers ctrl+k; sleep 2
scrot -o "$OUT/palette.png"; echo "wrote $OUT/palette.png"
xdotool key --clearmodifiers Escape; sleep 1
# The light theme: the palette's toggle, Chat, and back.
go "Toggle theme"; xdotool key --clearmodifiers alt+1; sleep 1
shot chat-light
go "Toggle theme"; sleep 1
