#!/usr/bin/env bash
# Build build/wsl/Fulmen-seqln-rootfs.tar: the WSL2 distro image Fulmen imports
# on Windows to run SeqLN (Core Lightning is POSIX-only, no native Windows).
#
# Dockerless: WSL `--import` just wants a tarball of a Linux root filesystem,
# so we take Ubuntu Base (a ~30 MB plain rootfs tarball), overlay /opt/seqln,
# and repack with root ownership. No docker daemon, no chroot, no sudo.
#
# Rootfs contract (matched by src/main/node.js _startWSL):
#   /opt/seqln/bin/      lightningd + subdaemons NEXT to it (in-tree resolution),
#                        lightning-cli, lightning-hsmtool, elements-cli, bitcoin-cli
#   /opt/seqln/plugins/  builtin C plugins (= bin/../plugins) + clnrest (Rust)
#   /opt/seqln/lib/      libsqlite3.so.0, libsodium.so.23 (LD_LIBRARY_PATH at spawn)
#
# Binaries are the laptop-staged bundle (glibc 2.39) and Ubuntu Base 24.04 ships
# glibc 2.39, so they match. clnrest comes from the seqln Rust workspace build.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE=${BUNDLE:-$HERE/seqln-linux-x64}
CLNREST=${CLNREST:-$HOME/seqln/target/release/clnrest}
BASE_URL=${BASE_URL:-https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-amd64.tar.gz}
CACHE="$HERE/cache"
STAGE="$HERE/wsl/rootfs-stage"
OUT="$HERE/wsl/Fulmen-seqln-rootfs.tar"

[ -x "$BUNDLE/bin/lightningd" ] || { echo "run make-seqln-bundle.sh first ($BUNDLE missing)"; exit 1; }
[ -x "$CLNREST" ] || { echo "clnrest not found at $CLNREST (cargo build --release in seqln)"; exit 1; }

mkdir -p "$CACHE" "$HERE/wsl"
base="$CACHE/$(basename "$BASE_URL")"
[ -s "$base" ] || curl -fL --retry 3 -o "$base" "$BASE_URL"

rm -rf "$STAGE"
mkdir -p "$STAGE"
# Extract as the build user; ownership is rewritten to root at repack time.
tar -xzf "$base" -C "$STAGE"

# overlay SeqLN
mkdir -p "$STAGE/opt/seqln"
cp -r "$BUNDLE/bin" "$BUNDLE/plugins" "$BUNDLE/lib" "$STAGE/opt/seqln/"
install -m 0755 "$CLNREST" "$STAGE/opt/seqln/plugins/clnrest"

# WSL niceties: no systemd (we exec lightningd directly), sane default user (root).
cat > "$STAGE/etc/wsl.conf" << 'EOF'
[boot]
systemd=false
[user]
default=root
EOF

# Repack. --numeric-owner --owner=0 --group=0 makes everything root:root inside
# the image regardless of who ran this script.
rm -f "$OUT"
tar -C "$STAGE" --numeric-owner --owner=0 --group=0 -cf "$OUT" .
rm -rf "$STAGE"

# sanity: image lists, key paths present
tar -tf "$OUT" ./opt/seqln/bin/lightningd ./opt/seqln/plugins/clnrest ./opt/seqln/plugins/bcli \
  ./opt/seqln/bin/elements-cli ./opt/seqln/bin/bitcoin-cli ./opt/seqln/lib/libsqlite3.so.0 \
  ./opt/seqln/lib/libsodium.so.23 ./usr/bin/sh > /dev/null
du -h "$OUT"
echo "ROOTFS OK -> $OUT"
