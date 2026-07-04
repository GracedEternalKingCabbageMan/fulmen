# Minimal Linux rootfs with SeqLN, for importing as a Windows WSL2 distro.
# Built into a tarball by build-rootfs.sh (docker build + docker export), which
# electron-builder bundles into the Windows installer. On first run Fulmen does
# `wsl --import fulmen-seqln <dir> <rootfs.tar>` and runs SeqLN inside it.
#
# glibc base (SeqLN's binaries are glibc-linked, so Alpine/musl won't do).
FROM debian:bookworm-slim

# SeqLN's only non-standard runtime deps are libsodium + libsqlite3 (clnrest is
# statically linked). ca-certificates for the backend TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libsodium23 libsqlite3-0 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The SeqLN binaries, staged flat so lightningd finds its subdaemons next to
# itself: lightningd + lightning_* + lightning-cli + plugins/ + plugins/clnrest.
COPY seqln-stage/ /opt/seqln/
RUN chmod +x /opt/seqln/lightningd /opt/seqln/lightning-cli /opt/seqln/lightning_* /opt/seqln/plugins/* 2>/dev/null || true

# Fulmen passes --network + the backend (bcli) RPC at spawn time; nothing to run
# at build. WSL ignores CMD (Fulmen exec's lightningd directly).
CMD ["/bin/sh"]
