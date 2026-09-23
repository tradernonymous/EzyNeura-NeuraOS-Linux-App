# NeuraOS for Linux Mint — backlog

The live tracker for `docs/MASTER_PLAN.md`'s phases (L0–L9). One row per
phase; a phase moves to *Done* only once its own checklist has been walked,
not merely once its code is green in CI.

## Status

| Phase | What | Status |
| :-- | :-- | :-- |
| L0 | Foundations: import structure, `UPSTREAM` pin, sync script, CI skeleton | Done — imported `app/desktop`, `app/shared`, `app/design`, `app/assets/branding` from `tradernonymous/freeopenai@8bbfffa`; `.github/workflows/linux.yml` added |
| L1 | Windows→Linux port (W1–W12), NVIDIA/DMA-BUF guard, Diagnostics | In progress — code + CI green (below); the 10-step hardware checklist (`docs/MASTER_PLAN.md` §7 L1) still needs a real Mint machine, first `.deb` sent to the user for that |
| L2 | The APK's look on the desktop | In progress — Neural Violet is now the default accent (below); the five-space nav, the orb, and "calm until it thinks" motion are still open |
| L3 | Engine on your machine (Cloud/Local/Offline) | Not started |
| L4 | Local AI on Linux (Vulkan llama.cpp, whisper.cpp, sd.cpp) | Not started |
| L5 | Linux-native features (Voice Type, notifications, Nemo, systemd, sandbox) | Not started |
| L6 | Agent mission control (ACP, parallel worktrees, MCP server) | Not started |
| L7 | Distribution and updates (apt repo, AppImage feed, Flatpak) | Not started |
| L8 | Hardening and Mint 23 / Wayland | Not started |
| L9 | Desktop control (optional) | Not started |

## L1: the W1–W12 audit, applied

| # | Fix | Where |
| :-- | :-- | :-- |
| W1 | `winreg` moved to `[target.'cfg(windows)'.dependencies]` | `Cargo.toml` |
| W2 | `mod mica`, the WebView2 boot check, and `mod webview2` gated `#[cfg(windows)]`; Linux gets `mica::supported() -> false` and reports the WebKitGTK version instead | `main.rs`, `diag.rs`, `linux.rs` |
| W3 | `bundle.targets` split into `tauri.windows.conf.json` (nsis, msi) and `tauri.linux.conf.json` (deb, appimage + deb `depends`) | `tauri.*.conf.json` |
| W4 | Shell commands and MCP servers spawn in their own process group (`process_group(0)`); `kill_tree` sends `SIGTERM` then `SIGKILL` to the negative pid on Unix | `local.rs`, `mcp.rs` |
| W5 | `shell_command` runs through `$SHELL -lc` (falling back to `bash`), so `~/.local/bin`, nvm and pyenv are on PATH | `local.rs` |
| W6 | Linux destructive-command entries (`sudo`, `pkexec`, `dd if=`, `mkfs`, `wipefs`, `chmod -R 777`, `chown -R`, `rm -rf ~`/`/`, `systemctl`, `apt purge/remove`, piped `wget`, a generic `\| sh`/`\| bash` net, a fork bomb) added to both `RISKY` lists, with real test coverage (below) | `local.rs`, `src/local-fs.js` |
| W7 | XDG-aware crash-log and model-search paths | `crash.rs`, `models.rs`, `linux.rs` |
| W8 | Keyring uses `sync-secret-service` + `crypto-rust` (Secret Service over D-Bus), not `linux-native` (keyutils, which does not survive a reboot) | `Cargo.toml` |
| W9 | The selection hotkey reads the X11/Wayland PRIMARY selection via `arboard`, rather than simulating Ctrl+C | `selection.rs` |
| W10 | The Quick-window default hotkey is `Ctrl+Alt+Space` on Linux (Alt+Space is Cinnamon's window menu) | `quick.rs` |
| W11 | Platform-aware copy (`platform.ts`): "your login keyring", the Voice Type fallback sentence, an `/usr/bin/…` placeholder | `platform.ts` + the components that used the Windows wording |
| W12 | The container sandbox offers Podman as well as Docker (`docker-sandbox.js` `binary`/`detectBinary`); `worktrees.js`'s quoting was already POSIX-safe (documented, not changed) | `docker-sandbox.js`, `docker-sandbox.d.ts`, `worktrees.js` |
| — | WebKitGTK's DMA-BUF renderer blanks the window on NVIDIA/some Wayland sessions: `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set automatically when `/proc/driver/nvidia/version` exists | `main.rs`, `linux.rs` |

Verified so far, in this container (an Ubuntu 22.04-ish environment; not yet
real Mint hardware):

- `npx tsc --noEmit` — clean.
- `npm run build` (Vite) — clean.
- `cargo test --manifest-path app/desktop/src-tauri/Cargo.toml` — **102
  passed, 0 failed**, including the new `linux::paths` tests.
- `npx tauri build --bundles deb,appimage` — **both bundles built**:
  `NeuraOS Desktop_2.11.0_amd64.deb` (14.6 MB) and
  `..._amd64.AppImage` (89.5 MB). Needed one build dependency this
  container didn't have (`xdg-utils`, for `xdg-mime`) — now in
  `.github/workflows/linux.yml` too.
- The `.deb`'s `Depends:` is exactly `libdbus-1-3, libayatana-appindicator3-1,
  libwebkit2gtk-4.1-0, libgtk-3-0` — checked against the binary's real
  `ldd` output. Tauri's own auto-detection finds the last three; `libdbus-1-3`
  (needed by the Secret Service keyring backend, W8) is added explicitly in
  `tauri.linux.conf.json` because auto-detection misses it.
- The bundled `.desktop` file carries `Exec=freeai4u-desktop`,
  `MimeType=x-scheme-handler/neuraos` and the right icon. It does **not**
  yet carry a `.gguf` MIME association from `fileAssociations` — Tauri v2's
  Linux bundler doesn't wire that up the way it does on Windows. Left open;
  not a blocker for L1, worth a small follow-up (a custom `desktopTemplate`
  or a packaged `.xml` MIME definition) before L1 is called fully done.

GitHub Actions confirmed the same result independently on a clean
`ubuntu-22.04` runner: [run 35921303802](https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/actions/runs/35921303802),
**success**.

A headless smoke test (`Xvfb` + the real `.deb`'s binary, no display, no
GPU, no session D-Bus) went further than a compile check: the process
starts, survives past its boot path, and spawns real `WebKitNetworkProcess`
and `WebKitWebProcess` children with a populated cache/storage directory
(`hsts-storage.sqlite`, `WebKitCache`, `CacheStorage`) — meaning the window
was created and the page actually loaded, not just "the binary didn't
crash." No crash-log entry was written. The only warnings were expected
for this container specifically (no session D-Bus daemon at all, so the
tray icon warns about `dbus-launch`; no real GPU, so EGL/DRI3 warns) —
neither applies to a normal Mint desktop session, where a session bus and
a real GPU are always present.

## L1 hardening: real test coverage for the destructive-command list

The W6 additions had no test coverage at all until now -- exactly the kind
of gap that matters most in a safety-critical list. Writing the tests
found two real bugs before either shipped further:

- `wget <url> | sh` (a URL between `wget` and the pipe) didn't match the
  narrow `"wget | sh"` entry -- the same literal-adjacency limitation
  upstream's own `"curl | sh"` has. Fixed by adding a generic `"| sh"` /
  `"| bash"` net (after the curl/wget-specific rows, so those still give
  their friendlier reason first) that catches anything piped into a
  shell, not just curl and wget by name.
- The test itself first claimed `rm -rf ./node_modules` should pass
  clean -- wrong: the plain, pre-existing `"rm -rf"` rule (no target
  qualifier) already catches it, same as it always has. My new `"rm -rf
  ~"` / `"rm -rf /"` rows are redundant with it (kept anyway, for the more
  specific reason text when they're the one that fires).

`app/test/desktop-local.test.js` (upstream's Rust/JS lockstep test,
ported) and two new `local.rs` unit tests
(`linux_destructive_commands_need_a_yes`,
`everyday_linux_commands_are_not_flagged`) cover this now. 104/104 Rust
tests and 39/39 `app/test/*.test.js` pass.

## L2: the APK's look, so far

The `.exe`'s accent system is already a single-hue OKLCH design (one
`--accent-h` variable derives every accent token at a fixed, WCAG-AA-safe
lightness/chroma per theme, swept for every possible hue by
`app/test/desktop-look.test.js`) with a user-facing hue picker in
Settings → Appearance. That made the first, real step small and safe:

