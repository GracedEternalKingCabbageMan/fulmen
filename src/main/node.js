'use strict';
// NodeManager spawns and supervises a LOCAL SeqLN (lightningd) process so Fulmen
// can ship a bundled node instead of only connecting to an existing one.
//
//   - Linux/macOS: spawn lightningd directly; the GUI talks over the unix socket.
//   - Windows: SeqLN / Core Lightning is POSIX-only, so it runs inside WSL2 (a
//     Microsoft-shipped Linux VM). Fulmen imports a bundled SeqLN rootfs as a
//     dedicated WSL distro on first run, spawns lightningd + clnrest inside it,
//     and the GUI talks over clnrest (localhost TCP, forwarded by WSL2) since a
//     cross-boundary unix socket is unreliable.
//
// SeqLN needs a chain backend, but `bcli` can point at a REMOTE Sequentia RPC,
// so a bundled node spawns only lightningd (+ subdaemons/plugins), not elementsd.
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

class NodeManager {
  constructor() { this.proc = null; this.socketPath = null; this.transport = null; this.lastError = null; }

  // A managed node is now possible on every OS: directly on Linux/macOS, and via
  // WSL2 on Windows.
  supported() { return true; }
  isWindows() { return process.platform === 'win32'; }

  async start(cfg) {
    if (this.proc || this.transport) return; // already running
    this.lastError = null;
    if (this.isWindows()) return this._startWSL(cfg);
    return this._startLocal(cfg);
  }

