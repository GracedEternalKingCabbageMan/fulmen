# SeqLN WSL2 rootfs (Windows bundled node)

Core Lightning is POSIX-only, so on Windows Fulmen runs SeqLN inside WSL2.
`Fulmen-seqln-rootfs.tar` is the distro image Fulmen imports on first run
(`wsl --import fulmen-seqln ...`), then it spawns `lightningd` + `clnrest`
inside it and talks clnrest over localhost TCP.

Build it (no docker needed):

    bash build/make-seqln-bundle.sh    # stage the SeqLN runtime
    bash build/make-wsl-rootfs.sh      # ubuntu-base 24.04 + /opt/seqln overlay

Layout inside the image (contract with `src/main/node.js` `_startWSL`):

    /opt/seqln/bin/      lightningd + lightning_* subdaemons + lightning-cli,
                         lightning-hsmtool, elements-cli, bitcoin-cli
    /opt/seqln/plugins/  builtin C plugins + clnrest (Rust, static)
    /opt/seqln/lib/      libsqlite3.so.0, libsodium.so.23

The Windows zip carries the tar via electron-builder `win.extraResources`.
