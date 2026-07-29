import { contextBridge, ipcRenderer } from "electron";
const api = {
  async healthCheck() {
    try {
      return await ipcRenderer.invoke("gateway:health-check");
    } catch {
      return false;
    }
  },
  async getPort() {
    return ipcRenderer.invoke("gateway:get-port");
  },
  onHealth(callback) {
    const handler = (_, connected) => callback(connected);
    ipcRenderer.on("gateway:health", handler);
    return () => ipcRenderer.removeListener("gateway:health", handler);
  }
};
contextBridge.exposeInMainWorld("mafwAPI", api);
