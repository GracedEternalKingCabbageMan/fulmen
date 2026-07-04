#!/usr/bin/env bash
# Build the SeqLN WSL2 rootfs tarball that Fulmen bundles into the Windows
# installer. Needs docker access + a SeqLN build. Run on Linux (or WSL).
#
#   SEQLN=~/seqln ./build-rootfs.sh
#
# Produces: build/wsl/Fulmen-seqln-rootfs.tar  (import target for `wsl --import`).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SEQLN="${SEQLN:-$HOME/seqln}"
STAGE="$HERE/seqln-stage"
OUT="$HERE/Fulmen-seqln-rootfs.tar"

[ -x "$SEQLN/lightningd/lightningd" ] || { echo "SeqLN not built at $SEQLN (set SEQLN=...)"; exit 1; }

echo "== staging SeqLN binaries =="
rm -rf "$STAGE"; mkdir -p "$STAGE/plugins"
cp -a "$SEQLN/lightningd/lightningd" "$STAGE/"
cp -a "$SEQLN"/lightningd/lightning_* "$STAGE/"
cp -a "$SEQLN/cli/lightning-cli" "$STAGE/"
# built-in plugins + the clnrest REST plugin (Fulmen loads clnrest explicitly)
for p in "$SEQLN"/plugins/*; do [ -f "$p" ] && [ -x "$p" ] && cp -a "$p" "$STAGE/plugins/"; done
cp -a "$SEQLN/target/release/clnrest" "$STAGE/plugins/clnrest"
echo "   staged $(du -sh "$STAGE" | cut -f1)"

echo "== docker build =="
docker build -t fulmen-seqln-rootfs "$HERE"

echo "== export rootfs tarball =="
cid="$(docker create fulmen-seqln-rootfs)"
docker export "$cid" -o "$OUT"
docker rm "$cid" >/dev/null
rm -rf "$STAGE"
echo "== done: $OUT ($(du -h "$OUT" | cut -f1)) =="
echo "   electron-builder bundles this for Windows; Fulmen imports it as the 'fulmen-seqln' WSL distro on first run."
