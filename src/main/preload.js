'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only surface the renderer sees. No Node, no direct socket access.
contextBridge.exposeInMainWorld('fulmen', {
  rpc: (method, params) => ipcRenderer.invoke('rpc', method, params),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setSocket: (sock) => ipcRenderer.invoke('set-socket', sock),
});
