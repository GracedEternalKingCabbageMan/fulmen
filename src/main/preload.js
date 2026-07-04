'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only surface the renderer sees. No Node, no direct socket access.
contextBridge.exposeInMainWorld('fulmen', {
  rpc: (method, params) => ipcRenderer.invoke('rpc', method, params),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setSocket: (sock) => ipcRenderer.invoke('set-socket', sock),
  setTransport: (t) => ipcRenderer.invoke('set-transport', t),
  setNodeConfig: (patch) => ipcRenderer.invoke('set-node-config', patch),
  nodeStatus: () => ipcRenderer.invoke('node-status'),
  nodeStart: () => ipcRenderer.invoke('node-start'),
  nodeStop: () => ipcRenderer.invoke('node-stop'),
});
