# Releasing NeuraOS for Linux

`.github/workflows/release.yml` turns a version tag into a GitHub Release
(the `.deb`, the AppImage, `SHA256SUMS`, and the update manifest
`desktop-version.json` with its signature) and rebuilds the apt repository
on GitHub Pages. The app's own update check (Settings status bar, the
banner at the top of the window) reads that manifest from
`releases/latest/download/`, so a published release reaches installed
copies within the hour.

## Once, by the maintainer

```bash
gh auth login                       # if not already
packaging/release/make-keys.sh      # creates both keys, sets the secrets
```

The script creates two keys on your machine under `~/.neuraos-release/`
and hands the private halves to GitHub with `gh secret set` -- nothing is
printed, nothing lands in the repository. Back that folder up.

| Name | Kind | Used by |
| :-- | :-- | :-- |
| `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`, empty) | secret | signing `desktop-version.json` (minisign) |
| `NEURAOS_UPDATER_PUBKEY` | variable | compiled into the app: it refuses a manifest signed by any other key |
| `APT_GPG_PRIVATE_KEY` | secret | signing the apt repository's `Release` file |

Then enable Pages: repository **Settings → Pages → Source: GitHub Actions**.

Without the signing pair, releases still publish; the app then checks the
sha256 digests only and says so. Without the GPG key the apt job is skipped.

## Every release

1. Bump the version in the three places the wiring test pins together:
   `app/desktop/package.json`, `app/desktop/src-tauri/tauri.conf.json`,
   `app/desktop/src-tauri/Cargo.toml` (and `src/version.ts`).
2. Merge to `main` and wait for the Linux workflow to go green.
3. Tag and push:
   ```bash
   git tag v2.11.0 && git push origin v2.11.0
   ```
The Release workflow refuses a tag whose version does not match the app's.

## Dry run

**Actions → Release → Run workflow** with *publish* unticked builds, stages
and signs everything and uploads it as the `neuraos-release-<version>`
artifact, publishing nothing. Tick *publish* to publish from `main`
without a tag (the workflow then creates the tag itself).

## What the user sees

* Releases page: `neura-os-desktop_<version>_amd64.deb`,
  `NeuraOS-<version>-x86_64.AppImage`, `SHA256SUMS`.
* Installed `.deb`: the update banner offers the new `.deb`; **Install**
  downloads it (sha256-checked) and opens Mint's package installer with it.
  With the apt repository added (`packaging/apt/README.md`), Update Manager
  offers it too.
* AppImage: **Install** downloads the new AppImage, checks it, swaps it in
  place of the running file and restarts.