- `DEFAULT_ACCENT_HUE` (`theme.ts`) and the CSS fallback (`index.css`)
  moved from 152 (the old green) to 286 — the OKLCH hue of the Android
  app's own Neural Violet accent (`#8B6CFF` dark / `#6D4DF2` light,
  averaged; the exact hex isn't reproduced verbatim because this app
  derives the accent from the theme's own contrast-safe formula, not a
  named colour).
- The old default is kept, renamed to a "Green" preset, so nothing is lost.
- `app/test/desktop-look.test.js` ported from upstream and updated for the
  new default and preset list — all 12 cases pass, including the full
  0–360 AA contrast sweep. Wired into `.github/workflows/linux.yml`.

Still open for L2: the five-space navigation (Chat/Code/Create/Agents/
Activity) and the orb, "calm until it thinks" motion (glow/pulse only
while an agent works), the APK's message anatomy and Worked·n-steps log,
one Library, and the Compare toggle beside the composer. This is the
`docs/MASTER_PLAN.md` phase itself sized M→L — real UI work across
`App.tsx`, `Sidebar.tsx` and the chat screen, not a single-commit change.

Not yet verified anywhere (needs real Mint hardware): the 10-step checklist
in `docs/MASTER_PLAN.md` section 7 — installing the `.deb` with `apt`,
launching it, a reboot to confirm keyring secrets persist, the real PTY
terminal, the `Ctrl+Alt+Space` Quick-window hotkey (and that it doesn't
collide with Cinnamon's own bindings), a BYOK endpoint round-trip, Ollama,
and the NVIDIA/DMA-BUF guard on a machine that actually has an NVIDIA GPU.
None of this can be ticked off from a headless container with no display,
no session bus user session, and no GPU — say so plainly rather than
claiming it, and treat it as this phase's real remaining work.
