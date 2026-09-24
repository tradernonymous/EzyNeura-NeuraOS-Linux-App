# NeuraOS for Linux Mint — backlog

The live tracker for `docs/MASTER_PLAN.md`'s phases (L0–L9). One row per
phase; a phase moves to *Done* only once its own checklist has been walked,
not merely once its code is green in CI.

## Status

| Phase | What | Status |
| :-- | :-- | :-- |
| L0 | Foundations: import structure, `UPSTREAM` pin, sync script, CI skeleton | Done — imported `app/desktop`, `app/shared`, `app/design`, `app/assets/branding` from `tradernonymous/freeopenai@8bbfffa`; `.github/workflows/linux.yml` added |
| L1 | Windows→Linux port (W1–W12), NVIDIA/DMA-BUF guard, Diagnostics | Code complete + CI green; the DMA-BUF guard is now on by default with a renderer selector in Diagnostics (below, "First Mint machine"), including the `.gguf` MIME association (`tauri.linux.conf.json` + `packaging/mime/`); the 10-step hardware checklist (`docs/MASTER_PLAN.md` §7 L1) still needs a real Mint machine |
| L2 | The APK's look on the desktop | In progress — Neural Violet default, the five spaces + the orb, the Activity space, follow-system theme, the APK's gesture keys (below); the message anatomy (Worked · n steps, folding Thought) and an Orca pass still open |
| L3 | Engine on your machine (Cloud/Local/Offline) | **Local mode working end-to-end** (below); one-click Node 24 (sha256-checked from nodejs.org) and the engine as a systemd user service on 127.0.0.1:47831 (below); Offline mode is the existing local-runtime chat (llama-server / Ollama targets) |
| L4 | Local AI on Linux (Vulkan llama.cpp, whisper.cpp, sd.cpp) | In progress — one-click llama.cpp (Vulkan or CPU) into the app's folder, a GPU/VRAM hardware line with a size suggestion (below), plus the earlier discovery and .so fixes; **FLUX.2 on this PC** (below): the Images space draws and changes pictures with FLUX.2 [klein] / [dev] through the user's sd-server, one click from Hugging Face; a Mint hardware run, tokens/s, whisper and sd.cpp one-click still open |
| L5 | Linux-native features (Voice Type, notifications, Nemo, systemd, sandbox) | Code done (below): Voice Type, Approve/Reject on notifications, Nemo actions, tray states, bubblewrap, the engine service (L3); none of it yet demonstrated on Mint hardware; systemd-timer schedules and screenshot→ask not started |
| L6 | Agent mission control (ACP, parallel worktrees, MCP server) | ACP client working to the handshake against a real agent (below): Code → Agents (ACP) runs Gemini CLI / Claude Code / Codex / any ACP command in the open folder behind NeuraOS's approval cards and notification buttons; Parallel worktrees already in the `.exe`; **NeuraOS as an MCP server built** (below): `freeai4u-desktop --mcp` serves neuraos_status / neuraos_models / neuraos_chat / neuraos_image / neuraos_open over stdio, with copy-paste commands for Claude Code, Gemini CLI and a config JSON in Settings → Connectors; the Activity-board compare not started |
| L7 | Distribution and updates (apt repo, AppImage feed, Flatpak) | **Release pipeline built** (below): `release.yml` on a `v*` tag publishes the `.deb`, the AppImage, `SHA256SUMS` and a signed `desktop-version.json` to Releases and rebuilds the apt repository on GitHub Pages; the installed app updates itself from it (a `.deb` through Mint's package installer, an AppImage in place). Needs the maintainer to run `packaging/release/make-keys.sh` once and enable Pages; Flatpak not started |
| L8 | Hardening and Mint 23 / Wayland | The Xvfb smoke test is a CI gate with a screenshot artifact (below); **Wayland portals built** (below): Screenshot, GlobalShortcuts for the four chords, RemoteDesktop for Voice Type, and `wl-paste` for the selection; WebDriver e2e and the performance budget not started |
| L9 | Desktop control (optional) | **Built** (below): screen-ask (`Ctrl+Alt+S`, the palette, Settings) attaches a screenshot to the chat; with Desktop control on, a model gets screen_capture / desktop_click / desktop_type / desktop_key / desktop_scroll, each behind an Allow card, through xdotool on X11 and the RemoteDesktop portal on Wayland |

## UI plan, phase 3: Code with decks

- **One compact toolbar** in place of the header, the model row and the
  Docker paragraph: a project chip (folder · git branch, read from
  `.git/HEAD`), the model pill, then Tests, Review, Terminal, Git and a
  Docker toggle (its image in a small field when on).
- **Task decks under the box** (`tasks.js`, `components/TaskDecks.tsx`):
  Build · Fix · Refactor · Test · Review · Docs · Git & Ops, five to seven
  common tasks each. Pointing at a deck for 150 ms, clicking it or ↓ opens
  its card; a pick fills the box with a template and selects its first
  `{{blank}}`, so typing replaces it.
- **`/` opens the same list** in the box, filtered as you type, ↑↓ Enter.
- **Your own tasks** live in the project as `.neuraos/commands/<name>.md`
  (`# Title`, an optional `> hint`, then the template) and show as a
  "Mine" deck; **Save as task** writes the box's text there.
- **The empty state** offers the recent folders and Open a folder instead
  of a large centred icon; picking one sets the working folder for every
  local surface (`freeai4u:open-project`).
- Not built: a "changed files" count on the project chip (it needs
  `git status` and the app does not run commands unasked) and a task list
  before the edit (the agent's own plan/steps already show as they run).

Verified here: `tsc`, `vite build`, `node --test` (73), and a headless
Chromium screenshot with a folder set and the Fix deck open.

## UI plan, phase 2: Chat in the Freebuff anatomy

- **One centred column.** The thread and the composer share
  `--workspace-max`; the composer is a raised card, not a bar.
- **Your message is a card with a rewind** (`turn.rewindTo`): the thread
  is cut before it and its words come back to the box, minus the
  attachment text.
- **"Worked N steps ›"** (`components/StepsFold.tsx`, `turn.stepsOf`): a
  reply's tool calls fold into one line with a badge per step (DONE,
  RUNNING, NEEDS OK, FAILED, DECLINED); a turn still running or asking
  starts open, a finished one folds. `Ctrl+T` still opens every card.
- **A stopped turn says so** (`Msg.stopped`, set when Stop cuts a reply
  with words in it) with its own Retry.
- **Chips under the last answer** (`turn.chips`): Continue, Shorter,
  Explain, and Turn into code when the reply had no code, Review changes
  and Run tests when the chat changed files. A chip fills the box; it does
  not send, so a free tier is never spent by a slip.
- **A Goal row** (`ChatSession.goal`, `turn.goalPrompt`): pinned above the
  box and sent as a system line with every turn.
- **One bar under the box:** model · Reasoning (click to cycle) · Skills
  (`/`) · Goal · approvals · tool chips on the left; attach, mic and a
  round send on the right. The hint line moved into the send button's
  title.
- **The output panel** (`components/ChatOutput.tsx`, `turn.outputOf`) sits
  at the right only when a turn produced something: Preview (the newest
  picture) and Changes (every file a reply wrote or edited, once, the
  latest touch last, `W`/`E`, opens the Local folder). It opens by itself
  the first time and remembers being closed per chat; an "Output" button
  brings it back.

Verified here: `tsc`, `vite build`, `node --test` (68), and headless
Chromium screenshots of the built bundle against a mock engine with a
seeded chat (fold, stop card, chips, goal, bar, Changes panel all drawn).
Not verified: a live turn on Mint hardware.

## UI plan, phase 1: the app frame

The approved UI/UX plan (six phases, one PR each). Phase 1 is the frame every
later phase sits in:

- **A top bar instead of two rails.** `components/TopNav.tsx`: Chat, Code,
  Create, Agents (`Alt+1`–`Alt+4`); pointing at one for 150 ms, clicking it
  a second time, or pressing ↓ opens a deck of its pages with a one-line
  hint each. The open page's name follows the label ("Code · Files"), so
  the strip of sub-tabs is gone. The right end: Search (`Ctrl+K`), the
  engine dot (the status bar's own tones), Settings, theme.
- **The right rail is gone** (`Workbench.tsx`, `workbench.js`, the docked
  Builds/Knowledge panel). Design and Builds are pages; Files is Code ▾
  Files; the folder tree and the terminal are toggles in the sidebar's
  tool row. Changes comes back inside Chat in phase 2.
- **A project sidebar** (`Sidebar.tsx`, `Ctrl+B` hides it) in place of the
  icon rail and the History drawer: "+ New chat", a row of small raised
  buttons (search, commands, folder tree, terminal, runs), All / Running /
  Pinned, then history **grouped by folder** with a status dot per chat,
  "Show N more" per group, and the orb, export/import, theme and Settings
  at the foot. Activity is a tab under Agents ("Runs").
- **Every chat lives in a folder** (the Claude Code flow). `New chat` opens
  `components/ProjectPicker.tsx`: NeuraOS home (`~/NeuraOS`, made by
  `local_project_home`), recent folders, or any folder. The chat saves it
  (`ChatSession.project`), the sidebar groups by it, and the chat on screen
  sets the working folder (`ACTIVE_CHAT_EVENT` → `localRoot`), so the
  terminal, the tree and the local tools follow the chat. Existing chats
  land in the home group; nothing moves on disk.
- The grouping, the filters and the storage cases are `shell.js`, pinned by
  `test/desktop-shell.test.js` together with the frame's shape.

Verified here: `tsc --noEmit`, `vite build`, `node --test` (62), `cargo test
local::`, and a headless Chromium screenshot of the built bundle (the frame
renders; the connect screen is what a browser build without an engine
shows). Not verified: the Tauri window on Mint hardware; "Clone a
repository…" in the picker is not built (no git clone command in the
shell yet) — Open a folder covers a cloned repo.

## L4: FLUX.2 on this PC (make and change a picture)

The Images space's "This PC" row runs the user's own `sd-server`
(stable-diffusion.cpp). It already read a multi-file model as one set
(NEURA-073); what it could not do was start a FLUX.2 set, draw it right,
or land one from Hugging Face without a hand-typed command. Now:

- **The set is read right.** FLUX's autoencoder is `ae.safetensors` /
  `flux2_ae.safetensors` (no "vae" in the name) and FLUX.2 [klein]'s text
  encoder is a plain Qwen3 (`qwen_3_4b.safetensors`, the same size as the
  diffusion model in bf16, so "largest file" alone picked either).
  `sd.rs role_of` knows both; `flux2_kleins_three_files_are_one_set…` pins it.
- **The model brings its own numbers.** `sd.rs family_of` maps the name to
  the settings stable-diffusion.cpp's `docs/flux2.md` gives: klein → 4 steps
  at cfg 1.0, klein base → 20 at 4.0, FLUX.2 [dev] → 20 at 1.0, FLUX.1
  schnell → 4 at 1.0. `with_family` writes them into the job as
  `sample_params.sample_steps` (only when the caller sent none) and
  `sample_params.guidance.txt_cfg` (api.md's name). The frontend no longer
  hard-codes 20 steps for every local draw (`images.localSteps`): steps
  travel only when a caller asks for a number. An unknown model keeps
  sd-server's defaults exactly as before.
- **Change a picture with the same weights.** FLUX.2 draws and edits with
  one model, and edits by reference, so `edits_by_reference` now says yes to
  any FLUX.2 name (klein, flux2-dev, flux-2-…): the source picture goes as
  `ref_images`, never as an `init_image` restyle. The shape follows the
  source picture, as before.
- **One click from Hugging Face.** Two chips under "Add from Hugging Face"
  (FLUX.2 [klein] 4B / 9B) fill in `Comfy-Org/flux2-klein-4B|9B`, whose
  `split_files/{diffusion_models,vae,text_encoders}` layout `hf-models.js`
  already reads as one set. A downloaded set used to end with "run it by
  hand"; now the set's folder is handed to `sd_use_model`, which accepts a
  folder that forms a set, and Start passes each part under its own flag.

Verified here: `cargo test sd::` (19, incl. the new family/role/reference
tests), `node --test app/test/desktop-images.test.js` (pins both halves),
`tsc --noEmit`, `vite build`. Not verified from this container: a real
draw (no GPU, and huggingface.co is not reachable from here, so the
Comfy-Org file listing is taken from stable-diffusion.cpp's own docs).

Not done, and where it belongs: the hosted routes. Cloudflare Workers AI
serves `@cf/black-forest-labs/flux-2-klein-4b` (multipart/form-data,
`input_image_0..3` for edits) and NVIDIA `black-forest-labs/flux.2-klein-4b`
(`{prompt, seed, steps}`), but both shapes live in the engine's
`server.js`, which is upstream's verbatim (AGENTS.md) — a PR for
`tradernonymous/freeopenai`, not this delta.

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

## L3: Local mode, working end to end

`server.js` has **zero npm runtime dependencies** -- only Node's own
built-ins -- so the whole thing this needed was its files (676KB:
`server.js`, `auth.js`, `chatlib.js`, `github.js`, `agent-sessions.js`,
`fcm-push.js`, `tool-call-text.js`, `package.json` -- see
`app/desktop/src-tauri/engine/README.md` for exactly what's bundled and
why) plus a `node` on the machine to run them with. No portable Node
runtime is bundled yet (open work, below); this uses whichever `node`
the machine already has.

**What shipped:**
- `app/desktop/src-tauri/engine/`: the files above, bundled as a Tauri
  resource (`tauri.conf.json` → `bundle.resources`).
- `engine.rs`: finds a Node ≥24 three ways in order -- the plain PATH,
  then a login shell (`$SHELL -lc`, reusing the same trick as W5's
  `local.rs::login_shell`), then nvm's own `~/.nvm/versions/node/*`
  layout directly -- because a GUI-launched process's PATH usually has
  none of nvm's/fnm's per-shell PATH lines on it at all, the same problem
  W5 already solved for the terminal. Starts `node server.js` on a free
  loopback port, polls until it's actually listening (or reports exactly
  why it isn't), and stops it (including on Quit, alongside the model and
  image servers).
- `ConnectionCard.tsx`: a "Run the engine on this machine" button that
  appears once a usable Node is found, and the exact reason when one
  isn't (not found at all, or too old).
- `scripts/sync-upstream.sh` re-copies the engine's files from upstream
  too now.

**Verified for real, not just compiled:** built the actual `.deb`,
extracted it, confirmed all 8 files land at
`/usr/lib/NeuraOS Desktop/engine/`, then ran the real installed-layout
binary under the screenshot-smoke-test setup and used `xdotool` to
**click the actual button**. Screenshot evidence:

1. With only Node 22 on this container (real, not simulated): the button
   is replaced by "Node 22 is on PATH, but the engine needs 24+." --
   exactly the intended message, and Neural Violet renders correctly in
   the same shot.
2. With the version gate temporarily lowered to prove the happy path
   (reverted before commit, `git diff` clean): clicking "Run the engine
   on this machine" produced a **real `node server.js` child process**
   (confirmed in `ps aux`), and the app's own screen moved past "Connect
   to an engine" into the actual Chat UI, status bar reading
   **"● connected · 127.0.0.1:\<port\> · ✓ signed in"**.

109/109 Rust tests (5 new: Node-version parsing, nvm version-sort
correctness, shell-quoting, free-port allocation), 39/39 JS tests, clean
`tsc`.

**Local mode now remembers itself.** A person who ran the engine once
does not need to click it again: `bridge.ts` stores the choice
(`freeai4u.engine_mode`), and `App.tsx`'s boot effect starts the engine
before the first health probe if it was set, so the very first check
already hits the right address. An explicit "Test + save" of any address
in Settings clears the preference again -- Cloud wins when it's chosen on
purpose.

Verified with two full app launches sharing one profile, not just
reasoned about: launch 1, click "Run the engine on this machine",
confirm connected; kill it; launch 2 with **zero clicks** -- a fresh
`node server.js` came up on its own (a different port than launch 1,
proving it wasn't a leftover process) and the app landed straight in the
Chat screen, "connected · 127.0.0.1:<port> · signed in".

**Open for L3:** Cloud mode already existed (unchanged) and Local mode is
now real, remembered across launches; **Offline mode** (talk to
Ollama/llama-server directly with no engine in between) isn't built.
Bundling a portable Node runtime, so Local mode needs nothing installed
at all, is the more ambitious version of this phase and is still open --
this ships real value now without waiting for that. A `systemd --user`
service so the bundled engine can keep running for the phone APK to
reach over LAN, per the master plan, is also still open.

## L4: local models on Linux, so far

Function first: the goal is more working local models for research and
coding, so the first L4 work is the two things that stopped a llama.cpp
release build from running at all on Mint, plus discovery:

- **A copied `llama-server` could not start.** `local_server_use` copied
  only the binary into the app's folder, but a Linux release build is
  linked against the `lib*.so` files beside it (rpath `$ORIGIN`), so the
  copy died with "error while loading shared libraries: libllama.so".
  It now takes every `lib*.so*` sibling along and sets the execute bit
  (a zip unpacked from Nemo can drop it). `linux::paths::sibling_shared_libs`
  is unit-tested against a real temp folder.
- **Nothing installed outside the GUI PATH was found.** A GUI-launched
  process on Cinnamon does not carry `~/.local/bin`, nor the
  `~/llama.cpp/build/bin` an unzipped release usually sits in.
  `linux::paths::extra_bin_dirs` adds those, `/usr/local/bin` (where
  ollama.com's installer puts `ollama`), `/opt/llama.cpp/...`, and the
  `build/bin` of a source-built whisper.cpp / stable-diffusion.cpp; all four
  finders (`models.rs`, `whisper.rs`, `sd.rs`, `ollama.rs`) fall through to
  it after PATH. A binary found this way is run from where it is, like the
  Unsloth case, never copied.
- The Settings copy no longer says "download the release for Windows":
  on Linux it names the `ubuntu-vulkan-x64` (GPU) / `ubuntu-x64` (CPU)
  zips and `build/bin/llama-server`; the dictation card no longer names
  `whisper-cli.exe` on Linux; Ollama's "not installed" message stops
  citing `%LOCALAPPDATA%`.
- The `.deb` now `Recommends: libvulkan1`, so the Vulkan llama.cpp build
  (the GPU path for AMD, Intel and NVIDIA alike) has its loader present.
- The selection hotkey applies the same 60,000-unit cap on Linux that the
  Windows path had, so selecting a whole file can't flood the Quick window
  (this also removes the one dead-code warning that was in the Linux delta).

`cargo clippy -D warnings` still fails on **upstream-owned** style lints
(`manual_split_once` in `byok.rs`/`ollama.rs`, `manual_range_patterns` in
`gguf.rs`, `too_many_arguments` in `local.rs`/`models.rs`/`sd.rs`, a
`redundant_closure` in `net.rs`, dead `hub_file_url` in `models.rs`).
They belong upstream (`AGENTS.md`: this repo owns the Linux delta only),
so clippy stays `continue-on-error` in CI until they land there.

Still open for L4: whisper.cpp publishes no Linux binaries, so Voice
Type on Mint needs a source build (`cmake -B build && cmake --build build`)
until this app ships or packages one; a real Vulkan run on Mint hardware;
the Offline mode of L3.

## L6: the ACP client

`acp.rs` runs an Agent Client Protocol agent as a child over stdio (its own
process group, killed on Quit beside the other servers): `initialize`,
`session/new`, `session/prompt` (a long turn, cancellable), and every
message the agent sends back -- `session/update` notifications and its own
requests `session/request_permission`, `fs/read_text_file`,
`fs/write_text_file` -- goes to the page as an `acp-message` event, which
answers through `acp_respond`. `screens/AcpScreen.tsx` (Code → Agents
(ACP)) renders the transcript (message chunks, folded thoughts, tool calls
with status, plans), serves reads only from inside the open folder through
the existing confined `local_read_file`, and turns every write and every
permission request into an approval card -- with Allow / Reject on the
desktop notification too (L5). Presets: Gemini CLI (`gemini
--experimental-acp`), Claude Code (`npx @agentclientprotocol/claude-agent-acp`),
Codex (`npx @zed-industries/codex-acp`), or any command.

Proven in this container against the real `claude-agent-acp`: the
framing and `initialize` (the agent answered with `protocolVersion: 1`,
its `agentInfo` and `authMethods`, the shapes the code parses), and
`session/new` reached the agent, which refused only for this container's
own reasons -- it runs as root, inside another Claude Code session, and is
not logged in ("--dangerously-skip-permissions cannot be used with
root/sudo privileges"; "Claude Code cannot be launched inside another
Claude Code session"). The `_auth/status_update` notification it sent
meanwhile is exactly what the event path carries. Not run here: a prompt
turn, a permission card, a file write (needs a signed-in agent on a normal
user account -- the user's Mint machine).

## L5: Linux-native features

All in `desktop.rs` (commands exist on every platform; off Linux they say
so), `quick.rs` (the chord) and the cards that own each setting:

- **Voice Type** (`voiceType.ts`, Settings → Dictation): a hold-to-talk
  chord (default `ctrl+alt+v`) registered through the global-shortcut
  plugin's press/release; press starts the composer's own mic, release
  transcribes with the same Whisper engine choice and `voice_type_text`
  types it into the focused app with `xdotool type --clearmodifiers`
  (X11) or `wtype` (Wayland). `xdotool` is a `.deb` Recommends.
- **Approve / Reject on the notification** (`notify_with_actions`,
  notify-rust over D-Bus, Linux only): Chat's tool approvals and Recipes'
  paused runs put buttons on the notification; the pressed one comes back
  as a `notification-action` event and answers the waiting card. Elsewhere
  the plain notification stands and the result says `actions: false`.
- **Nemo actions** (Settings → Startup and desktop): three `.nemo_action`
  files in `~/.local/share/nemo/actions/` (open folder in Code, ask about
  a file, inspect a GGUF), launching this binary or the AppImage.
- **Tray states** (`tray_state_set`, driven from the rail): the app icon
  with a cyan dot while any chat streams, an amber dot while an approval
  waits; drawn in Rust over the icon's own pixels, no extra assets.
- **bubblewrap** beside Docker/Podman in `docker-sandbox.js`: the host
  read-only, the project read-write at `/work`, no network, no daemon and
  no image; `app/test/desktop-sandbox.test.js` pins the line.

Verified: cargo test 125/125, node --test 42/42, tsc, build, and the debug
binary still starts under Xvfb with no panic. Not verified: any of it on a
real Cinnamon session (the chord, xdotool typing, libnotify buttons, Nemo
picking the actions up, the tray dot in the XApp applet).

## Neural: the AI-era pass on the look (L2, second round)

The first Mint screenshots read as a green terminal skin: the whole ramp
(`--bg-0` #050a06 … `--bg-3` #172818, text #e8f0e3) carried upstream's old
green accent even after the accent itself became Neural Violet. Researched
before touching anything (September 2026): Linear's near-black canvas with
graphite surfaces stacked by translucent white hairlines rather than
shadows, Inter at custom weights and a restrained indigo family; Raycast's
absolute-black canvas, Inter everywhere with OpenType alternates and a
touch of positive tracking, tight spacing and precise radii; the 2026
consensus on AI interfaces -- dark-first, translucent layers for depth
without extra colour, glass only for overlays and navigation, motion that
explains a state change and nothing that moves on its own; and the agent
UX catalogues' tool cards with status pills and approval gates streamed as
they happen (already the app's shape). The person asked for futuristic and
AI-like with few animations, which is the same brief.

What changed (`index.css`, the tokens in place and one "Neural" layer at
the end that wins):

- **Palette**: graphite with a whisper of violet -- canvas #050509, `--bg-0`
  #07070c to `--bg-3` #1b1b26, hairline #252533, text #ededf5 / #a7aabd /
  #80849a; the light theme the same family (#f6f6fa … #d9d9e5). Every text
  token re-measured: ≥ 4.6:1 on `--bg-0`..`--bg-2` in both themes (the
  contrast sweep in `desktop-look.test.js` still passes at every accent
  hue). A new `--ai` (#38d6ff, the Android app's activity cyan) is the one
  colour that means "the model is doing something": the assistant's label
  and its dot, the typing mark, the tray dot.
- **Type**: Inter with `cv11`, `ss01`, `calt`, `kern` and 0.1px tracking.
- **Messages**: the assistant speaks without a box; the person's words keep
  a bubble tinted with the accent, 16px corners.
- **Composer**: one floating glass surface with a soft accent ring on
  focus; the send button and primary buttons carry the app's one gradient.
- **Cards** lit by a hairline along the top (`--glass-light`), not a
  heavier border; the rail's active row is an accent bar with a fade; the
  palette is a glass sheet with 14px corners; buttons and inputs settle on
  8px, chips on pills.
- **Empty states**: a lit 64px tile, a real title, and, in Chat, four
  prompt chips that drop into the composer.
- **Motion**: the 72-second ambient drift is gone. Hover, focus and the
  orb still move; nothing else does.

Verified here: `node --test` (the hue and contrast sweep), `tsc`,
`npm run build`, and the screenshot tour on the debug build (the screens
in `docs/assets/screens/` are the new ones). Not verified: on Mint
hardware, the light theme in daylight, a long conversation with tool
cards.

Sources read: groovyweb.co "12 UI/UX Design Trends for AI Apps (2026)",
designmd.cc/benchmarks/linear, open-design.ai (Raycast design system),
fuselabcreative.com "Agent UX: UI Design for AI Agents in 2026",
zylos.ai "Agentic UX: Frontend Design Patterns", timgraf.com on
glassmorphism in 2026, pixelmatters.com "7 UI design trends 2026".

## The README, and a screenshot tour

The README is now the front door: an SVG banner (`docs/assets/banner.svg`,
the emblem's violet-to-cyan, a slow glow and one activity line; GitHub
plays SMIL in an `<img>`), badges, a three-column install table (`.deb`,
AppImage, the apt repository), six real screens, the five spaces, the
Linux features in two columns, and a mermaid diagram of what talks to
what. `tradernonymous/EzyAi` was never reachable from this session (the
GitHub connector has no access to it), so the graphics are this
repository's own.

`scripts/screenshot-tour.sh` makes the screens: the built app under Xvfb
with a session bus, optionally pointed at an engine (`NEURAOS_ENGINE_URL`;
the bundled engine on Node 24 with no accounts configured needs no
login), the rail's icons clicked with xdotool, the pointer parked off the
rail, one PNG per space plus Settings and the palette. The screens in
`docs/assets/screens/` came from the debug build at 1360×900 with the
engine on `localhost:47831` and no model picked, so the empty states are
what a first start shows. A chat message was tried and not kept: with no
model picked the engine answers "model and messages are required".

## L6: NeuraOS as an MCP server

`freeai4u-desktop --mcp` (`mcp_server.rs`, Linux only) speaks MCP
2025-06-18 over stdio with no window, bus or tray, so Claude Code, Gemini
CLI, Codex or any MCP client can use what this machine has through
NeuraOS:

| Tool | What it does |
| :-- | :-- |
| `neuraos_status` | the llama-server the app started (if answering), Ollama's models, the image server, the GPU facts |
| `neuraos_models` | GGUF files in NeuraOS's folder and the usual caches, Ollama's tags |
| `neuraos_chat` | one prompt (optional system prompt, `max_tokens`) to the running llama-server, else Ollama (`model` picks one); free and private |
| `neuraos_image` | `/v1/images/generations` on the running sd-server; answers the PNG's path |
| `neuraos_open` | starts NeuraOS with a folder or a file (the single-instance plugin hands it to the running window) |

It is a separate process, so the app writes `local-model.json` (port, its
own per-run bearer token, model, pid; mode 0600) in its data folder when
it starts llama-server and removes it on stop; `--mcp` reads it and
checks `/health` before trusting it. The bundled engine is not exposed:
its `/api/*` routes want a signed-in session cookie. Settings →
Connectors → "Use NeuraOS from other agents" copies
`claude mcp add neuraos -- <launcher> --mcp`, the Gemini CLI line, or an
`mcpServers` JSON.

Verified here: `cargo test` (initialize, tools/list, notifications,
protocol vs tool errors, the state file), and the built debug binary
driven over stdin with no DISPLAY and no session bus: initialize,
tools/list, neuraos_status (GPU facts, nothing running), neuraos_chat
("no model is running" as a tool error), neuraos_models, a non-JSON line
(-32700, the loop goes on), neuraos_open on a missing path. Not verified:
a real chat through llama-server or Ollama (neither runs here), an image,
Claude Code's own `mcp add` end to end.

## L8/L9: the Wayland portals, and desktop control

`portal.rs` (Linux only) talks to xdg-desktop-portal through `ashpd`, the
crate `rfd` already compiled in (its `async-std` feature; nothing new in
`Cargo.lock`):

- **Screenshot**: `desktop_screenshot` takes one frame into the app's cache
  folder and answers a PNG data URL with its size. X11 tries the plain tools
  first (`gnome-screenshot`, `scrot`, ImageMagick's `import`; no dialog),
  then the portal; Wayland the portal first, then `grim`. The chat's
  `/screenshot` command and `captureScreen()` use it in the Linux app
  (WebKitGTK has no `getDisplayMedia` picker).
- **GlobalShortcuts**: on a Wayland session the Quick, selection, Voice
  Type and screen-ask chords are bound through the portal
  (`portal_shortcuts_bind`, sent by App.tsx at start with the saved
  combos; a no-op on X11 where the plugin's grab works). The portal's
  spelling of a chord (`CTRL+ALT+space`) is a tested pure function. A
  rebind closes the old session first so a chord fires once.
- **RemoteDesktop**: Voice Type falls back to the portal when `wtype` is
  missing or refused (Cinnamon and GNOME have no virtual-keyboard
  protocol); desktop control uses it for typing, key chords (keysyms, a
  tested table), and, when the desktop also shares a monitor stream in
  the same session, absolute pointer moves and clicks. One session per
  app run, opened on first use with the restore token kept beside the
  renderer-mode file, so the desktop asks once.
- **Selection on Wayland**: `wl-paste --primary` when arboard's
  data-control protocol is not offered (Cinnamon, GNOME); `xclip` on X11.

Desktop control (L9), off by default in Settings → Desktop control: five
tools a model may call, every one behind an Allow / Deny card
(`tools.js` ASKS), executed by `desktop_act` -- xdotool on X11, the portal
on Wayland -- after `plan()` checks every number and string (bounded text,
a chord of key names only, on-screen coordinates, a real button, a bounded
scroll). `screen_capture` returns text and attaches the picture as a user
turn with image parts right after the tool message (`imagesFor` in
agent-turn.ts), the one shape every vision model reads. Screen-ask
(`Ctrl+Alt+S` from any app, remappable in Shortcuts; the palette's "Ask
about the screen"; the button in Settings) shows the window, goes to Chat
and attaches a screenshot.

Verified here: `cargo test` (plan, xdotool arguments, tool choice per
session, PNG header, chord spelling, keysyms), a real screenshot under
Xvfb through `scrot` (`cargo test -- --ignored a_real_screenshot` under
`xvfb-run`), `node --test` (the tools are offered only with the toggle and
a shell, all ask, summaries), `tsc`, `npm run build`. Not verified: any
portal (this container has no xdg-desktop-portal), a Wayland session,
xdotool clicks landing in a real app, the Settings card on Mint.

## First Mint machine: the renderer guard becomes the default

The first install on real Mint hardware (`neura-os-desktop_2.11.0_amd64.deb`
from the CI artifact, Intel graphics, X11) started, ran the bundled engine
and signed in -- and drew Settings as coloured bands with smeared text.
That is WebKitGTK's DMA-BUF renderer, which the guard only turned off on the
NVIDIA proprietary driver. Now (`linux.rs` dmabuf):

- the default mode is **safe**: `WEBKIT_DISABLE_DMABUF_RENDERER=1` on every
  machine (shared-memory compositing, a little CPU, draws right);
- **gpu** keeps the renderer (still off on NVIDIA); **basic** also sets
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` for a machine where safe misdraws;
- the choice lives in `~/.config/com.freeai4u.desktop/renderer-mode`, read
  before Tauri starts, chosen in Settings → Diagnostics → Renderer with a
  "Restart NeuraOS now" button; an explicit `WEBKIT_*` variable in the
  environment always wins. Diagnostics reports the mode and both variables.

Verified here: `env_for` unit tests, the app starting under Xvfb with the
default. Not verified: that safe (or basic) fixes the bands on that Intel
machine -- the next real-hardware run is the check.

## L7: the release pipeline and the in-app updater on Linux

- `.github/workflows/release.yml`: a `v*` tag (or a manual run) builds on
  Ubuntu 22.04, runs the same tests and the Xvfb smoke gate as `linux.yml`,
  stages the bundles as `neura-os-desktop_<v>_amd64.deb` and
  `NeuraOS-<v>-x86_64.AppImage` with `SHA256SUMS` and
  `desktop-version.json` (`packaging/release/stage.sh`), signs the manifest
  with `tauri signer` when the `TAURI_SIGNING_PRIVATE_KEY` secret exists,
  publishes a Release with `gh` (built-in token, no third-party action),
  then rebuilds the apt repository and deploys it to GitHub Pages
  (`actions/deploy-pages`) when the `APT_GPG_PRIVATE_KEY` secret exists.
  A manual run with *publish* unticked is the dry run. The tag must match
  the app version.
- The package name is `neura-os-desktop` (Tauri kebab-cases the product
  name); the README, the apt docs and the Release notes now say so.
- `packaging/release/make-keys.sh` creates both keys on the maintainer's
  machine and hands the private halves to GitHub with `gh secret set`;
  nothing is printed or committed ("secrets never travel").
- In the app: `install_kind` on Linux answers `appimage` (APPIMAGE set),
  `deb` (under /usr or /opt) or `portable`; `update.js` picks the matching
  artifact and reads the Linux repo through `releases/latest/download/`;
  `run_installer` swaps an AppImage in place (copy beside, chmod, atomic
  rename, restart) and hands a `.deb` to `xdg-open` (Mint: the package
  installer), telling the person to restart when it is done.

Verified here: `cargo test` (the Linux kind rules, the AppImage swap on a
temp file, and a real `tauri signer` signature accepted by
`verify_manifest`), `node --test` (the manifest `stage.sh` writes, the
URLs, the artifact choice), `tsc`, `npm run build`. Not verified: a real
Release (needs the tag and the keys), the apt job on Pages, the update
banner against a published manifest, `xdg-open` handing a `.deb` to gdebi
on Mint.

## L7/L8: the apt repository tooling and the CI smoke gate

- `packaging/apt/build-repo.sh` builds `pool/`, `Packages(.gz)`, `Release`,
  `Release.gpg`, `InRelease` and exports `neuraos.gpg`. Proven in the
  container with a throwaway key and a placeholder `.deb`: `apt-get update`
  from the folder accepted the signed `InRelease` and `apt-cache policy`
  resolved `neuraos-desktop`. Publishing needs the maintainer's own key
  (`docs/MASTER_PLAN.md` section 10, item 6) and a Pages host; the README
  there has the steps and the user-side `neuraos.list`.
- `.github/workflows/linux.yml` now runs `scripts/screenshot-smoke-test.sh`
  on the release binary under Xvfb after the bundle step: a process that
  dies within 12 s, or a PANIC/FATAL line in the app's log, fails the job,
  and the screenshot is uploaded as an artifact next to the bundles.

## L3/L4: one-click runtimes and the hardware card

`runtimes.rs` installs, without sudo and only under the app's own data
folder (`~/.local/share/com.freeai4u.desktop/runtimes`):

- **Node 24** from `nodejs.org/dist/latest-v24.x/`: the tarball is checked
  against that folder's `SHASUMS256.txt` and refused on a mismatch, then
  unpacked with the system `tar`. `engine.rs::find_node` tries it first.
  Settings → Engine shows "Download Node 24 for NeuraOS" whenever no usable
  Node is found. Recipe proven in this container: sha matches, `tar -xJf`
  unpacks, `node --version` answers v24.21.0.
- **llama.cpp** (Vulkan or CPU): the newest release from GitHub's API, the
  `ubuntu-vulkan-x64` / `ubuntu-x64` zip, unpacked with `unzip`, and
  `llama-server` plus its `lib*.so` copied into the folder `models.rs`
  looks in first. GitHub publishes no digest for these, so the result says
  `verified: false` and records the sha256 we computed in `llama.json`.
  Not run end to end here: this container's proxy refuses github.com API
  and page requests (release downloads themselves pass).
- **The hardware line** (`linux::gpu`): vendor from `/sys/class/drm`,
  VRAM from `mem_info_vram_total` (amdgpu) or `nvidia-smi`, the name from
  `lspci`, whether a Vulkan ICD is installed, and a size suggestion
  (`suggestion()`: Q4 in the 4 GB class, Q5/Q6 above, CPU sizes when no
  GPU memory is reported). Shown in Settings → Local models.
- **The engine as a systemd user service** (Settings → Engine): writes
  `~/.config/systemd/user/neuraos-engine.service` running the same Node and
  `server.js` on `127.0.0.1:47831`, `enable --now`; `engine_status` and
  "run it here" find that engine first. Firefox at that address shows the
  same NeuraOS. Not run here (no systemd user session in the container).

Not done: whisper.cpp one-click (no Linux release binaries exist),
sd.cpp one-click (asset naming unverified from here), tokens/s in the
status bar, and an in-app updater for the `.deb`/AppImage (`net.rs`'s
update flow is upstream's Windows nsis/msi path and its manifest is
upstream's release feed; on Linux `install_kind` reports "portable", so
the banner saves the download and the person installs it -- the apt
repository in `packaging/apt/` is the Mint answer, the AppImage feed is
still open).

## Shell hardening on Linux (harness functions), from a survey of 11 Tauri apps

Patterns taken from a read of openhuman, racemo, barqly-vault, 3uxo,
tauri-app-template, create-tauri-react, whisper-ui, UniGit and
tauri-plugin-decorum (TauriKit and stark turned out to hold no Tauri code):

- **The login shell's PATH, adopted at startup** (`linux::path_env::fix`,
  barqly-vault's `fix_path_env` idea, done in 30 lines): a GUI process on
  Cinnamon has the display manager's PATH, so `~/.local/bin`, nvm and cargo
  were invisible to every lookup and spawn. Merged, login entries first,
  nothing dropped; unit-tested.
- **Single-instance only with a session D-Bus** (`linux::dbus`): the plugin
  panics without one (TTY-launched AppImage, bare Xvfb). Probed first; no
  bus means one crash-log line and a second window, not a dead app.
- **A tray that fails is not fatal, and close-to-tray needs a tray**
  (`TRAY_OK`): openhuman disables its tray on Linux over GTK panics in
  packaged runs. Here the tray is attempted, a failure logged, and the
  close button then quits cleanly (child servers stopped) instead of hiding
  the window into a tray that is not there.
- **Start at login, into the tray** (`tauri-plugin-autostart`, Settings →
  Startup, `--hidden`): an `~/.config/autostart` entry the OS owns; the
  toggle reads back what the OS has. `--hidden` is honoured only when the
  tray exists, for the same reason as above.
- **A crash screen with Relaunch** (`components/CrashScreen.tsx`,
  `app_relaunch`): a render error after boot used to unmount everything into
  a blank window (only boot-time faults had a screen). Relaunch goes through
  Tauri's restart so the shutdown runs and window state is saved.
- **Native decorations stay; the in-app titlebar goes on Linux.**
  tauri-plugin-decorum's own Linux path leaves decorations to the WM, and
  Cinnamon's titlebar keeps theme colours, tiling and resize grips. The
  32px in-app bar under it was dead space: not rendered on Linux, its theme
  toggle now in the sidebar footer, and the sidebar brand is the real
  emblem (`app/assets/branding/neuraos-emblem.svg`) instead of an "N" box.
  Verified with `scripts/screenshot-smoke-test.sh` on the debug build.

Deliberately not taken: a custom CSD titlebar (loses WM resize/tiling on
X11), openhuman's hand-rolled window-state (the plugin already does it),
Sentry (secrets-never-travel; the crash log stays local), a bundled
whisper sidecar (whisper.cpp ships no Linux binaries; a source build stays
the L4 answer).

## L2: the five spaces, the orb and the Activity space

- **Five spaces** (`Sidebar.tsx` `NAV_ITEMS`): Chat (Chat · Builds), Code
  (Agent · Local · Files · Parallel), Create (Design · Images), Agents
  (Library · Agents · Recipes), Activity (Activity · Evals) on Alt+1..5.
  Settings left the spaces: it is the account row at the foot of the rail
  and `Ctrl+,` (added to `shared/keymap.js`). Every earlier view still
  exists as a tab, nothing was removed.
- **The orb** (`.orb`, rail): click = dictate (the Chat screen's mic, via
  `ORB_EVENT`), hold = new chat. It pulses while any chat streams or a tool
  runs (`threads.ACTIVITY_EVENT`) and breathes while listening
  (`DICTATION_EVENT`); both stop under Reduce motion. "Calm until it thinks".
- **Activity** (`screens/ActivityScreen.tsx`): the recipe approval queue
  first (answerable in place, badge on the rail), then what runs on this
  machine (streaming chats, the local model server, the local engine), then
  the schedules with their next run. Reads the modules that already own
  those facts; no new store.
- **Follow the system theme** (Settings → Appearance): `prefers-color-scheme`
  from Mint's Themes panel drives dark/light while it is on.
- **The APK's gestures on a keyboard** (`BuildScreen.tsx`): A / R, or
  Ctrl+Enter / Ctrl+Backspace, approve or reject the waiting change.
- From the survey: the page now writes into the shell's crash log
  (`log_client_event`: render errors, window errors, unhandled rejections)
  and Diagnostics has "Open the logs folder" (`crash_log_reveal`,
  `xdg-open` on the app's own log directory only). The palette already
  matched by words and Shortcuts already captured combos, so neither needed
  the survey's version; a mic-device picker is deferred to Voice Type (L5).

Verified with a headless screenshot of the debug build: the rail shows the
five spaces, the orb and the Settings row. Not verified: the orb's pulse
and breath on a streaming chat (needs an engine), and A/R on a real build.

## L2: the APK's look, so far (accent)

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

A first look at renaming "Design" to "Create" (the master plan's own
wording) found it isn't the small, contained change it looks like: the
same word names the `/design` composer mode, a command-palette entry and
export-file defaults (`composer.js`, `commands.js`, `design/exports.js`),
so renaming only the rail label would leave the app calling the same
thing two different names in different places -- worse than not renaming
it. A real rename needs all of those touched together, deliberately, not
as a side effect of a nav pass.

**A real verification loop now exists for this phase** (section below):
Xvfb + a real D-Bus session + `scrot` produces an actual screenshot of
the running app, which can be inspected before anything is claimed to
look right. Future L2 UI work should render → screenshot → look, the
same way a code change gets `cargo test` before it's called done.

## A real screenshot, and what it found

Xvfb (a virtual X server) plus a real D-Bus session bus (`dbus-launch`)
let the actual built binary run further than the first smoke test could:
`wmctrl`/`xdotool` see a genuine window titled "NeuraOS", and `scrot`
captured it. The page renders correctly: the Connect-to-an-engine screen,
styled, readable, with a live "unreachable" status for the default Railway
engine (expected -- this container has no route to it).

This also surfaced a real, useful finding about W8 (the Secret Service
keyring backend):

1. With no D-Bus session bus at all: the app warns "the encrypted store
   is unavailable ... The name org.freedesktop.secrets was not provided
   by any .service files" -- graceful, not a crash.
2. With a bus but no `gnome-keyring-daemon` (or another Secret Service
   provider) running: the same warning.
3. With `gnome-keyring-daemon --start --components=secrets` running: the
   D-Bus name resolves, but the warning changes to "Secret Service: no
   result found" -- there is no default (unlocked) collection yet.
4. Creating one needs an interactive prompt
   (`org.freedesktop.Secret.Prompt`, normally a "set a keyring password"
   dialog) that has nothing to answer it headlessly, so it hangs. This is
   as far as a container without a real login session can go.

**What this means for real Mint hardware:** Cinnamon's login unlocks the
default "Login" keyring automatically via PAM (`pam_gnome_keyring`) using
the login password, which is exactly step 4 above happening invisibly at
login instead of hanging. On a normal Mint desktop session this should
just work. **If the installed app ever shows this same "credential store
unavailable" warning on a real machine**, it means `gnome-keyring-daemon`
either isn't running or isn't PAM-unlocked for that session --
`systemctl --user status` won't show it (it's not a systemd unit by
default), but `echo -n test | secret-tool store --label=t service t
account t` hanging or erroring is the same symptom this test hit, and is
the thing to debug first.

Not yet verified anywhere (needs real Mint hardware): the 10-step checklist
in `docs/MASTER_PLAN.md` section 7 — installing the `.deb` with `apt`,
launching it, a reboot to confirm keyring secrets persist, the real PTY
terminal, the `Ctrl+Alt+Space` Quick-window hotkey (and that it doesn't
collide with Cinnamon's own bindings), a BYOK endpoint round-trip, Ollama,
and the NVIDIA/DMA-BUF guard on a machine that actually has an NVIDIA GPU.
None of this can be ticked off from a headless container with no display,
no session bus user session, and no GPU — say so plainly rather than
claiming it, and treat it as this phase's real remaining work.
