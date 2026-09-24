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

shot() { # name [x y]...  -- clicks, then a capture
  local name="$1"; shift
  while [ "$#" -ge 2 ]; do xdotool mousemove "$1" "$2" click 1; sleep 0.8; shift 2; done
  # A click on the empty end of the tab bar takes focus off the rail button,
  # or the rail stays expanded over the screen; then the pointer parks away.
  xdotool mousemove 1100 26 click 1; sleep 0.3
  xdotool mousemove 1330 880; sleep 2.5
  scrot -o "$OUT/$name.png"
  echo "wrote $OUT/$name.png"
}

# The rail's icons, top to bottom (Sidebar.tsx NAV_ITEMS), at the window's
# default 1360x900 placed at the top-left of the virtual screen.
RAIL_X=20
# Chat, then "New chat" on a fresh profile (the button sits where the
# empty state's centre is; on a profile with chats the click lands on
# nothing).
xdotool mousemove $RAIL_X 117 click 1; sleep 1
xdotool mousemove 679 525 click 1; sleep 1.5
# A chip may have taken that click once the new chat rendered: empty the composer.
xdotool mousemove 679 766 click 1; sleep 0.3
xdotool key --clearmodifiers ctrl+a BackSpace; sleep 0.3
shot chat
# A first message, so the chat is not an empty state: "New chat", the
# composer, Return, and time for an answer from the engine's free router.
if [ -n "${NEURAOS_TOUR_CHAT:-}" ]; then
  xdotool mousemove 679 501 click 1; sleep 2
  xdotool mousemove 679 766 click 1; sleep 0.8
  xdotool type --delay 10 -- "In three short lines, what makes Linux Mint a good home for local AI?"; sleep 0.5
  xdotool key --clearmodifiers Return
  xdotool mousemove 1330 880
  sleep 30
  scrot -o "$OUT/chat-reply.png"; echo "wrote $OUT/chat-reply.png"
fi
shot code     $RAIL_X 155
shot create   $RAIL_X 193
shot agents   $RAIL_X 231
shot activity $RAIL_X 270
shot settings $RAIL_X 777
xdotool key --clearmodifiers ctrl+k; sleep 2
scrot -o "$OUT/palette.png"; echo "wrote $OUT/palette.png"
xdotool key --clearmodifiers Escape; sleep 1
# The light theme: the rail's footer toggle, Chat, and back.
shot chat-light $RAIL_X 853 $RAIL_X 117
xdotool mousemove $RAIL_X 853 click 1; sleep 1
