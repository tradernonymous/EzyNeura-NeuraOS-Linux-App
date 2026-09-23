#!/usr/bin/env bash
# Build a signed apt repository from one or more NeuraOS .deb files, ready
# to publish as static files (GitHub Pages, any web server). Once it is
# online, Mint's Update Manager upgrades NeuraOS like any other package
# (docs/MASTER_PLAN.md section 7, L7).
#
# Usage:
#   packaging/apt/build-repo.sh <out-dir> <key-id> <file.deb> [more.deb...]
#
# Needs: dpkg-scanpackages (dpkg-dev), apt-ftparchive (apt-utils), gpg, and
# a GPG key you created and backed up outside the repo (never regenerate
# it: every installed neuraos.list trusts that one key). The private key
# never touches this repository; in CI it arrives as a secret.
#
# What the person installs (packaging/apt/neuraos.list.example and the
# README): the public key into /etc/apt/keyrings/neuraos.gpg and one line
# in /etc/apt/sources.list.d/neuraos.list.

set -euo pipefail

OUT="${1:?out-dir}"
KEY="${2:?gpg key id}"
shift 2
[ "$#" -ge 1 ] || { echo "no .deb given" >&2; exit 1; }

for tool in dpkg-scanpackages apt-ftparchive gpg; do
  command -v "$tool" >/dev/null || { echo "Missing $tool (apt install dpkg-dev apt-utils gnupg)" >&2; exit 1; }
done

SUITE=stable
COMP=main
ARCH=amd64
POOL="$OUT/pool/$COMP"
DIST="$OUT/dists/$SUITE"
BIN="$DIST/$COMP/binary-$ARCH"

mkdir -p "$POOL" "$BIN"
for deb in "$@"; do
  cp -f "$deb" "$POOL/"
done

# Packages and Packages.gz, with paths relative to the repository root.
( cd "$OUT" && dpkg-scanpackages --arch "$ARCH" "pool/$COMP" /dev/null > "dists/$SUITE/$COMP/binary-$ARCH/Packages" )
gzip -9 -k -f "$BIN/Packages"

# The Release file with the digests of everything under dists/, then the
# detached (Release.gpg) and inline (InRelease) signatures.
( cd "$DIST" && apt-ftparchive \
    -o "APT::FTPArchive::Release::Origin=NeuraOS" \
    -o "APT::FTPArchive::Release::Label=NeuraOS" \
    -o "APT::FTPArchive::Release::Suite=$SUITE" \
    -o "APT::FTPArchive::Release::Codename=$SUITE" \
    -o "APT::FTPArchive::Release::Architectures=$ARCH" \
    -o "APT::FTPArchive::Release::Components=$COMP" \
    -o "APT::FTPArchive::Release::Description=NeuraOS for Linux Mint" \
    release . > Release )
gpg --batch --yes --local-user "$KEY" -abs -o "$DIST/Release.gpg" "$DIST/Release"
gpg --batch --yes --local-user "$KEY" --clearsign -o "$DIST/InRelease" "$DIST/Release"

# The public key, in the binary form /etc/apt/keyrings wants.
gpg --batch --yes --export "$KEY" > "$OUT/neuraos.gpg"

echo "Repository written to $OUT"
echo "Publish that folder as-is (GitHub Pages: the docs/ branch or an artifact)."
echo "Users add:"
echo "  sudo install -m 0644 <(curl -fsSL https://<host>/neuraos.gpg) /etc/apt/keyrings/neuraos.gpg"
echo "  echo 'deb [signed-by=/etc/apt/keyrings/neuraos.gpg] https://<host> $SUITE $COMP' | sudo tee /etc/apt/sources.list.d/neuraos.list"
echo "  sudo apt update && sudo apt install neuraos-desktop"
