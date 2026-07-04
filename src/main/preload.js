'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only surface the renderer sees. No Node, no direct socket access.
contextBridge.exposeInMainWorld('fulmen', {
  rpc: (method, params) => ipcRenderer.invoke('rpc', method, params),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setSocket: (sock) => ipcRenderer.invoke('set-socket', sock),
  setTransport: (t) => ipcRenderer.invoke('set-transport', t),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  setOnboarded: (v) => ipcRenderer.invoke('set-onboarded', v),
  setActiveNetwork: (n) => ipcRenderer.invoke('set-active-network', n),
  setNodeSettings: (network, patch) => ipcRenderer.invoke('set-node-settings', network, patch),
  testBackend: (network, backend) => ipcRenderer.invoke('test-backend', network, backend),
  backendHeight: (network) => ipcRenderer.invoke('backend-height', network),
  nodeStatus: () => ipcRenderer.invoke('node-status'),
  nodeStart: (network) => ipcRenderer.invoke('node-start', network),
  nodeStop: (network) => ipcRenderer.invoke('node-stop', network),
  nodeLogs: (network) => ipcRenderer.invoke('node-logs', network),
  hsmInfo: (network) => ipcRenderer.invoke('hsm-info', network),
  revealPath: (p) => ipcRenderer.invoke('reveal-path', p),
});
