# Fulmen on Windows — SeqLN via WSL2

Core Lightning (SeqLN) is POSIX-only and does not run natively on Windows. On
Windows, Fulmen runs SeqLN inside **WSL2** (a Microsoft-shipped Linux VM built
into Windows 10 2004+/11) and talks to it over **clnrest** (localhost TCP, which
WSL2 forwards). The user does nothing manual — Fulmen manages the WSL distro.

## Flow (implemented in `src/main/node.js` `_startWSL`)
1. Ensure WSL2 (`wsl --status`; if missing, prompt `wsl --install`).
2. First run only: `wsl --import fulmen-seqln <installDir> <rootfs.tar> --version 2`
   registers a dedicated, isolated distro from the bundled rootfs.
3. Spawn `wsl -d fulmen-seqln -- /opt/seqln/lightningd --lightning-dir=… --network=…
   --plugin=/opt/seqln/plugins/clnrest --clnrest-port=9737 --clnrest-protocol=http
   --clnrest-host=127.0.0.1`.
4. Mint a rune (`… lightning-cli createrune`) and expose a clnrest transport
   `{host:127.0.0.1, port:9737, protocol:http, rune}` to the GUI.

## Building the bundled rootfs
Needs docker + a SeqLN build; run on Linux (or WSL):

    SEQLN=~/seqln ./build-rootfs.sh      # -> build/wsl/Fulmen-seqln-rootfs.tar

`electron-builder` bundles that tar into the Windows installer (see the `win`
`extraResources` in `package.json`); Fulmen finds it at
`<resources>/wsl/Fulmen-seqln-rootfs.tar`. **Build the rootfs before packaging
the Windows build.**

## Backend
SeqLN needs a chain backend, but `bcli` points at a **remote** Sequentia testnet
RPC (passed via the node's `extraArgs`), so the rootfs ships only `lightningd`
(+ subdaemons/plugins), not a full `elementsd`.

## Status
Code-complete; **not yet built or validated on Windows** from this environment
(no docker access + no Windows/WSL here). To finish: build the rootfs on a
machine with docker, then package + smoke-test the Windows build under WSL2.
