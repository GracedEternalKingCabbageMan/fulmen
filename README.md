# Fulmen

Fulmen is a desktop wallet for **SeqLN**, the Sequentia Lightning Network. It is a
lean Electron app (Linux and Windows) that ships with a bundled SeqLN node: you
install one thing, point it at a Sequentia node's RPC, and get Lightning on
Sequentia with no manual node setup. It is non-custodial: the Lightning node runs
on your machine and its keys never leave it.

What it surfaces is what makes SeqLN different from vanilla Lightning:

- **Asset channels**: every channel carries one issued asset, and the UI shows
  which one.
- **Any-asset payments**: pay a BOLT11 invoice in a chosen asset (Fulmen sends
  `pay asset=<id>`), routed over same-asset channels only. Invoices themselves
  are asset-blind; the payer chooses the asset.
- **Per-asset balances**: on-chain and in-channel funds, grouped by asset.
- **Dual-chain**: Fulmen can run a second SeqLN node on Bitcoin testnet4 next to
  the Sequentia one. With both running you are set up for asset-to-BTC Lightning
  swaps (the swap flow itself is not in the GUI yet; see Status).

> **Testnet software.** Everything here runs on the Sequentia public testnet and
> Bitcoin testnet4. There is no mainnet. Do not use it with anything of value.

## Where this fits in the Sequentia ecosystem

