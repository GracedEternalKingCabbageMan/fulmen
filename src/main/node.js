'use strict';
// NodeManager spawns and supervises LOCAL SeqLN (lightningd) nodes so Fulmen
// ships a bundled node instead of only connecting to an existing one. It can
// run one instance per network at a time (e.g. sequentia-testnet AND testnet4,
// the dual-chain setup pure-LN asset<->BTC swaps need).
//
//   - Linux/macOS: spawn lightningd directly; the GUI talks over the unix socket.
//   - Windows: SeqLN / Core Lightning is POSIX-only, so it runs inside WSL2 (a
//     Microsoft-shipped Linux VM). Fulmen imports a bundled SeqLN rootfs as a
//     dedicated WSL distro on first run, spawns lightningd + clnrest inside it,
//     and the GUI talks over clnrest (localhost TCP, forwarded by WSL2) since a
//     cross-boundary unix socket is unreliable.
//
// SeqLN needs a chain backend. Its bcli plugin does not speak HTTP itself: it
// shells out to elements-cli (Sequentia networks) or bitcoin-cli (Bitcoin
// networks), which do the RPC. Both CLIs ship in the bundle; the actual
// elementsd/bitcoind can be local or remote. Backend settings are written to
// <lightning-dir>/config (mode 0600 - the RPC password never touches argv).
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LOG_LINES = 500;

function waitForFile(p, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      try { if (fs.existsSync(p)) return resolve(p); } catch {}
      if (Date.now() > deadline) return reject(new Error(`socket ${p} did not appear within ${timeoutMs}ms`));
      setTimeout(tick, 400);
    };
    tick();
  });
}

