'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { call } = require('./cln');
const { restCall } = require('./cln-rest');
const { NodeManager } = require('./node');

const nodeMgr = new NodeManager();

// --- tiny persistent config (socket path) -----------------------------------
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function defaultSocket() {
  // Common CLN locations; the user overrides in Settings.
  const cands = [
    path.join(os.homedir(), '.lightning', 'bitcoin', 'lightning-rpc'),
    path.join(os.homedir(), '.lightning', 'lightning-rpc'),
    path.join(os.homedir(), '.lightning', 'liquid-regtest', 'lightning-rpc'),
    path.join(os.homedir(), '.lightning', 'regtest', 'lightning-rpc'),
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return '';
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); } catch {}
}
let config = null;
function getConfig() {
  if (!config) {
    config = loadConfig();
    if (!config.socket) config.socket = defaultSocket();
    if (!config.mode) config.mode = 'external';           // 'external' | 'managed'
    if (!config.node) config.node = { lightningdPath: '', lightningDir: path.join(os.homedir(), '.fulmen', 'seqln'), network: 'bitcoin', extraArgs: [] };
  }
  return config;
}

// The transport the RPC layer should use, in priority order: a running managed
// node (its own unix socket on Linux, or its clnrest endpoint in WSL) wins;
// then an explicitly-configured clnrest (remote) transport; then the external
// unix socket. Returns { type:'socket', socket } or { type:'rest', host,port,protocol,rune }.
function currentTransport() {
  const c = getConfig();
  const s = nodeMgr.status();
  if (s.running && s.transport) return s.transport;         // managed WSL node -> clnrest
  if (s.running && s.socketPath) return { type: 'socket', socket: s.socketPath }; // managed local node
  if (c.transport && c.transport.type === 'rest' && c.transport.port) return c.transport; // remote clnrest
  if (c.socket) return { type: 'socket', socket: c.socket };
  return null;
}

async function callNode(method, params) {
  const t = currentTransport();
  if (!t) throw new Error('No SeqLN node configured (Settings → connect to a node, run a bundled one, or point at a remote clnrest).');
  if (t.type === 'rest') return restCall(t, method, params || {});
  return call(t.socket, method, params || {});
}

// --- IPC: the renderer drives SeqLN through here ----------------------------
ipcMain.handle('get-config', () => getConfig());
ipcMain.handle('set-socket', (_e, sock) => { const c = getConfig(); c.socket = String(sock || '').trim(); c.transport = null; saveConfig(c); return c; });
ipcMain.handle('set-transport', (_e, t) => { const c = getConfig(); c.transport = t && t.port ? t : null; saveConfig(c); return c; });
ipcMain.handle('set-node-config', (_e, patch) => { const c = getConfig(); c.mode = patch.mode || c.mode; c.node = Object.assign({}, c.node, patch.node || {}); saveConfig(c); return c; });
ipcMain.handle('node-status', () => Object.assign({ mode: getConfig().mode }, nodeMgr.status()));
ipcMain.handle('node-start', async () => { await nodeMgr.start(getConfig().node); return nodeMgr.status(); });
ipcMain.handle('node-stop', async () => { await nodeMgr.stop(); return nodeMgr.status(); });
ipcMain.handle('rpc', (_e, method, params) => callNode(method, params));

// --- window ------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1080, height: 760, minWidth: 820, minHeight: 560,
    backgroundColor: '#0e1116',
    title: 'Fulmen',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  createWindow();
  // If the user configured a managed (bundled) node, bring it up. Don't block
  // the window — the renderer shows node status and retries.
  const c = getConfig();
  if (c.mode === 'managed' && nodeMgr.supported() && c.node && c.node.lightningdPath) {
    nodeMgr.start(c.node).catch(() => {}); // errors surface via node-status
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { nodeMgr.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
