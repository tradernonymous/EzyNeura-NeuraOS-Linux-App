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
| **Updates** | Manual for now: download the newer `.deb` and install it over the old one. Updates through Mint Update Manager arrive with the apt repo (phase L7) |

### Install the `.deb`

Either double-click the downloaded file to open it in Mint's package installer, or run this in a terminal from the folder you saved it to:

```bash
sudo apt install ./NeuraOS*_amd64.deb
```

`apt` pulls in what the app needs (`libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`, `libsecret-1-0`). NeuraOS Desktop then shows up in the Mint menu.

To uninstall: `sudo apt remove neuraos-desktop`

### Run the AppImage instead

```bash
chmod +x NeuraOS*.AppImage
./NeuraOS*.AppImage
```

### Latest development build

Every push to `main` builds a fresh `.deb` and AppImage in CI. To try one before it's released, open the newest green [Linux workflow run](https://github.com/tradernonymous/EzyNeura-NeuraOS-Linux-App/actions/workflows/linux.yml), scroll to **Artifacts** and download `neuraos-linux-<commit>` (you need to be signed in to GitHub). Unzip it and install the `.deb` inside as shown above.

## Build it yourself

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libsoup-3.0-dev libdbus-1-dev patchelf
cd app/desktop
npm install
npx tauri build --bundles deb,appimage
```

The `.deb` ends up in `app/desktop/src-tauri/target/release/bundle/deb/`.

## Plan

[docs/MASTER_PLAN.md](docs/MASTER_PLAN.md): the porting audit, design, architecture, phases L0–L9 and what you do yourself.
