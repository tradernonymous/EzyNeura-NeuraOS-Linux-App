# NeuraOS for Linux Mint — backlog

The live tracker for `docs/MASTER_PLAN.md`'s phases (L0–L9). One row per
phase; a phase moves to *Done* only once its own checklist has been walked,
not merely once its code is green in CI.

## Status

| Phase | What | Status |
| :-- | :-- | :-- |
| L0 | Foundations: import structure, `UPSTREAM` pin, sync script, CI skeleton | Done — imported `app/desktop`, `app/shared`, `app/design`, `app/assets/branding` from `tradernonymous/freeopenai@8bbfffa`; `.github/workflows/linux.yml` added |
| L1 | Windows→Linux port (W1–W12), NVIDIA/DMA-BUF guard, Diagnostics | In progress — W1–W12 applied (see below); `.deb`/AppImage build being verified; the 10-step hardware checklist (`docs/MASTER_PLAN.md` §7 L1) still needs a real Mint machine |
| L2 | The APK's look on the desktop | Not started |
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
| W6 | Linux destructive-command entries (`sudo`, `pkexec`, `dd if=`, `mkfs`, `wipefs`, `chmod -R 777`, `chown -R`, `rm -rf ~`/`/`, `systemctl`, `apt purge/remove`, piped `wget`, a fork bomb) added to both `RISKY` lists | `local.rs`, `src/local-fs.js` |
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

Not yet verified anywhere (needs real Mint hardware): the 10-step checklist
in `docs/MASTER_PLAN.md` section 7 — installing the `.deb` with `apt`,
launching it, a reboot to confirm keyring secrets persist, the real PTY
terminal, the `Ctrl+Alt+Space` Quick-window hotkey (and that it doesn't
collide with Cinnamon's own bindings), a BYOK endpoint round-trip, Ollama,
and the NVIDIA/DMA-BUF guard on a machine that actually has an NVIDIA GPU.
None of this can be ticked off from a headless container with no display,
no session bus user session, and no GPU — say so plainly rather than
claiming it, and treat it as this phase's real remaining work.
