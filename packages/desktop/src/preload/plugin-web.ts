// packages/desktop/src/preload/plugin-web.ts
// Preload for sandboxed plugin web surfaces. electron-vite emits this entry as
// `out/preload/plugin-web.js`; `main/plugin-web-session.ts` force-installs it on
// every `<webview>` that uses a `persist:mafw-plugin-*` partition (node
// integration off, context isolation + sandbox on).
//
// It exposes `window.mafwPlugin` and nothing else. Every call is a
// `{id, method, params}` frame over `ipcRenderer.sendToHost("mafw-plugin-bridge")`
// that the surface host routes through `createPluginWebBridge` (renderer). The
// page never gets an Electron object, a node primitive or a cross-package API:
// the host enforces the package allowlist, this side only frames messages.
import { contextBridge, ipcRenderer } from "electron"
import {
  PLUGIN_WEB_BRIDGE_CHANNEL,
  PLUGIN_WEB_BRIDGE_VERSION,
  type PluginWebBridgePush,
  type PluginWebBridgeReply,
  type PluginWebTheme,
} from "../shared/plugin-web-bridge"

const REQUEST_TIMEOUT_MS = 30_000

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

let sequence = 0
const pending = new Map<number, Pending>()
const eventSubscribers = new Map<string, Set<(payload: unknown) => void>>()
const requestedEvents = new Set<string>()
const themeSubscribers = new Set<(theme: PluginWebTheme) => void>()
const contextSubscribers = new Set<
  (context: { projectDir: string; sessionID?: string }) => void
>()
let themeRequested = false
let contextRequested = false

function call(method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`plugin bridge timeout: ${method}`))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    try {
      ipcRenderer.sendToHost(PLUGIN_WEB_BRIDGE_CHANNEL, { id, method, params })
    } catch (err) {
      clearTimeout(timer)
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** Fire-and-forget call (badge/title/openExternal): failures must not throw into the page. */
function notify(method: string, params?: unknown): void {
  void call(method, params).catch(() => {
    /* host gone or denied — the page only asked for a side effect */
  })
}

function dispatchPush(frame: PluginWebBridgePush): void {
  switch (frame.kind) {
    case "event": {
      const bucket = eventSubscribers.get(frame.type)
      if (!bucket) return
      for (const listener of [...bucket]) {
        try {
          listener(frame.payload)
        } catch {
          /* a page listener must not break the others */
        }
      }
      return
    }
    case "theme":
      for (const listener of [...themeSubscribers]) {
        try {
          listener(frame.theme)
        } catch {
          /* ignore */
        }
      }
      return
    case "context":
      for (const listener of [...contextSubscribers]) {
        try {
          listener(frame.context)
        } catch {
          /* ignore */
        }
      }
      return
  }
}

ipcRenderer.on(PLUGIN_WEB_BRIDGE_CHANNEL, (_event: unknown, raw: unknown) => {
  if (!raw || typeof raw !== "object") return
  const frame = raw as PluginWebBridgeReply | PluginWebBridgePush
  if (!("kind" in frame) && typeof (frame as PluginWebBridgeReply).id === "number") {
    const reply = frame as PluginWebBridgeReply
    const entry = pending.get(reply.id as number)
    if (!entry) return
    pending.delete(reply.id as number)
    clearTimeout(entry.timer)
    if (reply.ok) entry.resolve(reply.result)
    else entry.reject(new Error(reply.error || "plugin bridge error"))
    return
  }
  dispatchPush(raw as PluginWebBridgePush)
})

/** Drop every pending promise when the host navigates the page away. */
window.addEventListener("pagehide", () => {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error("plugin bridge disposed"))
    pending.delete(id)
  }
})

const api = {
  version: PLUGIN_WEB_BRIDGE_VERSION,

  context: () => call("context"),

  invoke: (action: string, input?: unknown) => call("invoke", { action, input }),

  onEvent: (type: string, callback: (payload: unknown) => void): (() => void) => {
    const key = String(type ?? "")
    let bucket = eventSubscribers.get(key)
    if (!bucket) {
      bucket = new Set()
      eventSubscribers.set(key, bucket)
    }
    bucket.add(callback)
    if (!requestedEvents.has(key)) {
      requestedEvents.add(key)
      notify("onEvent", { type: key })
    }
    return () => {
      const current = eventSubscribers.get(key)
      if (!current) return
      current.delete(callback)
      if (current.size === 0) eventSubscribers.delete(key)
    }
  },

  setBadge: (count: number) => notify("setBadge", { count }),

  setTitle: (title: string) => notify("setTitle", { title }),

  openExternal: (url: string) => notify("openExternal", { url }),

  onThemeChange: (callback: (theme: PluginWebTheme) => void): (() => void) => {
    themeSubscribers.add(callback)
    if (!themeRequested) {
      themeRequested = true
      notify("onThemeChange")
    }
    return () => {
      themeSubscribers.delete(callback)
    }
  },

  onContextChange: (
    callback: (context: { projectDir: string; sessionID?: string }) => void,
  ): (() => void) => {
    contextSubscribers.add(callback)
    if (!contextRequested) {
      contextRequested = true
      notify("onContextChange")
    }
    return () => {
      contextSubscribers.delete(callback)
    }
  },
}

contextBridge.exposeInMainWorld("mafwPlugin", api)
