#!/usr/bin/env bash
# One-time, on the maintainer's own machine: create the two keys a release
# needs and hand them to GitHub as secrets -- without either private key
# ever being printed, pasted, or written into this repository.
#
#   1. The update-signing key (minisign, made by `tauri signer`): CI signs
#      desktop-version.json with it, and the app -- built with the public
#      half -- refuses a manifest signed by anyone else (net.rs).
#   2. The apt repository key (GPG): CI signs the Release file with it, and
#      every installed neuraos.list trusts that one key. NEVER regenerate it
#      once a user has installed the repository.
#
# Needs: the GitHub CLI signed in (`gh auth login`) with admin on the repo,
# node (for `npx tauri`), and gpg. Run from the repository root:
#
#   packaging/release/make-keys.sh
#
# Back up ~/.neuraos-release/ afterwards, somewhere outside the repository.
set -euo pipefail

REPO="${REPO:-tradernonymous/EzyNeura-NeuraOS-Linux-App}"
KEYS="${KEYS:-$HOME/.neuraos-release}"
mkdir -p "$KEYS"
chmod 700 "$KEYS"

for tool in gh gpg node npx; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login" >&2; exit 1; }

# ---- 1. the update-signing key ---------------------------------------------
if [ ! -s "$KEYS/updater.key" ]; then
  echo "Creating the update-signing key in $KEYS/updater.key"
  ( cd app/desktop && npx tauri signer generate -w "$KEYS/updater.key" -p "" --ci >/dev/null )
fi
chmod 600 "$KEYS/updater.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$KEYS/updater.key"
printf '' | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO"
gh variable set NEURAOS_UPDATER_PUBKEY --repo "$REPO" --body "$(cat "$KEYS/updater.key.pub")"
echo "Update-signing key: secret TAURI_SIGNING_PRIVATE_KEY and variable NEURAOS_UPDATER_PUBKEY set."

# ---- 2. the apt repository key ---------------------------------------------
UID_TEXT="NeuraOS apt <apt@neuraos.local>"
keyid=$(gpg --batch --list-secret-keys --with-colons "$UID_TEXT" 2>/dev/null | awk -F: '/^sec/ { print $5; exit }' || true)
if [ -z "$keyid" ]; then
  echo "Creating the apt repository key ($UID_TEXT)"
  gpg --batch --passphrase '' --quick-generate-key "$UID_TEXT" ed25519 sign 0
  keyid=$(gpg --batch --list-secret-keys --with-colons "$UID_TEXT" | awk -F: '/^sec/ { print $5; exit }')
fi
gpg --batch --yes --armor --export-secret-keys "$keyid" > "$KEYS/apt-private.asc"
chmod 600 "$KEYS/apt-private.asc"
gpg --batch --yes --armor --export "$keyid" > "$KEYS/apt-public.asc"
gh secret set APT_GPG_PRIVATE_KEY --repo "$REPO" < "$KEYS/apt-private.asc"
echo "apt key $keyid: secret APT_GPG_PRIVATE_KEY set; public key in $KEYS/apt-public.asc."

cat <<DONE

Done. Two things left, in the repository's Settings on github.com:
  * Pages -> Build and deployment -> Source: "GitHub Actions" (the apt
    repository is deployed there by the Release workflow).
  * Nothing else: releases use the built-in GITHUB_TOKEN.

Back up $KEYS outside this repository. Then cut a release:
  git tag v\$(node -p "require('./app/desktop/package.json').version") && git push origin --tags
DONE
