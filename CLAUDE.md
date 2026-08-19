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
- `docs/bundled-seqln-plan.md` — the work plan 0.2.0's bundling shipped from. Its status
  header records the deltas from the plan and, importantly, what was *not* verified: GUI
  click-through, and the whole Windows/WSL2 path on real Windows hardware (§6.8, still owed).

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

There is no test suite. The `*-smoke` entries are scriptable headless probes rather than tests, and
each needs arguments (a socket path; a host, port and rune; or the full NodeManager argument list) —
`README.md`'s Contributing section has the exact invocations. The Linux bundled-node path has been
exercised end to end through them; the GUI has had only limited interactive testing.

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
- Bump `version` in `package.json` for a release; the artifact names are templated from it, the
  workflow's default rootfs URL is version-stamped, and `README.md` names the artifacts explicitly,
  so all three move together.
- Binaries are **unsigned**, and the Windows path has not been exercised on real Windows hardware.
  `README.md`'s Status section says so plainly. Keep it that way rather than quietly upgrading the
  claim.

<!-- BEGIN SHARED AGENT CONVENTIONS: identical in every Sequentia repo. Change it in all of them together. -->
## Working with git and GitHub here

These rules are the same in every Sequentia repository. They are repeated in each
one because this file is the only thing an agent is guaranteed to read, whatever
machine it is working from.

**Nothing pushed to GitHub credits Claude, Anthropic, or any AI tool.** No
`Co-Authored-By: Claude` trailer, no `Claude-Session:` trailer or `claude.ai`
link, no "Generated with Claude Code" in a commit message or a pull request body,
no `claude/*` branch names or session ids, and no mention in source, comments,
docs or issue text. Agent tooling offers several of these by default; compose the
message without them rather than stripping them afterwards.

**Author every commit as**
`GracedEternalKingCabbageMan <151803062+GracedEternalKingCabbageMan@users.noreply.github.com>`.
Never a personal address.

**Every change lands through a pull request that you merge yourself, at once.**
There is no reviewer on this project; the pull request exists so the reasoning is
recorded beside the diff. Branch, push, open it, merge it, delete the branch, all
in one sitting. Pushing straight to the default branch is the rule most often
broken here, and it is the one that costs the record. A pull request stays open
only when the repository owner asks for that specific one, and that never carries
over to the next.

**Name branches `area/short-description`**: `fix/`, `doc/`, `feature/`, `test/`,
`build/`, or the component being changed. Never a tool name, a session id, or
`worktree-*`.

**Write the subject as `area: what changed`**, one line, 72 characters at the
outside and 50 where you can manage it. Put the reasoning in the body, and
explain why rather than what.

**These repositories are public and world-readable.** Never commit private keys,
seeds, `wallet.dat`, RPC credentials, `.env` files or API tokens. Read the diff
before every commit. Secrets belong on the server and in offline backups.

**A file belongs to the repository whose code it describes.** Decide which repo
owns it before writing it; if it landed in the wrong one, move it rather than
deleting it.

**Push the same day you commit.** The testnet server pulls only from GitHub, so a
branch left on one laptop is invisible to every other machine and to the box.
<!-- END SHARED AGENT CONVENTIONS -->
