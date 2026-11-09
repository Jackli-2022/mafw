// Task 8: host-side bridge router for sandboxed plugin pages.
//
// `<webview>` pages talk to MAFW through `window.mafwPlugin` (preload,
// `src/preload/plugin-web.ts`). The preload only forwards `{id, method, params}`
// frames on one channel; this module is the whole trust boundary between a
// package page and the renderer:
//
// - the method allowlist is the shared contract (`shared/plugin-web-bridge`);
// - `invoke` always passes the host's package name, so a page cannot reach
//   another package's actions by adding `params.pkg`;
// - `onEvent`/`emit` are namespaced to `plugin:<pkg>:*` — a page can neither
//   subscribe to nor receive another package's events;
// - `openExternal` only accepts http(s)/mailto/tel, the same rule as the
//   browser guest (`shared/browser-policy`), never `file:`/`javascript:`/`data:`.
//
// Pure: no Electron, no DOM, no Solid. The host component owns the webview and
// injects every side effect; errors the page cannot fix are reported through
// `deps.onError` (surface banner) instead of thrown into the renderer.
import type {
  PluginWebBridgeContext,
  PluginWebBridgePush,
  PluginWebBridgeReply,
  PluginWebBridgeRequest,
  PluginWebTheme,
} from "../../../shared/plugin-web-bridge"
import { isPluginWebBridgeMethod } from "../../../shared/plugin-web-bridge"

// Re-exported so hosts/tests need one import (the wire types live in `shared`).
export type {
  PluginWebBridgeContext,
  PluginWebBridgePush,
  PluginWebBridgeReply,
  PluginWebBridgeRequest,
  PluginWebTheme,
} from "../../../shared/plugin-web-bridge"

const MAX_ACTION_LENGTH = 200
const MAX_TITLE_LENGTH = 200
const MAX_BADGE = 9999
const MAX_EXTERNAL_URL_LENGTH = 2048
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"])
const THEMES = new Set<PluginWebTheme>(["light", "dark"])

/** One page subscription and its host-side cleanup. */
interface Subscription {
  dispose(): void
}

export interface PluginWebBridgeDeps {
  /** Package the surface belongs to; every call is scoped to it. */
  pkg: string
  /** `plugin:<pkg>:<surface>` identity (returned by `context()`). */
  surface: string
  /** Current binding + theme (read lazily: it changes with the session). */
  context(): { projectDir: string; sessionID?: string; theme: PluginWebTheme }
  /** Host action transport; the bridge always passes its own `pkg`. */
  invoke(pkg: string, action: string, input: unknown): Promise<unknown>
  setBadge?(count: number): void
  setTitle?(title: string): void
  openExternal?(url: string): void
  /**
   * Subscribe to a `plugin:<pkg>:<event>` frame. The host wires this to the
   * committed-descriptor event hub; `null` when the package declared nothing.
   */
  subscribeEvent?(type: string, listener: (payload: unknown) => void): () => void
  subscribeTheme?(listener: (theme: PluginWebTheme) => void): () => void
  subscribeContext?(listener: (context: { projectDir: string; sessionID?: string }) => void): () => void
  /** Deliver one push frame to the page (`webview.send`). */
  send(push: PluginWebBridgePush): void
  /** Protocol/security violations worth a banner (not action failures). */
  onError?(message: string): void
}

export interface PluginWebBridge {
  handle(message: unknown): Promise<PluginWebBridgeReply>
  /** Push one frame to the page; false when the frame is invalid/out of scope. */
  emit(push: PluginWebBridgePush): boolean
  /** Unsubscribe every page subscription (webview teardown). */
  dispose(): void
}

