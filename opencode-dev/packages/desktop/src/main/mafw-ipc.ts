import { MafwClient } from "@mafw/sdk"
import { BrowserWindow, app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { join } from "path"
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

  ipcMain.handle("mafw-gateway-logs-path", () => {
    return join(app.getPath("home"), ".mafw", "logs", "mafw.log")
  })

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
    console.log(`[mafw] IPC invoke: ${namespace}.${method}`, args.length > 0 ? JSON.stringify(args).slice(0, 100) : '')
    if (!mafwClient) throw new Error("MAFW Gateway not ready")
    const ns = (mafwClient as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[namespace]
    if (!ns) {
      const available = Object.keys(mafwClient as unknown as Record<string, unknown>).join(", ")
      writeLog("utility", `mafw-invoke unknown namespace: ${namespace}`, { available }, "error")
      throw new Error(`Unknown namespace: ${namespace} (available: ${available})`)
    }
    const fn = ns[method]
    if (typeof fn !== "function") throw new Error(`Unknown method: ${namespace}.${method}`)
    return fn(...args)
  })

  // Binary media upload straight from the main process to the gateway. Node's
  // network stack bypasses the renderer's (Chromium) proxy settings, which can
  // hang or stall plain fetches to 127.0.0.1.
  ipcMain.handle("mafw-media-upload", async (_event: IpcMainInvokeEvent, bytes: ArrayBuffer | Buffer, mediaType: string) => {
    const port = getGatewayPort()
    if (!port) throw new Error("MAFW Gateway not ready")
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(new Uint8Array(bytes))
    const res = await fetch(
      `http://127.0.0.1:${port}/api/media/upload?type=${encodeURIComponent(mediaType)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(buf),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!res.ok) throw new Error(`媒体上传失败: HTTP ${res.status}`)
    const data: any = await res.json()
    if (!data?.artifactId) throw new Error("媒体上传失败: 无 artifactId")
    writeLog("utility", "mafw-media-upload ok", { mediaType, bytes: buf.byteLength, artifactId: data.artifactId.slice(0, 8) })
    return data.artifactId
  })

  // Combined upload + createTask in a single IPC call. Saves one round-trip
  // compared to mafw-media-upload followed by mafw-invoke("media", "createTask").
  ipcMain.handle("mafw-media-upload-and-create", async (_event: IpcMainInvokeEvent, bytes: ArrayBuffer | Buffer, mediaType: string, question?: string) => {
    const t0 = Date.now()
    const port = getGatewayPort()
    if (!port) throw new Error("MAFW Gateway not ready")
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(new Uint8Array(bytes))
    const qs = new URLSearchParams({ type: mediaType })
    if (question) qs.set("question", question)
    const t1 = Date.now()
    const res = await fetch(
      `http://127.0.0.1:${port}/api/media/upload-and-create?${qs.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(buf),
        signal: AbortSignal.timeout(15_000),
      },
    )
    const t2 = Date.now()
    if (!res.ok) throw new Error(`媒体上传失败: HTTP ${res.status}`)
    const data: any = await res.json()
    if (!data?.id) throw new Error("媒体上传失败: 无 task id")
    const t3 = Date.now()
    writeLog("utility", "mafw-media-upload-and-create ok", {
      mediaType,
      bytes: buf.byteLength,
      taskId: data.id.slice(0, 8),
      prepMs: t1 - t0,
      httpMs: t2 - t1,
      parseMs: t3 - t2,
      totalMs: t3 - t0,
    })
    console.log(`[mafw][perf] upload-and-create: prep=${t1 - t0}ms http=${t2 - t1}ms parse=${t3 - t2}ms total=${t3 - t0}ms (${buf.byteLength} bytes)`)
    return { id: data.id, contextId: data.contextId, state: data.state, artifactId: data.artifactId, mediaType: data.mediaType, size: data.size }
  })
}
