#!/usr/bin/env bash
# Stage a release from the bundles `tauri build` wrote: copy the .deb and the
# AppImage under stable names (the ones the README, the apt repository and
# the in-app updater all use), hash them, and write desktop-version.json --
# the manifest the app's update check reads (src/update.js).
#
# Usage:
#   packaging/release/stage.sh <bundle-dir> <out-dir> <version> [commit]
#
# <bundle-dir> is app/desktop/src-tauri/target/release/bundle. The manifest is
# signed afterwards by the release workflow (`tauri signer sign`) when the
# repository has a signing key; this script never sees a key.
set -euo pipefail

BUNDLE="${1:?bundle dir}"
OUT="${2:?out dir}"
VERSION="${3:?version}"
COMMIT="${4:-}"

deb=$(find "$BUNDLE/deb" -maxdepth 1 -name '*.deb' 2>/dev/null | head -1 || true)
app=$(find "$BUNDLE/appimage" -maxdepth 1 -name '*.AppImage' 2>/dev/null | head -1 || true)
[ -n "$deb" ] || { echo "no .deb under $BUNDLE/deb" >&2; exit 1; }
[ -n "$app" ] || { echo "no .AppImage under $BUNDLE/appimage" >&2; exit 1; }

DEB_NAME="neura-os-desktop_${VERSION}_amd64.deb"
APP_NAME="NeuraOS-${VERSION}-x86_64.AppImage"

mkdir -p "$OUT"
cp -f "$deb" "$OUT/$DEB_NAME"
cp -f "$app" "$OUT/$APP_NAME"
chmod 755 "$OUT/$APP_NAME"

( cd "$OUT" && sha256sum "$DEB_NAME" "$APP_NAME" > SHA256SUMS )

artifacts=""
for name in "$DEB_NAME" "$APP_NAME"; do
  sum=$(sha256sum "$OUT/$name" | cut -d' ' -f1)
  size=$(stat -c %s "$OUT/$name")
  artifacts="${artifacts}{\"name\":\"${name}\",\"sha256\":\"${sum}\",\"size\":${size}},"
done
artifacts="${artifacts%,}"

printf '{"version":"%s","builtAt":"%s","commit":"%s","artifacts":[%s]}\n' \
  "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COMMIT" "$artifacts" > "$OUT/desktop-version.json"

echo "Staged in $OUT:"
ls -l "$OUT"
