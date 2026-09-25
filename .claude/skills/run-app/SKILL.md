---
name: run-app
description: Launch the NeuraOS desktop build on a virtual X server against the mock engine and take screenshots, to see a UI change working rather than only passing tests. Use when asked to run, start, or screenshot the app.
allowed-tools: Bash(bash scripts/dev/*) Bash(node scripts/dev/*)
---

# run-app: the app under Xvfb, against the bundled engine

Two scripts in `scripts/dev/`:

- `scripts/dev/engine.sh [port]`: the real bundled engine
  (`app/desktop/src-tauri/engine/server.js`, zero npm deps, Node 24+) on
  `127.0.0.1:8787` with a scratch data folder, so every space is reachable
  with no key: free providers answer, BYOK ones show as unset. No mock
  exists and none is needed.
- `scripts/dev/screenshot.sh <binary> <out-dir> [view ...]`: Xvfb + a
  session bus + the app, then one PNG per named view: `chat`, `code`,
  `create`, `agents`, `settings`, or `key:<chord>` for anything else.

## The loop

```bash
cd app/desktop && npm run build && npx tauri build --bundles none --debug; cd ../..
bash scripts/dev/engine.sh 8787 &
ENGINE=$!
NEURAOS_ENGINE_URL=http://127.0.0.1:8787 bash scripts/dev/screenshot.sh \
  app/desktop/src-tauri/target/debug/freeai4u-desktop /tmp/shots chat settings
kill $ENGINE
```

Then `Read` the PNGs. A debug build starts in about a second; the release
build in `screenshot-smoke-test.sh` is for CI and the README tour.

## What to know

- Needs `xvfb dbus-x11 scrot xdotool` (apt). The scripts say which is
  missing.
- Typing through xdotool lags under software-rendered WebKitGTK: use
  `--delay 40` or higher for text you want intact, and a longer wait before
  a capture. A truncated word in a screenshot is usually this, not a bug.
- The app stores its settings in `~/.local/share/com.freeai4u.desktop`;
  point `XDG_DATA_HOME` at a scratch folder for a clean first run.
- No keyring on a virtual display: the "credential store unavailable"
  warning is expected there (docs/BACKLOG.md explains why).
- Kill the app by its PID, never `pkill -f`.
