# Fulmen ⚡

A lightning-fast desktop wallet for **SeqLN**, the Sequentia Lightning Network.

Fulmen is a lean cross-platform (Linux + Windows) desktop client that talks to a
local SeqLN (Core Lightning fork) node over its `lightning-rpc` unix socket, and
surfaces the things that make SeqLN different from vanilla Lightning:

- **Asset channels** — every channel shows the issued asset it carries (GOLD,
  L-BTC, …), not just "a channel".
- **Any-asset payments** — pay a BOLT11 in a chosen asset (`pay asset=<id>`),
  routed only over same-asset channels.
- **Per-asset balances** — on-chain + in-channel, grouped by asset.
- (Roadmap) **Pure-LN asset↔BTC swaps** — instant atomic swaps, no on-chain leg.

## Run (dev)
    npm install
    npm start        # then Settings → point at <lightning-dir>/<network>/lightning-rpc

## Build executables
    npm run dist:linux   # AppImage
    npm run dist:win     # Windows zip
    npm run dist         # both

## Architecture
- `src/main/cln.js` — minimal CLN JSON-RPC client over the unix socket (no deps).
- `src/main/main.js` — Electron main + IPC + config (socket path).
- `src/main/preload.js` — the only bridge the renderer sees (`window.fulmen.rpc`).
- `src/renderer/*` — the UI (Overview, Channels, Pay, Receive, Settings).

Built by Concatena Labs. Testnet preview.
