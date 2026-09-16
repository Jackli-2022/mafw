import { MafwClient } from "@mafw/sdk"
import { BrowserWindow, Notification, app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { join } from "path"
import { readdir } from "node:fs/promises"
import {
  getGatewayStatus,
  getGatewayPort,
  onGatewayStateChange,
  startGateway,
  stopGateway,
} from "./mafw-sidecar"
import { getLastFocusedWindow, trayIconPath, createMainWindow } from "./windows"
import { walkProjectFiles } from "./file-listing"
import { buildUpdateToken, pendingRestartPath, atomicWriteToken } from "./pending-update"
import { writeFile } from "node:fs/promises"
import { UiPluginManager } from "./ui-plugins"
import type { RenderRequest } from "../shared/ui-plugins"
import { write as writeLog } from "./logging"
import { createGatewayHealthMonitor, createRestartScheduler } from "./gateway-health"

let mafwClient: import("@mafw/sdk").MafwClient | null = null

// ── Health Monitor + auto-restart ──
const HEALTH_INTERVAL_MS = 30_000
const MAX_CONSECUTIVE_FAILURES = 5
const RESTART_DELAY_MS = 3_000
const RESTART_MAX_ATTEMPTS = 3

let health: ReturnType<typeof createGatewayHealthMonitor> | null = null

// Bounded auto-restart after an announced failure (unexpected gateway exit or
// failed start). Reset on "ready". Keeps the desktop self-healing without an
// unbounded crash loop.
const restartScheduler = createRestartScheduler({
  delayMs: RESTART_DELAY_MS,
  maxAttempts: RESTART_MAX_ATTEMPTS,
  run: () => {
    writeLog("utility", "gateway auto-restart triggered", { attempt: restartScheduler.attempts }, "info")
    stopGateway()
    void startGateway()
  },
  onExhausted: (attempts) => {
    writeLog("utility", "gateway auto-restart exhausted — manual restart required", { attempts }, "error")
  },
})

function pushHealthEvent(healthy: boolean, failures: number) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("mafw-gateway-health", { healthy, failures })
  }
}

function stopHealthMonitor() {
  health?.stop()
  health = null
}

function startHealthMonitor() {
  stopHealthMonitor()
  health = createGatewayHealthMonitor(
    {
      probe: async () => {
        if (!mafwClient) throw new Error("gateway client unavailable")
        await mafwClient.project.current()
      },
      onFirstFailure: () => {
        writeLog("utility", "mafw gateway health check failed", undefined, "warn")
        pushHealthEvent(false, 1)
      },
      onAttemptFail: (n) => {
        writeLog("utility", "mafw gateway health check failed", { attempt: n }, "warn")
        pushHealthEvent(false, n)
      },
      onRecovery: () => pushHealthEvent(true, 0),
      onGiveUp: (n) => {
        writeLog("utility", "mafw gateway health check failed — restarting", { consecutiveFailures: n }, "warn")
        mafwClient = null
        stopGateway()
        void startGateway()
      },
    },
    { intervalMs: HEALTH_INTERVAL_MS, maxFailures: MAX_CONSECUTIVE_FAILURES },
  )
  health.start()
}

// ── IPC Handlers ──

