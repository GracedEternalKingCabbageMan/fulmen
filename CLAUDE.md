# Fulmen

An Electron desktop wallet for SeqLN, the Sequentia Lightning Network. It talks to a SeqLN node
(a Core Lightning fork) and surfaces what makes SeqLN different from vanilla Lightning: asset
channels, per-asset balances, and paying a BOLT11 in a chosen asset.

Since 0.2.0 it also **bundles and manages a SeqLN node** rather than only attaching to an existing
one: a native bundle on Linux, and a WSL2 rootfs on Windows.

Node and consensus conventions live in the
[`Sequentia`](https://github.com/GracedEternalKingCabbageMan/Sequentia) repo; SeqLN itself lives in
[`seqln`](https://github.com/GracedEternalKingCabbageMan/seqln).

## Layout

- `src/main/main.js` — Electron main, IPC, config.
- `src/main/cln.js` — a dependency-free CLN JSON-RPC client over the unix socket.
- `src/main/cln-rest.js` — the clnrest (TCP) transport, used for remote nodes and for Windows/WSL2.
- `src/main/node.js` — the bundled-node manager.
- `src/main/preload.js` — the only surface the renderer sees (`window.fulmen.rpc`). Keep it that way.
- `src/renderer/` — the UI.
- `build/` — icon generation and the two bundling scripts.

## Commands

All of these are real `package.json` scripts:

```sh
npm install
npm start                 # electron .
npm run rpc-smoke         # node src/main/cln.js
npm run node-smoke        # node src/main/node.js
npm run bundle:seqln      # bash build/make-seqln-bundle.sh   (Linux SeqLN bundle)
npm run bundle:rootfs     # bash build/make-wsl-rootfs.sh     (Windows WSL2 rootfs)
npm run icon
npm run dist:linux        # AppImage
npm run dist:win          # Windows zip
npm run dist              # both
```

There is no test suite. The two `*-smoke` scripts are the only automated checks.

## Releases

The Linux AppImage is built locally with `npm run dist:linux`, and its `extraResources` pulls in
`build/seqln-linux-x64`, so **the SeqLN bundle must be built before packaging**.

The one-file Windows NSIS installer is built by the `windows-installer` GitHub Actions workflow,
which is **`workflow_dispatch` only** — it never runs on push. It runs on a Windows runner because
electron-builder's NSIS target has to edit the installer executable, which needs wine on Linux and
also costs the exe its icon and version metadata. The WSL rootfs is too large for git, so the
workflow downloads it from the public download host; the URL is a workflow input.

The workflow builds with `--publish never` and uploads the installer as a CI artifact. **Nothing
auto-publishes a release.** Publishing is a deliberate manual step.

## Working in this repo

- **Repository is public.** Never commit keys, seeds, node data, macaroons, credentials, `.env`
  files or tokens.
- **Commit author:**
  `GracedEternalKingCabbageMan <151803062+GracedEternalKingCabbageMan@users.noreply.github.com>`
- **Always open a pull request, then merge it yourself immediately.** The PR exists so the change
  and its reasoning are recorded, not because anyone is waiting to review it. There is no review
  process. If you are ever told to leave one specific PR open, that applies to that PR only and
  never becomes the default.
- PRs go against `master`, which is the remote default.
- Bump `version` in `package.json` for a release; the artifact names are templated from it, and the
  default rootfs URL in the workflow is version-stamped, so check both.
- `README.md` documents the pre-0.2.0 attach-to-an-existing-node workflow and has not caught up
  with node bundling. Verify against `package.json` and `src/main/node.js`.
