'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { call } = require('./cln');
const { restCall } = require('./cln-rest');
const { NodeManager, chainCliName } = require('./node');

const nodeMgr = new NodeManager();

// Networks Fulmen can manage. sequentia-testnet is the home network; testnet4
// is the optional Bitcoin-side node (SeqLN runs on Bitcoin networks too, and
// the dual-chain pair is what pure-LN asset<->BTC swaps run on).
const NETWORKS = {
  'sequentia-testnet': { label: 'Sequentia testnet', backendName: 'Sequentia node (elementsd)', defaultPort: 18332, clnrestPort: 9737 },
  'testnet4':          { label: 'Bitcoin testnet4',  backendName: 'Bitcoin node (bitcoind)',    defaultPort: 48332, clnrestPort: 9738 },
};

// --- persistent config -------------------------------------------------------
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function defaultSocket() {
  const cands = [
    path.join(os.homedir(), '.lightning', 'bitcoin', 'lightning-rpc'),
    path.join(os.homedir(), '.lightning', 'lightning-rpc'),
    path.join(os.homedir(), '.lightning', 'sequentia-testnet', 'lightning-rpc'),
    path.join(os.homedir(), '.lightning', 'regtest', 'lightning-rpc'),
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return '';
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 }); } catch {}
}
function defaultNodeEntry(network) {
  return {
    enabled: network === 'sequentia-testnet',
    lightningDir: path.join(os.homedir(), '.fulmen', 'seqln', network),
    backend: { host: '127.0.0.1', port: NETWORKS[network].defaultPort, user: '', pass: '' },
    clnrestPort: NETWORKS[network].clnrestPort,
    rune: '',
    extraArgs: [],
  };
}
let config = null;
function getConfig() {
  if (!config) {
    config = loadConfig();
    if (!config.version) {
      // migrate v1 {node:{lightningdPath,lightningDir,network}} -> v2 nodes map
      const old = config.node;
      config = {
        version: 2,
        onboarded: !!(config.socket || config.transport || (old && old.lightningdPath)),
        mode: config.mode || 'managed',
        activeNetwork: 'sequentia-testnet',
        socket: config.socket || defaultSocket(),
        transport: config.transport || null,
        nodes: {},
      };
      if (old && old.network && NETWORKS[old.network]) {
        config.nodes[old.network] = Object.assign(defaultNodeEntry(old.network), { enabled: true, lightningDir: old.lightningDir || undefined });
      }
    }
    for (const n of Object.keys(NETWORKS)) if (!config.nodes[n]) config.nodes[n] = defaultNodeEntry(n);
    if (!NETWORKS[config.activeNetwork]) config.activeNetwork = 'sequentia-testnet';
  }
  return config;
}

// --- bundled SeqLN payload ----------------------------------------------------
// Release builds carry the runtime under <resources>/seqln (Linux/macOS) or the
// WSL rootfs tar under <resources>/wsl (Windows). `npm start` in a dev checkout
// falls back to the staged bundle in build/, so managed nodes work unpackaged.
function bundleDir() {
  const cands = [
    path.join(process.resourcesPath || '', 'seqln'),
    path.join(__dirname, '..', '..', 'build', 'seqln-linux-x64'),
  ];
  for (const c of cands) { try { if (fs.existsSync(path.join(c, 'bin', 'lightningd'))) return c; } catch {} }
  return null;
}
function rootfsPath() {
  const cands = [
    path.join(process.resourcesPath || '', 'wsl', 'Fulmen-seqln-rootfs.tar'),
    path.join(__dirname, '..', '..', 'build', 'wsl', 'Fulmen-seqln-rootfs.tar'),
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}

function nodeStartConfig(network) {
  const c = getConfig();
  const entry = c.nodes[network] || defaultNodeEntry(network);
  const cfg = {
    lightningDir: entry.lightningDir,
    backend: entry.backend,
    extraArgs: entry.extraArgs || [],
    clnrestPort: entry.clnrestPort,
    rune: entry.rune || undefined,
    onRune: (net, rune) => { const cc = getConfig(); if (cc.nodes[net]) { cc.nodes[net].rune = rune; saveConfig(cc); } },
  };
  if (nodeMgr.isWindows()) {
    cfg.rootfsPath = rootfsPath();
  } else {
    const b = bundleDir();
    if (entry.lightningdPath) cfg.lightningdPath = entry.lightningdPath;          // user override
    else if (b) cfg.lightningdPath = path.join(b, 'bin', 'lightningd');
    if (b) {
      cfg.libDir = path.join(b, 'lib');
      cfg.cliPath = path.join(b, 'bin', chainCliName(network));
    }
  }
  return cfg;
}

// --- backend (chain RPC) probing ----------------------------------------------
// A plain JSON-RPC-over-HTTP call to elementsd/bitcoind. Used by onboarding's
// "Test connection" and the sync-progress display; works identically on every
// platform (no CLI, no WSL import needed yet). bcli itself still uses the
// bundled CLI at runtime.
function backendRpc(backend, method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '1.0', id: 'fulmen', method, params: params || [] });
    const req = http.request({
      host: backend.host || '127.0.0.1', port: Number(backend.port),
      method: 'POST', path: '/', timeout: 8000,
      auth: backend.user ? `${backend.user}:${backend.pass || ''}` : undefined,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('RPC authentication failed (check rpcuser/rpcpassword)'));
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(j.error.message || JSON.stringify(j.error)));
          resolve(j.result);
        } catch { reject(new Error(`unexpected RPC response (HTTP ${res.statusCode})`)); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('connection timed out')); });
    req.on('error', (e) => reject(new Error(e.message)));
    req.end(body);
  });
}