export function registerMafwIpcHandlers() {
  onGatewayStateChange((state) => {
    if (state === "ready") {
      restartScheduler.reset()
      const port = getGatewayPort()
      if (port) mafwClient = new MafwClient(`http://127.0.0.1:${port}`)
      startHealthMonitor()
    } else {
      mafwClient = null
      stopHealthMonitor()
      // Unexpected exit / failed start: schedule a bounded auto-restart.
      if (state === "failed") restartScheduler.request()
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("mafw-gateway-state", getGatewayStatus())
    }
  })

  ipcMain.handle("mafw-gateway-info", () => getGatewayStatus())

  // Open an additional main window (window-registry already persists ids).
  ipcMain.handle("mafw-new-window", () => {
    try {
      createMainWindow()
      return { ok: true }
    } catch (err) {
      writeLog("utility", "mafw-new-window failed", { err: String(err) }, "warn")
      return { ok: false, error: String(err) }
    }
  })

  // Export a session as Markdown: renderer builds the content (pure fn),
  // main owns the save dialog + file write (renderer is sandboxed).
  ipcMain.handle("mafw-export-session", async (event: IpcMainInvokeEvent, opts: { filename: string; markdown: string }) => {
    try {
      const { BrowserWindow: BW, dialog } = await import("electron")
      const win = BW.fromWebContents(event.sender)
      const safeName = (opts.filename || "session").replace(/[\\/:*?"<>|]/g, "_")
      const dialogOpts = {
        title: "导出会话为 Markdown",
        defaultPath: `${safeName}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      }
      const res = win ? await dialog.showSaveDialog(win, dialogOpts) : await dialog.showSaveDialog(dialogOpts)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await writeFile(res.filePath, opts.markdown, "utf8")
      writeLog("utility", "mafw-export-session saved", { path: res.filePath, bytes: opts.markdown.length })
      return { ok: true, path: res.filePath }
    } catch (err) {
      writeLog("utility", "mafw-export-session failed", { err: String(err) }, "warn")
      return { ok: false, error: String(err) }
    }
  })

  // Open-project entry (Rail switcher): main owns the native directory picker
  // (renderer is sandboxed). Returns { ok, path } or { ok:false, canceled }.
  ipcMain.handle("mafw-open-directory", async (event: IpcMainInvokeEvent) => {
    try {
      const { BrowserWindow: BW, dialog } = await import("electron")
      const win = BW.fromWebContents(event.sender)
      const res = win
        ? await dialog.showOpenDialog(win, { title: "打开项目文件夹", properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ title: "打开项目文件夹", properties: ["openDirectory"] })
      if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
      writeLog("utility", "mafw-open-directory", { path: res.filePaths[0] })
      return { ok: true, path: res.filePaths[0] }
    } catch (err) {
      writeLog("utility", "mafw-open-directory failed", { err: String(err) }, "warn")
      return { ok: false, error: String(err) }
    }
  })

  // OS-level notification for away-from-window moments (close-to-tray).
  // The renderer decides relevance (document.hidden) and throttling.
  ipcMain.handle("mafw-notify", (_event: IpcMainInvokeEvent, opts: { title: string; body: string }) => {
    if (!Notification.isSupported()) return false
    try {
      const n = new Notification({ title: opts.title, body: opts.body, icon: trayIconPath() })
      n.on("click", () => { const win = getLastFocusedWindow(); if (win) { win.show(); win.focus() } })
      n.show()
      return true
    } catch {
      return false
    }
  })

  // Project file listing for the @file mention picker. 30s cache per root.
  let fileListCache: { at: number; root: string; files: string[] } | null = null
  ipcMain.handle("mafw-list-files", async () => {
    try {
      if (!mafwClient) return []
      const project = await mafwClient.project.current()
      const root = project?.worktree
      if (!root) return []
      if (fileListCache && fileListCache.root === root && Date.now() - fileListCache.at < 30_000) {
        return fileListCache.files
      }
      const io = async (dir: string) => {
        const dirents = await readdir(dir, { withFileTypes: true })
        return dirents.map(d => ({ name: d.name, isDirectory: () => d.isDirectory() }))
      }
      const files = await walkProjectFiles(root, io)
      fileListCache = { at: Date.now(), root, files }
      writeLog("utility", "mafw-list-files ok", { root, count: files.length })
      return files
    } catch (err) {
      writeLog("utility", "mafw-list-files failed", { err: String(err) }, "warn")
      return []
    }
  })

  ipcMain.handle("mafw-gateway-logs-path", () => {
    return join(app.getPath("home"), ".mafw", "logs", "mafw.log")
  })

  ipcMain.handle("mafw-gateway-start", async () => {
    await startGateway()
    return getGatewayStatus()
  })

  ipcMain.handle("mafw-gateway-restart", async () => {
    restartScheduler.cancel()
    stopHealthMonitor()
    stopGateway()
    mafwClient = null
    await startGateway()
    return getGatewayStatus()
  })

  // Desktop trigger for the gateway self-update flow: writes the
  // pending-restart.json token consumed by gateway's 2s poller.
  ipcMain.handle("mafw-gateway-update", async () => {
    const path = pendingRestartPath()
    const io = {
      writeFile: async (p: string, data: string) => {
        const fs = await import("node:fs/promises")
        await fs.mkdir(join(p, ".."), { recursive: true })
        await fs.writeFile(p, data, "utf8")
      },
      rename: async (from: string, to: string) => {
        const fs = await import("node:fs/promises")
        await fs.rename(from, to)
      },
    }
    try {
      await atomicWriteToken(path, buildUpdateToken("desktop 更新按钮", app.getVersion()), io)
      writeLog("utility", "mafw-gateway-update token written", { path })
      return { ok: true }
    } catch (err) {
      writeLog("utility", "mafw-gateway-update failed", { err: String(err) }, "error")
      return { ok: false, error: String(err) }
    }
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

  ipcMain.handle("mafw-openUsagePluginsDir", async () => {
    const { shell } = require("electron")
    const path = require("path")
    const os = require("os")
    const dir = path.join(os.homedir(), ".mafw", "usage-plugins")
    await shell.openPath(dir)
  })

  // User tool-card plugins: main-local service (fs + require), NOT part of the
  // gateway SDK namespaces — dedicated channels, sandboxed renderer receives
  // declarative widget trees only.
  const uiPluginManager = new UiPluginManager()
  uiPluginManager.loadAll()
  uiPluginManager.setOnChange(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("mafw-ui-plugins-changed")
    }
  })
  uiPluginManager.watch()

  ipcMain.handle("mafw-ui-plugins-list", () => uiPluginManager.list())
  ipcMain.handle("mafw-ui-plugins-render", (_event: IpcMainInvokeEvent, req: RenderRequest) => uiPluginManager.render(req))

  // Plugin management card (Config page): status + manual reload.
  ipcMain.handle("mafw-ui-plugins-status", () => {
    return {
      entries: uiPluginManager.list(),
      dir: process.env.MAFW_UI_PLUGINS_DIR || undefined,
      lastLoad: uiPluginManager.lastLoad,
    }
  })
  ipcMain.handle("mafw-ui-plugins-reload", () => uiPluginManager.reload())
}
