# The NeuraOS apt repository (L7)

`build-repo.sh` turns the `.deb` CI builds into a signed apt repository:
`pool/`, `dists/stable/main/binary-amd64/Packages(.gz)`, a `Release` with
`Release.gpg` and `InRelease`, and the public key `neuraos.gpg`. Published as
static files, Mint's Update Manager then upgrades NeuraOS like any package.

## One-time, by the maintainer

`packaging/release/make-keys.sh` creates the signing key on your machine and
stores it as the `APT_GPG_PRIVATE_KEY` secret (`packaging/release/README.md`).
It is never regenerated: every installed `neuraos.list` trusts this one key.
The static files live on this repository's GitHub Pages
(`https://tradernonymous.github.io/EzyNeura-NeuraOS-Linux-App`), deployed
by the Release workflow; enable **Settings → Pages → Source: GitHub Actions**.

## Every release

The `apt` job of `.github/workflows/release.yml` runs this after the Release
is published: it imports the key from the secret, runs
```bash
packaging/apt/build-repo.sh out/apt <key-id> release/*.deb
```
adds `index.html` and deploys `out/apt` to Pages. The repository carries the
current version only; older `.deb` files stay on the Releases page.

## What a user does once

```bash
sudo install -d /etc/apt/keyrings
curl -fsSL https://tradernonymous.github.io/EzyNeura-NeuraOS-Linux-App/neuraos.gpg | sudo tee /etc/apt/keyrings/neuraos.gpg >/dev/null
echo 'deb [signed-by=/etc/apt/keyrings/neuraos.gpg] https://tradernonymous.github.io/EzyNeura-NeuraOS-Linux-App stable main' | sudo tee /etc/apt/sources.list.d/neuraos.list
sudo apt update && sudo apt install neura-os-desktop
```
After that, updates arrive through Update Manager.

## Checked here

`build-repo.sh` was run in the build container with a throwaway key and a
placeholder `neura-os-desktop_2.11.0_amd64.deb` (made with `dpkg-deb`, so the
repository format was under test, not the app): `apt-ftparchive` wrote the
`Release`, `gpg` signed `Release.gpg` and `InRelease`, `apt-get update` from
a `file://` source accepted them, and `apt-cache policy neura-os-desktop`
resolved version 2.11.0. The throwaway key was discarded; the real key is
the maintainer's step 1 above.