Sequentia is a Bitcoin sidechain for asset tokenization and decentralized
exchange, built as a fork of Blockstream Elements 23.3.3. Protocol documentation
lives in the node repo:
[Sequentia `doc/sequentia/`](https://github.com/GracedEternalKingCabbageMan/Sequentia/tree/HEAD/doc/sequentia).

| Repo | One-liner |
|---|---|
| [`Sequentia`](https://github.com/GracedEternalKingCabbageMan/Sequentia) | The Sequentia node (`elementsd` fork of Elements 23.3.3): consensus, anchoring, proof of stake, open fee market, plus the canonical protocol documentation in `doc/sequentia/`. |
| [`seqln`](https://github.com/GracedEternalKingCabbageMan/seqln) | SeqLN: a Core Lightning fork that runs on Sequentia and Bitcoin from the same binary: asset channels, any-asset payments, pure-Lightning swaps. |
| [`fulmen`](https://github.com/GracedEternalKingCabbageMan/fulmen) | Fulmen: desktop (Electron) wallet for SeqLN with a bundled Lightning node. |
| [`seqdex`](https://github.com/GracedEternalKingCabbageMan/seqdex) | SeqDEX: non-custodial atomic-swap DEX with a P2P order book (seqob), same-chain swaps, and cross-chain BTC↔asset swaps made safe by Bitcoin anchoring. |

Live testnet services (explorer, web wallet, faucet, downloads) are at
https://sequentiatestnet.com/.

## Status (v0.2.0)

- Implemented and working: bundled-node management on Linux (spawn, supervise,
  clean shutdown), onboarding wizard, per-asset balances, channel list and
  channel open with an asset id, BOLT11 pay with asset selection, invoice
  creation, node logs, wallet backup surface, external-node mode (unix socket or
  clnrest), and the optional second node on Bitcoin testnet4.
- The Linux bundled-node path has been exercised end-to-end headless (the node
  manager has a scriptable smoke mode, see Contributing). The GUI has had only
  limited interactive testing; treat it as a preview.
- The Windows path (WSL2 distro import plus clnrest transport) is implemented
  end-to-end but has not been exercised on real Windows hardware. Treat it as
  experimental.
- Pure-Lightning asset-to-BTC swaps exist at the SeqLN daemon level but have no
  Fulmen UI yet; Fulmen currently prepares the dual-chain setup they need.
- Binaries are **unsigned**. Windows SmartScreen and some browsers will warn;
  macOS is not packaged at all (the node manager supports macOS in dev mode, but
  no macOS artifact is built).

## Install and run

Downloads: https://sequentiatestnet.com/download/

| Platform | Artifact |
|---|---|
| Linux x86_64 | `Fulmen-0.2.0-linux-x86_64.AppImage` (bundled SeqLN runtime included) |
| Windows x64 | `Fulmen-Setup-0.2.0.exe` (one-click NSIS installer) or `Fulmen-0.2.0-win64.zip` (unpack and run `Fulmen.exe`) |

### What you need first

Fulmen bundles the *Lightning* node, not the chain node. SeqLN reads the chain
through a node RPC, so you need:

- **Required**: a Sequentia node (`elementsd`) RPC endpoint, local or remote
  (default `127.0.0.1:18332`). Node downloads and setup:
  [Sequentia](https://github.com/GracedEternalKingCabbageMan/Sequentia) or the
  prebuilt binaries on the download page.
- **Optional**: a Bitcoin testnet4 node (`bitcoind`) RPC endpoint (default
  `127.0.0.1:48332`) if you also want Lightning on Bitcoin testnet4, which is the
  setup asset-to-BTC swaps need.

Leave the RPC username blank to use cookie authentication against a local
same-user node.

### Linux

```
chmod +x Fulmen-0.2.0-linux-x86_64.AppImage
./Fulmen-0.2.0-linux-x86_64.AppImage
```

### Windows (requires WSL2)

Core Lightning is POSIX-only, so on Windows the bundled SeqLN node runs inside
WSL2 (Microsoft's Linux VM, Windows 10 2004+ or Windows 11 with virtualization
enabled). If you do not have WSL2 yet:

```
wsl --install
```

then reboot. On first node start Fulmen imports its bundled SeqLN root
filesystem (about 150 MB) as a dedicated WSL distro named `fulmen-seqln` under
`%LOCALAPPDATA%\Fulmen\wsl`, then runs `lightningd` inside it. No WSL2 means no
bundled node; you can still connect Fulmen to a remote SeqLN over clnrest
(Settings, Advanced).

### First run (onboarding)

1. **Welcome**: choose "Run a node for me" (recommended) or "I already run
   SeqLN" (jumps to Settings to connect over unix socket or clnrest).
2. **Your Sequentia node**: enter the elementsd RPC host, port, and credentials,
   and use "Test connection" to verify. Optionally tick "Also run Lightning on
   Bitcoin testnet4" and fill in the bitcoind RPC.
3. **Starting SeqLN**: Fulmen starts the node(s), streams the log, and shows a
   sync progress bar (node block height against the backend chain tip).
4. **Back up your wallet**: the node's keys live in one file, `hsm_secret`.
   Anyone with that file can spend your funds; without it, funds on the node are
   unrecoverable. Fulmen shows the wallet folder ("Show in folder" on
   Linux); copy `hsm_secret`, plus `emergency.recover` if present, somewhere
   safe before clicking "I saved my backup". There is no seed phrase: the file
   is the backup.

On later launches Fulmen auto-starts the managed node(s) and shows the Overview.
The backup dialog is always available again via Settings, "Back up wallet".

### Where your data lives

| What | Linux | Windows |
|---|---|---|
| Lightning node data (`hsm_secret`, channel db) | `~/.fulmen/seqln/<network>/<network>/` | `\\wsl$\fulmen-seqln\root\.fulmen\seqln\<network>\<network>\` (paste into Explorer) |
| Fulmen config (`config.json`) | `~/.config/Fulmen/` | `%APPDATA%\Fulmen\` |

`<network>` is `sequentia-testnet` or `testnet4`. Note that `config.json` stores
the backend RPC password and (on Windows) the clnrest rune in plain text, with
file mode 0600 on Linux.

## How Fulmen talks to the node

The Electron main process owns all node access; the renderer is sandboxed
(context isolation, no Node integration, `default-src 'self'` CSP) and sees only
the small `window.fulmen` API defined in `src/main/preload.js`, which forwards
JSON-RPC calls over IPC.

Three transports, selected automatically:

- **Managed node, Linux/macOS**: Fulmen spawns the bundled `lightningd` directly
  (`src/main/node.js`), writes the node config file (mode 0600, the RPC password
  never appears on argv), and speaks CLN JSON-RPC over the `lightning-rpc` unix
  socket (`src/main/cln.js`, dependency-free).
- **Managed node, Windows**: Fulmen spawns `lightningd` inside the `fulmen-seqln`
  WSL distro with the `clnrest` plugin (HTTP on `127.0.0.1`, port 9737 for
  sequentia-testnet, 9738 for testnet4), mints a rune with `createrune` on first
  start (then reuses it), and speaks clnrest over localhost TCP
  (`src/main/cln-rest.js`), since unix sockets across the WSL boundary are
  unreliable. If your chain node runs on the Windows host and `127.0.0.1` is not
  reachable from inside WSL (NAT networking), Fulmen probes and falls back to
  the WSL default gateway; you may need `rpcallowip` for the WSL subnet in your
  node config.
- **External node**: point Fulmen at any SeqLN you run yourself, either a local
  `lightning-rpc` socket path or a remote clnrest endpoint (host, port,
  http/https, rune). On https, the certificate is not verified (clnrest's
  localhost cert is self-signed); do not treat remote https clnrest as
  authenticated transport security.

SeqLN itself needs a chain backend, and its `bcli` plugin does not speak HTTP:
it shells out to `elements-cli` (Sequentia networks) or `bitcoin-cli` (Bitcoin
networks). Both CLIs ship inside the bundle, so only the chain node's RPC needs
to be reachable; the chain node itself can be local or remote.

There is deliberately no third-party dependency in the app: `package.json` has
only `electron` and `electron-builder` as dev dependencies.

## Contributing

### Repo layout

```
src/main/main.js        Electron main: config, IPC, transport selection, window
src/main/node.js        NodeManager: spawn/supervise lightningd (direct or WSL2)
src/main/cln.js         CLN JSON-RPC client over the lightning-rpc unix socket
src/main/cln-rest.js    clnrest (REST + rune) transport
src/main/preload.js     the only API the renderer sees (window.fulmen)
src/renderer/           UI: Overview, Channels, Pay, Receive, Settings, onboarding
build/make-seqln-bundle.sh   stage a relocatable SeqLN runtime (Linux x64)
build/make-wsl-rootfs.sh     build the WSL2 rootfs tar for Windows
build/make-icon.js           regenerate build/icon.png (pure Node)
build/wsl/README.md          rootfs layout contract
.github/workflows/win-installer.yml   NSIS installer build (Windows runner)
```

### Run from source

```
npm install
npm start
```

Without a staged bundle, `npm start` runs the GUI in external-node mode: connect
it to a SeqLN you run yourself via Settings. To get the full bundled-node
experience in a dev checkout, stage the bundle first (below); `npm start` picks
up `build/seqln-linux-x64/` automatically.

### Stage the SeqLN runtime bundle (Linux x64)

Requires a built [seqln](https://github.com/GracedEternalKingCabbageMan/seqln)
tree plus `elements-cli` and `bitcoin-cli` binaries. Paths are overridable via
environment variables (defaults in the script):

```
SEQLN=$HOME/seqln \
ELEMENTS_CLI=/path/to/elements-cli \
BITCOIN_CLI=/path/to/bitcoin-cli \
npm run bundle:seqln
```

This stages `build/seqln-linux-x64/` (`bin/` with `lightningd`, its subdaemons,
`lightning-cli`, `lightning-hsmtool` and the two chain CLIs; `plugins/`; `lib/`
with `libsqlite3` and `libsodium`), strips the binaries, and verifies there are
no unresolved shared libraries.

### Build the Windows WSL rootfs

Requires the staged bundle plus a release build of seqln's Rust `clnrest`
(`cargo build --release` in the seqln workspace). No docker: the script
downloads Ubuntu Base 24.04 (a plain rootfs tarball, glibc-matched to the
staged binaries), overlays `/opt/seqln`, and repacks with root ownership:

```
CLNREST=$HOME/seqln/target/release/clnrest npm run bundle:rootfs
```

Output: `build/wsl/Fulmen-seqln-rootfs.tar` (git-ignored; too large for git).
The layout contract with `src/main/node.js` is documented in
`build/wsl/README.md`.

### Package

```
npm run dist:linux   # AppImage (embeds build/seqln-linux-x64 via extraResources)
npm run dist:win     # Windows zip (embeds the rootfs tar; buildable on Linux)
npm run dist         # both
```

The one-file NSIS installer (`Fulmen-Setup-<version>.exe`) is built by the
`windows-installer` GitHub Actions workflow on a Windows runner (electron-builder
needs to edit the installer executable, which requires wine on Linux; on Windows
it also stamps the icon and version metadata). Trigger it manually
(`workflow_dispatch`); it fetches the rootfs tar from the download host.
All artifacts are unsigned.

### Smoke tests

No test suite yet; the transports and the node manager each have a headless
smoke mode:

```
# CLN JSON-RPC over a unix socket (getinfo + listfunds)
node src/main/cln.js ~/.fulmen/seqln/sequentia-testnet/sequentia-testnet/lightning-rpc

# clnrest transport
node src/main/cln-rest.js 127.0.0.1 9737 http <rune>

# NodeManager: start a managed node, getinfo, stop (see node.js for all args)
node src/main/node.js <lightningdPath> sequentia-testnet <lightningDir> <libDir> <cliPath> 127.0.0.1 18332 <rpcuser> <rpcpass>
```

PRs go against `master`. Never commit secrets: no runes, RPC credentials,
`hsm_secret`, or node data; the bundle and rootfs outputs are already
git-ignored.

## License

MIT. Built by Concatena Labs.