// --- transport selection -------------------------------------------------------
function currentTransport() {
  const c = getConfig();
  const s = nodeMgr.status();
  const active = s.networks[c.activeNetwork];
  if (active && active.running && active.transport) return active.transport;
  if (active && active.running && active.socketPath) return { type: 'socket', socket: active.socketPath };
  if (c.transport && c.transport.type === 'rest' && c.transport.port) return c.transport;
  if (c.socket) return { type: 'socket', socket: c.socket };
  return null;
}

async function callNode(method, params) {
  const t = currentTransport();
  if (!t) throw new Error('No SeqLN node connected yet.');
  if (t.type === 'rest') return restCall(t, method, params || {});
  return call(t.socket, method, params || {});
}

// --- IPC -----------------------------------------------------------------------
ipcMain.handle('get-config', () => {
  const c = getConfig();
  return Object.assign({}, c, {
    networksMeta: NETWORKS,
    bundled: !!(nodeMgr.isWindows() ? rootfsPath() : bundleDir()),
    platform: process.platform,
    appVersion: app.getVersion(),
  });
});
ipcMain.handle('set-socket', (_e, sock) => { const c = getConfig(); c.socket = String(sock || '').trim(); c.transport = null; c.mode = 'external'; saveConfig(c); return c; });
ipcMain.handle('set-transport', (_e, t) => { const c = getConfig(); c.transport = t && t.port ? t : null; if (c.transport) c.mode = 'external'; saveConfig(c); return c; });
ipcMain.handle('set-mode', (_e, mode) => { const c = getConfig(); c.mode = mode === 'managed' ? 'managed' : 'external'; saveConfig(c); return c; });
ipcMain.handle('set-onboarded', (_e, v) => { const c = getConfig(); c.onboarded = !!v; saveConfig(c); return c; });
ipcMain.handle('set-active-network', (_e, n) => { const c = getConfig(); if (NETWORKS[n]) c.activeNetwork = n; saveConfig(c); return c; });
ipcMain.handle('set-node-settings', (_e, network, patch) => {
  const c = getConfig();
  if (!NETWORKS[network]) throw new Error(`unknown network ${network}`);
  const cur = c.nodes[network] || defaultNodeEntry(network);
  if (patch.backend) patch.backend = Object.assign({}, cur.backend, patch.backend);
  c.nodes[network] = Object.assign({}, cur, patch);
  saveConfig(c);
  return c;
});
ipcMain.handle('test-backend', async (_e, network, backend) => {
  const b = backend || getConfig().nodes[network].backend;
  const info = await backendRpc(b, 'getblockchaininfo');
  return { ok: true, chain: info.chain, blocks: info.blocks, headers: info.headers, ibd: info.initialblockdownload };
});
ipcMain.handle('backend-height', async (_e, network) => {
  const b = getConfig().nodes[network].backend;
  return backendRpc(b, 'getblockcount');
});
ipcMain.handle('node-status', () => {
  const c = getConfig();
  return Object.assign({ mode: c.mode, activeNetwork: c.activeNetwork, onboarded: c.onboarded }, nodeMgr.status());
});
ipcMain.handle('node-start', async (_e, network) => {
  const n = network || getConfig().activeNetwork;
  await nodeMgr.start(n, nodeStartConfig(n));
  return nodeMgr.status();
});
ipcMain.handle('node-stop', async (_e, network) => {
  if (network) await nodeMgr.stop(network); else await nodeMgr.stopAll();
  return nodeMgr.status();
});
ipcMain.handle('node-logs', (_e, network) => nodeMgr.logs(network || getConfig().activeNetwork));
// hsm_secret / emergency backup surface: where the keys live for a managed node.
ipcMain.handle('hsm-info', (_e, network) => {
  const n = network || getConfig().activeNetwork;
  const entry = getConfig().nodes[n];
  if (nodeMgr.isWindows()) {
    const dir = `\\\\wsl$\\fulmen-seqln\\root\\.fulmen\\seqln\\${n}\\${n}`;
    return { dir, hsmPath: dir + '\\hsm_secret', exists: null, wsl: true };
  }
  const dir = path.join(entry.lightningDir, n);
  const hsmPath = path.join(dir, 'hsm_secret');
  const emergency = path.join(dir, 'emergency.recover');
  return {
    dir, hsmPath, wsl: false,
    exists: fs.existsSync(hsmPath),
    emergency: fs.existsSync(emergency) ? emergency : null,
  };
});
ipcMain.handle('reveal-path', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('rpc', (_e, method, params) => callNode(method, params));

// --- window ----------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1080, height: 760, minWidth: 820, minHeight: 560,
    backgroundColor: '#0e1116',
    title: 'Fulmen',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Two Fulmens must not fight over the same managed node/data dir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });

  app.whenReady().then(() => {
    createWindow();
    // Bring up managed nodes once the user has onboarded. Never block the
    // window; the renderer polls node-status and shows progress/errors.
    const c = getConfig();
    if (c.onboarded && c.mode === 'managed') {
      for (const [n, entry] of Object.entries(c.nodes)) {
        if (entry.enabled) nodeMgr.start(n, nodeStartConfig(n)).catch(() => {});
      }
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  // Graceful shutdown: lightningd deserves a clean `stop` (db close) before we go.
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    Promise.race([nodeMgr.stopAll(), new Promise((r) => setTimeout(r, 8000))])
      .finally(() => app.exit(0));
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
