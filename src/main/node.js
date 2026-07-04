'use strict';
// NodeManager spawns and supervises a LOCAL SeqLN (lightningd) process, so
// Fulmen can ship a bundled node instead of only connecting to an existing one.
//
// SeqLN / Core Lightning is POSIX-only, so a managed node is a LINUX/macOS
// feature; on Windows Fulmen stays a remote client (a bundled node isn't
// possible — CLN doesn't run natively there). SeqLN needs a chain backend, but
// `bcli` can point at a REMOTE Sequentia RPC, so a bundled node spawns only
// lightningd (+ its subdaemons/plugins), not a full elementsd.
const { spawn } = require('child_process');
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

class NodeManager {
  constructor() { this.proc = null; this.socketPath = null; this.lastError = null; }

  supported() { return process.platform !== 'win32'; }

  // start({lightningdPath, lightningDir, network, extraArgs, onLog}) -> socketPath
  async start(cfg) {
    if (!this.supported()) throw new Error('A managed SeqLN node is only supported on Linux/macOS (Core Lightning is POSIX-only). On Windows, connect to a remote node.');
    if (this.proc) return this.socketPath; // already running
    const lightningdPath = cfg.lightningdPath;
    const lightningDir = cfg.lightningDir || path.join(os.homedir(), '.fulmen', 'seqln');
    const network = cfg.network || 'bitcoin';
    if (!lightningdPath || !fs.existsSync(lightningdPath)) throw new Error(`lightningd not found at ${lightningdPath || '(unset)'}`);
    fs.mkdirSync(lightningDir, { recursive: true });

    const args = [`--lightning-dir=${lightningDir}`, `--network=${network}`, ...(cfg.extraArgs || [])];
    const proc = spawn(lightningdPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    this.lastError = null;
    const log = (d) => { if (cfg.onLog) cfg.onLog(d.toString()); };
    proc.stdout.on('data', log);
    proc.stderr.on('data', log);
    proc.on('exit', (code, sig) => {
      if (this.proc === proc) { this.proc = null; this.socketPath = null; }
      if (code && code !== 0) this.lastError = `lightningd exited ${code}${sig ? '/' + sig : ''}`;
    });

    this.socketPath = path.join(lightningDir, network, 'lightning-rpc');
    try {
      await waitForFile(this.socketPath, cfg.timeoutMs || 60000);
    } catch (e) {
      this.stop();
      throw new Error(`${e.message}${this.lastError ? ' (' + this.lastError + ')' : ''}`);
    }
    return this.socketPath;
  }

  async stop() {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    try { proc.kill('SIGTERM'); } catch {}
    // give it a moment, then force
    await new Promise((r) => setTimeout(r, 1500));
    try { proc.kill('SIGKILL'); } catch {}
    this.socketPath = null;
  }

  status() {
    return { supported: this.supported(), running: !!this.proc, pid: this.proc ? this.proc.pid : null, socketPath: this.socketPath, lastError: this.lastError };
  }
}

module.exports = { NodeManager, waitForFile };

// Headless smoke test: node node.js <lightningdPath> <lightningDir> <network> [-- extra args...]
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
