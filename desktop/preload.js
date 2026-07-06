const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mafw', {
  getGatewayStatus: () => ipcRenderer.invoke('gateway:status'),
  getGatewayLogs: () => ipcRenderer.invoke('gateway:logs'),
  startGateway: () => ipcRenderer.invoke('gateway:start'),
  stopGateway: () => ipcRenderer.invoke('gateway:stop'),
  restartGateway: () => ipcRenderer.invoke('gateway:restart'),
})