function run(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args.join(' ')}: ${err.message}${stderr ? ' — ' + stderr.toString().slice(0, 200) : ''}`));
      resolve(stdout.toString());
    });
  });
}

// Which chain CLI does bcli exec on this network? (bitcoin/chainparams.c .cli)
function chainCliName(network) {
  return /^(sequentia|liquid|elements)/.test(network) ? 'elements-cli' : 'bitcoin-cli';
}

// Render the lightningd config file for a managed instance. Only the backend
// options bcli understands (option names keep the bitcoin- prefix on every
// network, including Sequentia). Empty user/password lines are omitted so a
// local same-user node can fall back to cookie auth.
function renderConfig({ network, backend, cliPath, extra }) {
  const lines = [`network=${network}`];
  const b = backend || {};
  if (b.host) lines.push(`bitcoin-rpcconnect=${b.host}`);
  if (b.port) lines.push(`bitcoin-rpcport=${b.port}`);
  if (b.user) lines.push(`bitcoin-rpcuser=${b.user}`);
  if (b.pass) lines.push(`bitcoin-rpcpassword=${b.pass}`);
  if (cliPath) lines.push(`bitcoin-cli=${cliPath}`);
  for (const l of extra || []) lines.push(l);
  return lines.join('\n') + '\n';
}

class NodeInstance {
  constructor(network) {
    this.network = network;
    this.proc = null; this.socketPath = null; this.transport = null;
    this.lastError = null; this.startedAt = null; this.starting = false;
    this.logs = [];
  }
  log(chunk) {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line) continue;
      this.logs.push(line);
      if (this.logs.length > LOG_LINES) this.logs.splice(0, this.logs.length - LOG_LINES);
    }
  }
  status() {
    return {
      network: this.network, running: !!(this.proc && (this.socketPath || this.transport)),
      starting: this.starting, pid: this.proc ? this.proc.pid : null,
      socketPath: this.socketPath, transport: this.transport,
      lastError: this.lastError, startedAt: this.startedAt,
    };
  }
}

class NodeManager {
  constructor() { this.instances = new Map(); }

  supported() { return true; }
  isWindows() { return process.platform === 'win32'; }

  inst(network) {
    if (!this.instances.has(network)) this.instances.set(network, new NodeInstance(network));
    return this.instances.get(network);
  }

  async start(network, cfg) {
    const inst = this.inst(network);
    if (inst.proc || inst.transport || inst.starting) return; // already running/starting
    inst.lastError = null; inst.starting = true;
    try {
      if (this.isWindows()) await this._startWSL(inst, cfg);
      else await this._startLocal(inst, cfg);
      inst.startedAt = Date.now();
    } finally { inst.starting = false; }
  }

  // --- Linux/macOS: spawn lightningd directly -------------------------------
  async _startLocal(inst, cfg) {
    const network = inst.network;
    const lightningdPath = cfg.lightningdPath;
    const lightningDir = cfg.lightningDir || path.join(os.homedir(), '.fulmen', 'seqln', network);
    if (!lightningdPath || !fs.existsSync(lightningdPath)) throw new Error(`lightningd not found at ${lightningdPath || '(unset)'}`);
    fs.mkdirSync(lightningDir, { recursive: true, mode: 0o700 });

    // Backend + network settings live in the config file, never on argv.
    const cliPath = cfg.cliPath; // absolute path to bundled elements-cli / bitcoin-cli
    fs.writeFileSync(path.join(lightningDir, 'config'),
      renderConfig({ network, backend: cfg.backend, cliPath, extra: cfg.extraConfig }), { mode: 0o600 });

    const args = [`--lightning-dir=${lightningDir}`, ...(cfg.extraArgs || [])];
    const env = Object.assign({}, process.env);
    if (cfg.libDir) env.LD_LIBRARY_PATH = cfg.libDir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
    const proc = spawn(lightningdPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    inst.proc = proc;
    proc.stdout.on('data', (d) => { inst.log(d); if (cfg.onLog) cfg.onLog(network, d.toString()); });
    proc.stderr.on('data', (d) => { inst.log(d); if (cfg.onLog) cfg.onLog(network, d.toString()); });
    proc.on('error', (e) => { inst.lastError = e.message; });
    proc.on('exit', (code, sig) => {
      if (inst.proc === proc) { inst.proc = null; inst.socketPath = null; }
      if (code && code !== 0) inst.lastError = `lightningd exited ${code}${sig ? '/' + sig : ''}`;
    });

    const sock = path.join(lightningDir, network, 'lightning-rpc');
    try { await waitForFile(sock, cfg.timeoutMs || 60000); }
    catch (e) { await this.stop(network); throw new Error(`${e.message}${inst.lastError ? ' (' + inst.lastError + ')' : ''}`); }
    inst.socketPath = sock;
    return sock;
  }

  // --- Windows: run SeqLN inside a bundled WSL2 distro ----------------------
  // Flow: 1. ensure WSL2, 2. first run imports the bundled rootfs as the
  // `fulmen-seqln` distro, 3. write the config file inside the distro (password
  // via stdin), 4. spawn lightningd + clnrest, 5. rune -> clnrest transport.
  // Rootfs contract (build/make-wsl-rootfs.sh): binaries in /opt/seqln/bin
  // (subdaemons NEXT to lightningd; builtin plugins resolve to ../plugins =
  // /opt/seqln/plugins), bundled .so in /opt/seqln/lib, clnrest at
  // /opt/seqln/plugins/clnrest.
  async _startWSL(inst, cfg) {
    const network = inst.network;
    const distro = cfg.wslDistro || 'fulmen-seqln';
    const optBin = '/opt/seqln/bin';
    const lightningd = cfg.wslLightningd || `${optBin}/lightningd`;
    const clnrest = cfg.wslClnrest || '/opt/seqln/plugins/clnrest';
    const lightningCli = cfg.wslLightningCli || `${optBin}/lightning-cli`;
    const lightningDir = cfg.wslLightningDir || `/root/.fulmen/seqln/${network}`;
    const port = cfg.clnrestPort || 9737;

    // 1. WSL present?
    try { await run('wsl', ['--status']); }
    catch { throw new Error('WSL2 is required to run SeqLN on Windows. Install it with `wsl --install` (Windows 10 2004+/11, virtualization enabled), reboot, then retry. Alternatively connect Fulmen to a remote SeqLN over clnrest in Settings.'); }

    // 2. import the distro on first run.
    let have = false;
    try { const list = await run('wsl', ['-l', '-q']); have = list.split(/\r?\n/).map((s) => s.trim().replace(/\0/g, '')).includes(distro); } catch {}
    if (!have) {
      if (!cfg.rootfsPath || !fs.existsSync(cfg.rootfsPath)) throw new Error(`SeqLN rootfs not found at ${cfg.rootfsPath || '(unset)'} — the bundled node image is missing.`);
      const installDir = cfg.wslInstallDir || path.join(os.homedir(), 'AppData', 'Local', 'Fulmen', 'wsl');
      fs.mkdirSync(installDir, { recursive: true });
      await run('wsl', ['--import', distro, installDir, cfg.rootfsPath, '--version', '2'], 300000);
    }

    // 3. config file inside the distro; password goes over stdin, not argv.
    // A backend on the Windows HOST is not 127.0.0.1 from inside WSL2 (NAT):
    // if localhost is unreachable from the distro, fall back to the default
    // gateway (the host's WSL address). Win11 mirrored networking keeps
    // localhost working, so we probe before rewriting.
    const backend = Object.assign({}, cfg.backend);
    if (backend.host && backend.port && /^(127\.0\.0\.1|localhost)$/.test(backend.host)) {
      const probe = (h) => run('wsl', ['-d', distro, '--', 'sh', '-c',
        `timeout 3 sh -c 'exec 3<>/dev/tcp/${h}/${backend.port}' 2>/dev/null && echo OK`], 8000)
        .then((o) => o.includes('OK')).catch(() => false);
      if (!(await probe(backend.host))) {
        try {
          const gw = (await run('wsl', ['-d', distro, '--', 'sh', '-c', "ip route show default | sed -n 's/.*via \\([0-9.]*\\).*/\\1/p'"], 8000)).trim();
          if (gw && await probe(gw)) {
            backend.host = gw;
            inst.log(`backend on the Windows host: reaching it at ${gw} from WSL (add rpcallowip for the WSL subnet to your node config if auth fails)`);
          }
        } catch {}
      }
    }
    const cliPath = `${optBin}/${chainCliName(network)}`;
    const confText = renderConfig({ network, backend, cliPath, extra: cfg.extraConfig });
    await new Promise((resolve, reject) => {
      const w = spawn('wsl', ['-d', distro, '--', 'sh', '-c', `umask 077 && mkdir -p '${lightningDir}' && cat > '${lightningDir}/config'`], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      let err = '';
      w.stderr.on('data', (d) => { err += d; });
      w.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`writing node config in WSL failed: ${err.slice(0, 200)}`)));
      w.stdin.end(confText);
    });

    // 4. spawn lightningd (+ clnrest) inside the distro.
    const inner = [
      lightningd, `--lightning-dir=${lightningDir}`,
      `--plugin=${clnrest}`, `--clnrest-port=${port}`, '--clnrest-protocol=http', '--clnrest-host=127.0.0.1',
      ...(cfg.extraArgs || []),
    ];
    const cmd = `export LD_LIBRARY_PATH=/opt/seqln/lib; exec ${inner.map((a) => `'${a}'`).join(' ')}`;
    const proc = spawn('wsl', ['-d', distro, '--', 'sh', '-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    inst.proc = proc;
    proc.stdout.on('data', (d) => { inst.log(d); if (cfg.onLog) cfg.onLog(network, d.toString()); });
    proc.stderr.on('data', (d) => { inst.log(d); if (cfg.onLog) cfg.onLog(network, d.toString()); });
    proc.on('error', (e) => { inst.lastError = e.message; });
    proc.on('exit', (code, sig) => {
      if (inst.proc === proc) { inst.proc = null; inst.transport = null; }
      if (code && code !== 0) inst.lastError = `SeqLN (WSL) exited ${code}${sig ? '/' + sig : ''}`;
    });

    // 5. wait for readiness, then a rune -> clnrest transport. Reuse a saved
    // rune when the caller has one so we don't mint a new one every launch.
    inst._wslStop = async () => {
      try { await run('wsl', ['-d', distro, '--', lightningCli, `--lightning-dir=${lightningDir}`, 'stop'], 15000); } catch {}
      try { await run('wsl', ['--terminate', distro], 15000); } catch {}
    };
    const wcli = (args) => run('wsl', ['-d', distro, '--', lightningCli, `--lightning-dir=${lightningDir}`, ...args]);
    const deadline = Date.now() + (cfg.timeoutMs || 120000);
    for (;;) {
      try { await wcli(['getinfo']); break; } catch (e) {
        if (Date.now() > deadline) { await this.stop(network); throw new Error(`SeqLN (WSL) did not become ready${inst.lastError ? ' (' + inst.lastError + ')' : ''}`); }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    let rune = cfg.rune;
    if (!rune) {
      const out = await wcli(['createrune']);
      rune = JSON.parse(out).rune;
      if (cfg.onRune) try { cfg.onRune(inst.network, rune); } catch {}
    }
    inst.transport = { type: 'rest', host: '127.0.0.1', port, protocol: 'http', rune };
    return inst.transport;
  }

  // Graceful stop: ask lightningd to shut down (clean db close), then escalate.
  // On Windows, killing wsl.exe does NOT reliably kill lightningd inside the
  // distro, so we `lightning-cli stop` + `wsl --terminate` first.
  async stop(network) {
    const inst = this.instances.get(network);
    if (!inst) return;
    const proc = inst.proc;
    const sock = inst.socketPath;
    const wslStop = inst._wslStop;
    inst.proc = null; inst.socketPath = null; inst.transport = null; inst._wslStop = null;
    if (!proc) return;
    if (wslStop) await wslStop();
    else if (sock) {
      try {
        const { call } = require('./cln');
        await Promise.race([call(sock, 'stop', {}), new Promise((r) => setTimeout(r, 4000))]);
      } catch {}
    }
    try { proc.kill('SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    try { proc.kill('SIGKILL'); } catch {}
  }

  async stopAll() {
    await Promise.all([...this.instances.keys()].map((n) => this.stop(n)));
  }

  logs(network) {
    const inst = this.instances.get(network);
    return inst ? inst.logs.slice() : [];
  }

  status() {
    const networks = {};
    for (const [n, inst] of this.instances) networks[n] = inst.status();
    const anyRunning = Object.values(networks).some((s) => s.running);
    return { supported: this.supported(), windows: this.isWindows(), running: anyRunning, networks };
  }
}

module.exports = { NodeManager, waitForFile, chainCliName, renderConfig };

// Headless smoke test (Linux):
//   node node.js <lightningdPath> <network> <lightningDir> <libDir> <cliPath> <rpcHost> <rpcPort> <rpcUser> <rpcPass>
if (require.main === module) {
  const [, , lightningdPath, network, lightningDir, libDir, cliPath, host, port, user, pass] = process.argv;
  const { call } = require('./cln');
  const nm = new NodeManager();
  (async () => {
    try {
      const sock = await nm.start(network, {
        lightningdPath, lightningDir, libDir, cliPath,
        backend: { host, port: port ? Number(port) : undefined, user, pass },
        onLog: (_n, l) => process.stderr.write(l),
        timeoutMs: 120000,
      }).then(() => nm.instances.get(network).socketPath);
      const info = await call(sock, 'getinfo', {});
      console.log('MANAGED NODE OK:', { socket: sock, id: info.id, alias: info.alias, network: info.network, blockheight: info.blockheight });
      await nm.stop(network);
      process.exit(0);
    } catch (e) { console.error('MANAGED NODE FAIL:', e.message); await nm.stopAll(); process.exit(1); }
  })();
}
