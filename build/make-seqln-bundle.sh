#!/usr/bin/env bash
# Stage a relocatable SeqLN runtime for bundling into Fulmen (Linux x64).
#
# Layout (lightningd resolves subdaemons NEXT to itself, builtin plugins at
# <bindir>/../plugins — see lightningd/lightningd.c find_subdaemons_and_plugins):
#
#   build/seqln-linux-x64/
#     bin/      lightningd, lightning_*  (subdaemons), lightning-cli,
#               lightning-hsmtool, elements-cli, bitcoin-cli
#     plugins/  bcli, pay, ...
#     lib/      libsqlite3.so.0, libsodium.so.23  (spawned with LD_LIBRARY_PATH)
#
# elements-cli / bitcoin-cli are REQUIRED: SeqLN's bcli plugin does not speak
# HTTP itself — it shells out to the chain CLI, which does the RPC (the actual
# elementsd/bitcoind can be local or remote).
set -euo pipefail

SEQLN=${SEQLN:-$HOME/seqln}
ELEMENTS_CLI=${ELEMENTS_CLI:-$HOME/SequentiaByClaude/build-linux/src/elements-cli}
BITCOIN_CLI=${BITCOIN_CLI:-/usr/local/bin/bitcoin-cli}
OUT=${OUT:-"$(cd "$(dirname "$0")" && pwd)/seqln-linux-x64"}
LIBDIR=/usr/lib/x86_64-linux-gnu

rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/plugins" "$OUT/lib"

# --- binaries ---------------------------------------------------------------
cp "$SEQLN/lightningd/lightningd" "$OUT/bin/"
for d in "$SEQLN"/lightningd/lightning_*; do
  [ -x "$d" ] && [ -f "$d" ] && cp "$d" "$OUT/bin/"
done
cp "$SEQLN/cli/lightning-cli" "$OUT/bin/"
cp "$SEQLN/tools/lightning-hsmtool" "$OUT/bin/"
cp "$ELEMENTS_CLI" "$OUT/bin/elements-cli"
cp "$BITCOIN_CLI" "$OUT/bin/bitcoin-cli"

# --- plugins (built C plugin executables only) --------------------------------
find "$SEQLN/plugins" -maxdepth 1 -type f -executable \
  ! -name '*.py' ! -name '*.sh' ! -name '*.o' \
  -exec cp {} "$OUT/plugins/" \;

# --- shared libs (everything else is static: libwally, libsecp are linked in) -
cp "$LIBDIR/libsqlite3.so.0" "$OUT/lib/"
cp "$LIBDIR/libsodium.so.23" "$OUT/lib/"

# --- shrink -------------------------------------------------------------------
strip -s "$OUT"/bin/* "$OUT"/plugins/* 2>/dev/null || true

# --- verify: no unresolved libs, binary actually runs -------------------------
bad=0
for f in "$OUT"/bin/* "$OUT"/plugins/*; do
  if LD_LIBRARY_PATH="$OUT/lib" ldd "$f" 2>/dev/null | grep -q 'not found'; then
    echo "UNRESOLVED LIBS: $f" >&2
    LD_LIBRARY_PATH="$OUT/lib" ldd "$f" | grep 'not found' >&2
    bad=1
  fi
done
[ "$bad" = 0 ]
LD_LIBRARY_PATH="$OUT/lib" "$OUT/bin/lightningd" --version
echo "subdaemons: $(ls "$OUT/bin" | grep -c '^lightning_')  plugins: $(ls "$OUT/plugins" | wc -l)"
du -sh "$OUT"
echo "STAGED OK -> $OUT"