export function createPluginWebBridge(deps: PluginWebBridgeDeps): PluginWebBridge {
  const subscriptions: Subscription[] = []
  let disposed = false

  const report = (message: string): void => {
    try {
      deps.onError?.(message)
    } catch {
      /* a failing banner must never break the bridge */
    }
  }

  const track = (dispose: () => void): void => {
    subscriptions.push({ dispose })
  }

  const emit = (push: PluginWebBridgePush): boolean => {
    if (!isValidPush(push, deps.pkg)) return false
    try {
      deps.send(push)
      return true
    } catch {
      return false
    }
  }

  const handle = async (message: unknown): Promise<PluginWebBridgeReply> => {
    const request = asRequest(message)
    if (!request) {
      report("invalid plugin bridge message")
      throw new Error("invalid plugin bridge message")
    }
    const id = request.id ?? 0
    const method = request.method
    if (!isPluginWebBridgeMethod(method)) {
      const label = typeof method === "string" ? method : JSON.stringify(method ?? null)
      report(`unknown plugin bridge method: ${label}`)
      throw new Error(`unknown plugin bridge method: ${label}`)
    }

    const params = asParams(request.params)
    switch (method) {
      case "context":
        return { id, ok: true, result: contextOf(deps) }

      case "invoke": {
        const action = typeof params.action === "string" ? params.action.trim() : ""
        if (action.length === 0 || action.length > MAX_ACTION_LENGTH) {
          throw new Error("invoke requires an action name (1-200 characters)")
        }
        try {
          const result = await deps.invoke(deps.pkg, action, params.input)
          return { id, ok: true, result }
        } catch (err) {
          return { id, ok: false, error: errorMessage(err) }
        }
      }

      case "onEvent": {
        const type = eventTypeFor(deps.pkg, params.type)
        if (!type) {
          const label = typeof params.type === "string" ? params.type : JSON.stringify(params.type ?? null)
          report(`event type outside package: ${label}`)
          throw new Error(`event type outside package: ${label}`)
        }
        const subscribe = deps.subscribeEvent
        if (subscribe) {
          const unsubscribe = subscribe(type, (payload) => {
            emit({ kind: "event", type, payload })
          })
          if (typeof unsubscribe === "function") track(unsubscribe)
        }
        return { id, ok: true, result: { type } }
      }

      case "setBadge": {
        const count = badgeCount(params.count)
        deps.setBadge?.(count)
        return { id, ok: true, result: { count } }
      }

      case "setTitle": {
        const title = typeof params.title === "string" ? params.title.trim().slice(0, MAX_TITLE_LENGTH) : ""
        if (title.length > 0) deps.setTitle?.(title)
        return { id, ok: true, result: { title } }
      }

      case "openExternal": {
        const url = sanitizePluginExternalUrl(params.url)
        if (!url) {
          return { id, ok: false, error: "external url is not allowed" }
        }
        deps.openExternal?.(url)
        return { id, ok: true, result: { url } }
      }

      case "onThemeChange": {
        const subscribe = deps.subscribeTheme
        if (subscribe) {
          const unsubscribe = subscribe((theme) => {
            emit({ kind: "theme", theme })
          })
          if (typeof unsubscribe === "function") track(unsubscribe)
        }
        return { id, ok: true, result: { subscribed: Boolean(subscribe) } }
      }

      case "onContextChange": {
        const subscribe = deps.subscribeContext
        if (subscribe) {
          const unsubscribe = subscribe((context) => {
            emit({ kind: "context", context })
          })
          if (typeof unsubscribe === "function") track(unsubscribe)
        }
        return { id, ok: true, result: { subscribed: Boolean(subscribe) } }
      }
    }
  }

  return {
    handle,
    emit,
    dispose() {
      if (disposed) return
      disposed = true
      for (const subscription of subscriptions.splice(0)) {
        try {
          subscription.dispose()
        } catch {
          /* teardown is best effort */
        }
      }
    },
  }
}

/**
 * Only http(s)/mailto/tel may leave the sandbox. `openExternal` on a dangerous
 * protocol hands the attack surface to the OS, so it is refused here rather
 * than sanitized later.
 */
export function sanitizePluginExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const url = value.trim()
  if (url.length === 0 || url.length > MAX_EXTERNAL_URL_LENGTH) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? url : null
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function contextOf(deps: PluginWebBridgeDeps): PluginWebBridgeContext {
  const binding = deps.context()
  const theme = THEMES.has(binding.theme) ? binding.theme : "dark"
  const context: PluginWebBridgeContext = {
    projectDir: binding.projectDir,
    surface: deps.surface,
    theme,
  }
  if (typeof binding.sessionID === "string" && binding.sessionID.length > 0) {
    context.sessionID = binding.sessionID
  }
  return context
}

/**
 * `deploy` → `plugin:demo:deploy`; a fully-qualified type from another package
 * is refused. A page can only ever address its own package namespace.
 */
function eventTypeFor(pkg: string, raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  if (value.length === 0 || value.length > 200 || /\s/.test(value)) return null
  if (value.startsWith("plugin:")) {
    return value.startsWith(`plugin:${pkg}:`) ? value : null
  }
  return `plugin:${pkg}:${value}`
}

function isValidPush(push: PluginWebBridgePush, pkg: string): boolean {
  if (!push || typeof push !== "object") return false
  if (push.kind === "event") {
    return typeof push.type === "string" && push.type.startsWith(`plugin:${pkg}:`)
  }
  if (push.kind === "theme") return THEMES.has(push.theme)
  if (push.kind === "context") {
    return !!push.context && typeof push.context.projectDir === "string" && push.context.projectDir.length > 0
  }
  return false
}

function badgeCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(MAX_BADGE, Math.floor(raw)))
}

function asRequest(message: unknown): PluginWebBridgeRequest | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null
  return message as PluginWebBridgeRequest
}

function asParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {}
  return params as Record<string, unknown>
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  const text = String(err ?? "")
  return text.length > 0 ? text : "plugin bridge call failed"
}
