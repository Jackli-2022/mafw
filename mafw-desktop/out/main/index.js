import { ipcMain, app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
let winRef = null;
function setMainWindow(win) {
  winRef = win;
}
function broadcast(channel, data) {
  if (winRef && !winRef.isDestroyed()) {
    winRef.webContents.send(channel, data);
  }
}
function registerIpcHandlers(port) {
  ipcMain.handle("gateway:get-port", () => port);
  ipcMain.handle("gateway:health-check", async () => {
    try {
      const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3e3) });
      return res.ok;
    } catch {
      return false;
    }
  });
  setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3e3) });
      broadcast("gateway:health", res.ok);
    } catch {
      broadcast("gateway:health", false);
    }
  }, 5e3);
}
let gatewayProcess = null;
let statusListeners = [];
function notify(connected) {
  for (const cb of statusListeners) cb(connected);
}
function startGateway(gatewayDir, port) {
  if (gatewayProcess) return;
  const entry = path.join(gatewayDir, "gateway", "dist", "gateway", "src", "index.js");
  gatewayProcess = spawn("node", [entry], {
    cwd: gatewayDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MAFW_SERVER_API_PORT: String(port) }
  });
  const origLog = console.log;
  gatewayProcess.stdout?.on("data", (data) => {
    origLog(`[gateway] ${data.toString().trim()}`);
  });
  gatewayProcess.stderr?.on("data", (data) => {
    origLog(`[gateway:err] ${data.toString().trim()}`);
  });
  gatewayProcess.on("exit", (code) => {
    const origLog2 = console.log;
    origLog2(`[sidecar] Gateway exited with code ${code}`);
    gatewayProcess = null;
    notify(false);
  });
  notify(true);
}
let mainWindow = null;
const GATEWAY_PORT = process.env.MAFW_DESKTOP_GATEWAY_PORT ? parseInt(process.env.MAFW_DESKTOP_GATEWAY_PORT) : 3e3;
const DEV = process.env.MAFW_DESKTOP_DEV === "true";
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "MAFW Desktop",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    setMainWindow(mainWindow);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (DEV || process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL || "http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
app.whenReady().then(() => {
  const gatewayDir = DEV ? path.resolve(process.cwd(), "..") : path.dirname(app.getPath("exe"));
  registerIpcHandlers(GATEWAY_PORT);
  void checkGateway(gatewayDir, GATEWAY_PORT);
  createWindow();
  async function checkGateway(gatewayDir2, port) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2e3) });
      if (res.ok) {
        console.log("[main] Gateway already running on port", port);
        return;
      }
    } catch {
    }
    console.log("[main] Starting Gateway on port", port);
    startGateway(gatewayDir2, port);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
