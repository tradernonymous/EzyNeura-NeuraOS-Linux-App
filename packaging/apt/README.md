# The NeuraOS apt repository (L7)

`build-repo.sh` turns the `.deb` CI builds into a signed apt repository:
`pool/`, `dists/stable/main/binary-amd64/Packages(.gz)`, a `Release` with
`Release.gpg` and `InRelease`, and the public key `neuraos.gpg`. Published as
static files, Mint's Update Manager then upgrades NeuraOS like any package.

## One-time, by the maintainer

1. Create a signing key and back it up outside this repository. It is never
   regenerated: every installed `neuraos.list` trusts this one key.
   ```bash
   gpg --quick-generate-key "NeuraOS apt <apt@neuraos.example>" ed25519 sign 0
   gpg --armor --export-secret-keys <key-id> > neuraos-apt-private.asc   # back this up, then delete the file
   ```
2. Decide where the static files live (GitHub Pages of this repository, or
   any https host) and put that address in `neuraos.list.example` and the
   README's install section.

## Every release

```bash
packaging/apt/build-repo.sh out/apt <key-id> app/desktop/src-tauri/target/release/bundle/deb/*.deb
```
Then publish `out/apt` as-is. In CI this is one job that runs after the
build with the private key as a secret (`gpg --import` from
`APT_GPG_PRIVATE_KEY`), and pushes `out/apt` to the Pages branch.

## What a user does once

```bash
sudo install -d /etc/apt/keyrings
curl -fsSL https://<host>/neuraos.gpg | sudo tee /etc/apt/keyrings/neuraos.gpg >/dev/null
echo 'deb [signed-by=/etc/apt/keyrings/neuraos.gpg] https://<host> stable main' | sudo tee /etc/apt/sources.list.d/neuraos.list
sudo apt update && sudo apt install neuraos-desktop
```
After that, updates arrive through Update Manager.

## Checked here

`build-repo.sh` was run in the build container with a throwaway key and a
placeholder `neuraos-desktop_2.11.0_amd64.deb` (made with `dpkg-deb`, so the
repository format was under test, not the app): `apt-ftparchive` wrote the
`Release`, `gpg` signed `Release.gpg` and `InRelease`, `apt-get update` from
a `file://` source accepted them, and `apt-cache policy neuraos-desktop`
resolved version 2.11.0. The throwaway key was discarded; the real key is
the maintainer's step 1 above.
