#!/usr/bin/env bash
# Screenshots of named views for the run-app skill: Xvfb, a session bus,
# the app, then the engine URL typed into the connect card when
# NEURAOS_ENGINE_URL is set (same coordinates as scripts/screenshot-tour.sh),
# then one PNG per view. Debug or release binary.
#
#   scripts/dev/screenshot.sh <binary> <out-dir> [view ...]
#   view: chat | code | create | agents | settings | key:<xdotool chord>
set -euo pipefail
BIN="${1:?binary}"; OUT="${2:?out-dir}"; shift 2
VIEWS=("$@"); [ ${#VIEWS[@]} -gt 0 ] || VIEWS=(chat)
DISPLAY_NUM=":95"
[ -x "$BIN" ] || { echo "Not an executable: $BIN" >&2; exit 1; }
for tool in Xvfb dbus-launch scrot xdotool; do
  command -v "$tool" >/dev/null || { echo "Missing $tool (sudo apt install xvfb dbus-x11 scrot xdotool)" >&2; exit 1; }
done
mkdir -p "$OUT"
export XDG_DATA_HOME="${XDG_DATA_HOME:-${TMPDIR:-/tmp}/neuraos-dev-home/share}"
mkdir -p "$XDG_DATA_HOME"

Xvfb "$DISPLAY_NUM" -screen 0 1360x900x24 &
XVFB_PID=$!
trap 'kill "$XVFB_PID" "${APP_PID:-}" "${DBUS_SESSION_BUS_PID:-}" 2>/dev/null || true' EXIT
sleep 1
export DISPLAY="$DISPLAY_NUM"
eval "$(dbus-launch --sh-syntax)"
"$BIN" >"$OUT/app.log" 2>&1 &
APP_PID=$!
sleep "${NEURAOS_DEV_WAIT:-6}"
kill -0 "$APP_PID" 2>/dev/null || { echo "The app exited. Its log:" >&2; tail -n 40 "$OUT/app.log" >&2; exit 1; }

if [ -n "${NEURAOS_ENGINE_URL:-}" ]; then
  xdotool mousemove 700 438 click 1; sleep 0.4
  xdotool key --clearmodifiers ctrl+a; sleep 0.2
  xdotool type --delay 40 -- "$NEURAOS_ENGINE_URL"; sleep 0.3
  xdotool key --clearmodifiers Tab; sleep 0.2
  xdotool key --clearmodifiers Return
  sleep 6
fi

capture() { xdotool mousemove 1330 880; sleep 2.5; scrot -o "$OUT/$1.png"; echo "wrote $OUT/$1.png"; }
for view in "${VIEWS[@]}"; do
  case "$view" in
    chat) xdotool key --clearmodifiers alt+1 ;;
    code) xdotool key --clearmodifiers alt+2 ;;
    create) xdotool key --clearmodifiers alt+3 ;;
    agents) xdotool key --clearmodifiers alt+4 ;;
    settings) xdotool key --clearmodifiers ctrl+comma ;;
    key:*) xdotool key --clearmodifiers "${view#key:}" ;;
    *) echo "unknown view $view" >&2; continue ;;
  esac
  sleep 0.8
  capture "${view//[^a-zA-Z0-9]/_}"
done
echo "App log: $OUT/app.log"
