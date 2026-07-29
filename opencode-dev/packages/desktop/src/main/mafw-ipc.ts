import { MafwClient } from "@mafw/sdk"
import { BrowserWindow, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import {
  getGatewayStatus,
  getGatewayPort,
  onGatewayStateChange,
  startGateway,
  stopGateway,
} from "./mafw-sidecar"
import { write as writeLog } from "./logging"

let mafwClient: import("@mafw/sdk").MafwClient | null = null

// ── Health Monitor ──
const HEALTH_INTERVAL_MS = 30_000
const MAX_CONSECUTIVE_FAILURES = 5

let healthTimer: ReturnType<typeof setInterval> | null = null
let consecutiveFailures = 0

function stopHealthMonitor() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null }
  consecutiveFailures = 0
}

function startHealthMonitor() {
  stopHealthMonitor()
  consecutiveFailures = 0

  healthTimer = setInterval(async () => {
    if (!mafwClient) { consecutiveFailures++; return }
    try {
      await mafwClient.project.current()
      consecutiveFailures = 0
    } catch {
      consecutiveFailures++
      writeLog("utility", "mafw gateway health check failed", { attempt: consecutiveFailures }, "warn")
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        writeLog("utility", "mafw gateway health check failed — restarting", { consecutiveFailures }, "warn")
        mafwClient = null
        stopHealthMonitor()
        stopGateway()
        void startGateway()
      }
    }
  }, HEALTH_INTERVAL_MS)
  healthTimer.unref()
}

// ── IPC Handlers ──

export function registerMafwIpcHandlers() {
  onGatewayStateChange((state) => {
    if (state === "ready") {
      const port = getGatewayPort()
      if (port) mafwClient = new MafwClient(`http://127.0.0.1:${port}`)
      startHealthMonitor()
    } else {
      mafwClient = null
      stopHealthMonitor()
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("mafw-gateway-state", getGatewayStatus())
    }
  })

  ipcMain.handle("mafw-gateway-info", () => getGatewayStatus())

  ipcMain.handle("mafw-gateway-start", async () => {
    await startGateway()
    return getGatewayStatus()
  })

  ipcMain.handle("mafw-gateway-restart", async () => {
    stopHealthMonitor()
    stopGateway()
    mafwClient = null
    await startGateway()
    return getGatewayStatus()
  })

  ipcMain.handle("mafw-invoke", async (_event: IpcMainInvokeEvent, namespace: string, method: string, ...args: unknown[]) => {
    if (!mafwClient) throw new Error("MAFW Gateway not ready")
    const ns = (mafwClient as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[namespace]
    if (!ns) throw new Error(`Unknown namespace: ${namespace}`)
    const fn = ns[method]
    if (typeof fn !== "function") throw new Error(`Unknown method: ${namespace}.${method}`)
    return fn(...args)
  })
}
