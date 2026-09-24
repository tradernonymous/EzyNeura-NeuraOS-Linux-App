# EzyNeura-NeuraOS-Linux-App
To develop a working futuristic but minimalistic ai app on Linux Mint with chat, coding and design tools.

NeuraOS for Linux Mint: the look of the NeuraOS Android app, every feature of the Windows desktop app, and the same engine as the web app ([tradernonymous/freeopenai](https://github.com/tradernonymous/freeopenai)).

## Download

[![Download the .deb](https://img.shields.io/badge/Download-.deb%20for%20Linux%20Mint-7c3aed?logo=linuxmint&logoColor=white)](https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/releases/latest)

**[Get the latest `.deb` from Releases →](https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/releases/latest)**
Under **Assets**, download the file ending in `_amd64.deb`. The same page also has a portable `.AppImage`.

| | |
| :-- | :-- |
| **Runs on** | Linux Mint 21.x, 22.x and 23, and Ubuntu 22.04 or newer (64-bit `amd64`) |
| **Package** | `.deb` (recommended on Mint) or `.AppImage` (any distro, no install) |
| **Updates** | In-app: a banner offers each new release, and one click installs it. Or the apt repository (`packaging/apt/README.md`) for Mint's Update Manager |

### Install the `.deb`

Either double-click the downloaded file to open it in Mint's package installer, or run this in a terminal from the folder you saved it to:

```bash
sudo apt install ./neura-os-desktop_*_amd64.deb
```

`apt` pulls in what the app needs (`libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`, `libdbus-1-3`) and recommends `libvulkan1` (GPU models), `xdotool` (Voice Type) and `bubblewrap` (the light sandbox). NeuraOS Desktop then shows up in the Mint menu.

To uninstall: `sudo apt remove neura-os-desktop`

### Run the AppImage instead

```bash
chmod +x NeuraOS*.AppImage
./NeuraOS*.AppImage
```

### Latest development build

Every push to `main` builds a fresh `.deb` and AppImage in CI and smoke-tests the binary under a virtual display. To try one before it's released, open the newest green [Linux workflow run](https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/actions/workflows/linux.yml), scroll to **Artifacts** and download `neuraos-linux-<commit>` (you need to be signed in to GitHub). The zip holds a `deb/` and an `appimage/` folder, and the file names contain a space, so install it like this:

```bash
cd ~/Downloads
unzip -o neuraos-linux-*.zip
sudo apt install ./deb/*.deb
```

The run's `neuraos-smoke-screenshot` artifact is what that build looks like on first start.

### Updates

An installed copy checks the [latest release](https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/releases/latest) once an hour and shows a banner. **Install** downloads the new `.deb` (sha256-checked against the signed manifest) and opens Mint's package installer with it; an AppImage swaps itself for the new file and restarts. With the apt repository added (`packaging/apt/README.md`), Update Manager offers new versions too.

## What you get on Mint

**Five spaces, one orb.** `Alt+1`–`Alt+5`: **Chat** (chat, plan, builds), **Code** (agent, local folder, files, parallel worktrees, ACP agents), **Create** (design, images), **Agents** (library, agents, recipes), **Activity** (everything waiting for you or running). The orb at the foot of the rail: click to dictate, hold for a new chat; it pulses while any agent works. Settings is the account row, or `Ctrl+,`. `Ctrl+K` reaches everything.

**Local models on your GPU.** Settings → Local models shows your GPU, its memory and what size of model fits, and downloads the official llama.cpp build (Vulkan for NVIDIA, AMD and Intel alike, or CPU-only) into the app's own folder — no sudo. Ollama, an unzipped llama.cpp, whisper.cpp and sd.cpp are found wherever Linux installs put them.

**The engine on your machine.** Settings → Engine downloads Node 24 (sha256-checked from nodejs.org) if Mint's is too old, runs the bundled engine on `127.0.0.1`, and can keep it running as a systemd user service after the window closes — Firefox at `127.0.0.1:47831` then shows the same NeuraOS, and your phone can reach it on the LAN.

**NeuraOS as an MCP server.** `freeai4u-desktop --mcp` lets Claude Code, Gemini CLI, Codex or any MCP client ask the models running on this machine (`neuraos_chat`), draw with the image server, list what the PC has, and open a folder in NeuraOS. Settings → Connectors copies the `claude mcp add` line.

**Coding agents behind NeuraOS's approvals.** Code → Agents (ACP) runs Gemini CLI, Claude Code, Codex or any [Agent Client Protocol](https://agentclientprotocol.com) agent inside the open folder. Every file it wants to write and every permission it asks for is a card — and a desktop notification with **Allow / Reject** buttons, so you can keep working in another window.

**Linux-native.**
- **Voice Type** (Settings → Dictation): hold `Ctrl+Alt+V` anywhere, speak, let go — the words are typed into VS Code, the terminal, the browser. Mint's answer to Win+H.
- **Ask about the selection**: highlight text in any app, press the selection hotkey, and the Quick window opens with it.
- **Ask about the screen**: `Ctrl+Alt+S` in any app (or the palette) takes a screenshot into the chat. Settings → Desktop control lets a model take screenshots, click, type and press keys itself, each behind an Allow card: xdotool on X11, the RemoteDesktop portal on Wayland.
- **Wayland-ready** (Mint 23): screenshots, the global hotkeys and Voice Type go through xdg-desktop-portal when the session is Wayland; X11 stays the default path.
- **Nemo right-click actions**: open a folder in NeuraOS Code, ask about a file, inspect a GGUF (Settings → Startup and desktop).
- **Start at login, into the tray**; the tray icon shows a cyan dot while an agent works and an amber one when something needs your OK.
- **Sandboxes**: bubblewrap (no daemon, no image, no network) beside Docker and Podman for the commands an agent runs.
- Native Cinnamon titlebar, follows Mint's dark/light setting, secrets in your login keyring (Seahorse), reduce-motion respected.

## Build it yourself

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libsoup-3.0-dev libdbus-1-dev patchelf
cd app/desktop
npm install
npx tauri build --bundles deb,appimage
```

The `.deb` ends up in `app/desktop/src-tauri/target/release/bundle/deb/`. Checks a contributor runs: `npx tsc --noEmit`, `npm run build`, `node --test 'app/test/*.test.js'`, `cargo test --manifest-path app/desktop/src-tauri/Cargo.toml`, and `scripts/screenshot-smoke-test.sh` for a headless look at the window.

## Plan and status

[docs/MASTER_PLAN.md](docs/MASTER_PLAN.md): the porting audit, design, architecture, phases L0–L9 and what you do yourself. [docs/BACKLOG.md](docs/BACKLOG.md): what each phase has landed, what was verified where, and what still needs a real Mint machine.