  // --- Linux/macOS: spawn lightningd directly -------------------------------
  async _startLocal(cfg) {
    const lightningdPath = cfg.lightningdPath;
    const lightningDir = cfg.lightningDir || path.join(os.homedir(), '.fulmen', 'seqln');
    const network = cfg.network || 'bitcoin';
    if (!lightningdPath || !fs.existsSync(lightningdPath)) throw new Error(`lightningd not found at ${lightningdPath || '(unset)'}`);
    fs.mkdirSync(lightningDir, { recursive: true });

    const args = [`--lightning-dir=${lightningDir}`, `--network=${network}`, ...(cfg.extraArgs || [])];
    const proc = spawn(lightningdPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    const log = (d) => { if (cfg.onLog) cfg.onLog(d.toString()); };
    proc.stdout.on('data', log);
    proc.stderr.on('data', log);
    proc.on('exit', (code, sig) => {
      if (this.proc === proc) { this.proc = null; this.socketPath = null; }
      if (code && code !== 0) this.lastError = `lightningd exited ${code}${sig ? '/' + sig : ''}`;
    });

    this.socketPath = path.join(lightningDir, network, 'lightning-rpc');
    try { await waitForFile(this.socketPath, cfg.timeoutMs || 60000); }
    catch (e) { await this.stop(); throw new Error(`${e.message}${this.lastError ? ' (' + this.lastError + ')' : ''}`); }
    return this.socketPath;
  }

  // --- Windows: run SeqLN inside a bundled WSL2 distro ----------------------
  // UNTESTED on Windows from this build environment; the flow is:
  //   1. ensure WSL2 is available,
  //   2. import the bundled rootfs as the `fulmen-seqln` distro (first run only),
  //   3. spawn lightningd + clnrest inside it,
  //   4. mint a rune and expose a clnrest transport (localhost TCP).
  async _startWSL(cfg) {
    const distro = cfg.wslDistro || 'fulmen-seqln';
    const network = cfg.network || 'bitcoin';
    // in-distro paths (from the bundled rootfs layout):
    const lightningd = cfg.wslLightningd || '/opt/seqln/lightningd';
    const clnrest = cfg.wslClnrest || '/opt/seqln/plugins/clnrest';
    const lightningCli = cfg.wslLightningCli || '/opt/seqln/lightning-cli';
    const lightningDir = cfg.wslLightningDir || '/root/.fulmen/seqln';
    const port = cfg.clnrestPort || 9737;

    // 1. WSL present?
    try { await run('wsl', ['--status']); }
    catch { throw new Error('WSL2 is required to run SeqLN on Windows. Install it with `wsl --install` (Windows 10 2004+/11, virtualization enabled), then retry.'); }

    // 2. import the distro on first run.
    let have = false;
    try { const list = await run('wsl', ['-l', '-q']); have = list.split(/\r?\n/).map((s) => s.trim().replace(/\0/g, '')).includes(distro); } catch {}
    if (!have) {
      if (!cfg.rootfsPath || !fs.existsSync(cfg.rootfsPath)) throw new Error(`SeqLN rootfs not found at ${cfg.rootfsPath || '(unset)'} — the bundled node image is missing.`);
      const installDir = cfg.wslInstallDir || path.join(os.homedir(), 'AppData', 'Local', 'Fulmen', 'wsl');
      fs.mkdirSync(installDir, { recursive: true });
      await run('wsl', ['--import', distro, installDir, cfg.rootfsPath, '--version', '2'], 300000);
    }

    // 3. spawn lightningd (+ clnrest) inside the distro.
    const inner = [
      lightningd, `--lightning-dir=${lightningDir}`, `--network=${network}`,
      `--plugin=${clnrest}`, `--clnrest-port=${port}`, '--clnrest-protocol=http', '--clnrest-host=127.0.0.1',
      ...(cfg.extraArgs || []),
    ];
    const proc = spawn('wsl', ['-d', distro, '--', 'sh', '-c', `mkdir -p ${lightningDir}; exec ${inner.map((a) => `'${a}'`).join(' ')}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    const log = (d) => { if (cfg.onLog) cfg.onLog(d.toString()); };
    proc.stdout.on('data', log); proc.stderr.on('data', log);
    proc.on('exit', (code, sig) => {
      if (this.proc === proc) { this.proc = null; this.transport = null; }
      if (code && code !== 0) this.lastError = `SeqLN (WSL) exited ${code}${sig ? '/' + sig : ''}`;
    });

    // 4. wait for readiness, then mint a rune -> clnrest transport.
    const wcli = (args) => run('wsl', ['-d', distro, '--', lightningCli, `--lightning-dir=${lightningDir}`, `--network=${network}`, ...args]);
    const deadline = Date.now() + (cfg.timeoutMs || 60000);
    for (;;) {
      try { await wcli(['getinfo']); break; } catch (e) {
        if (Date.now() > deadline) { await this.stop(); throw new Error(`SeqLN (WSL) did not become ready${this.lastError ? ' (' + this.lastError + ')' : ''}`); }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    let rune = cfg.rune;
    if (!rune) { const out = await wcli(['createrune']); rune = JSON.parse(out).rune; }
    this.transport = { type: 'rest', host: '127.0.0.1', port, protocol: 'http', rune };
    return this.transport;
  }

  async stop() {
    const proc = this.proc;
    this.proc = null; this.socketPath = null; this.transport = null;
    if (!proc) return;
    try { proc.kill('SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    try { proc.kill('SIGKILL'); } catch {}
  }

  status() {
    return { supported: this.supported(), windows: this.isWindows(), running: !!this.proc, pid: this.proc ? this.proc.pid : null, socketPath: this.socketPath, transport: this.transport, lastError: this.lastError };
  }
}

module.exports = { NodeManager, waitForFile };

// Headless smoke test (Linux): node node.js <lightningdPath> <lightningDir> <network>
if (require.main === module) {
  const [, , lightningdPath, lightningDir, network, ...rest] = process.argv;
  const extraArgs = rest[0] === '--' ? rest.slice(1) : rest;
  const { call } = require('./cln');
  const nm = new NodeManager();
  (async () => {
    try {
      const sock = await nm.start({ lightningdPath, lightningDir, network, extraArgs, onLog: (l) => process.stderr.write(l) });
      const info = await call(sock, 'getinfo', {});
      console.log('MANAGED NODE OK:', { socket: sock, id: info.id, alias: info.alias, network: info.network, blockheight: info.blockheight });
      await nm.stop();
      process.exit(0);
    } catch (e) { console.error('MANAGED NODE FAIL:', e.message); await nm.stop(); process.exit(1); }
  })();
}
