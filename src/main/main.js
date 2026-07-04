'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { call } = require('./cln');

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
  if (!config) { config = loadConfig(); if (!config.socket) config.socket = defaultSocket(); }
  return config;
}

// --- IPC: the renderer drives SeqLN through here ----------------------------
ipcMain.handle('get-config', () => getConfig());
ipcMain.handle('set-socket', (_e, sock) => { const c = getConfig(); c.socket = String(sock || '').trim(); saveConfig(c); return c; });
ipcMain.handle('rpc', async (_e, method, params) => {
  const sock = getConfig().socket;
  if (!sock) throw new Error('No SeqLN socket configured (Settings → lightning-rpc path).');
  return call(sock, method, params || {});
});

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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
