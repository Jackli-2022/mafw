// Wire contract between the plugin-web preload (`src/preload/plugin-web.ts`) and
// the surface host renderer (`renderer/mafw/plugins/PluginWebSurfaceHost.tsx`).
//
// The page lives in a sandboxed `<webview>` with no node integration; this
// channel is its only way to talk to MAFW. Both sides import this module so the
// channel name, version and method list cannot drift (spec 2026-11-09 §6.3).
export const PLUGIN_WEB_BRIDGE_CHANNEL = "mafw-plugin-bridge"

/** `window.mafwPlugin.version`: bump on an incompatible protocol change. */
export const PLUGIN_WEB_BRIDGE_VERSION = 1

/**
 * Longest page-published title the host accepts (`setTitle` / `<title>`).
 * A page with a huge title would otherwise be able to push a megabyte into the
 * tab strip every frame.
 */
export const PLUGIN_WEB_MAX_TITLE_LENGTH = 200

/**
 * Every method a page may call. The host rejects anything else — the bridge is
 * an allowlist, never a generic RPC pipe into the renderer.
 */
export const PLUGIN_WEB_BRIDGE_METHODS = [
  "context",
  "invoke",
  "onEvent",
  "setBadge",
  "setTitle",
  "openExternal",
  "onThemeChange",
  "onContextChange",
] as const

export type PluginWebBridgeMethod = (typeof PLUGIN_WEB_BRIDGE_METHODS)[number]

export type PluginWebTheme = "light" | "dark"

/** Page → host request frame. */
export interface PluginWebBridgeRequest {
  id?: unknown
  method?: unknown
  params?: unknown
}

/** Host → page reply frame (settles the pending promise in the preload). */
export interface PluginWebBridgeReply {
  id: unknown
  ok: boolean
  result?: unknown
  error?: string
}

/** Host → page push frames (subscriptions; they have no request id). */
export type PluginWebBridgePush =
  | {
      kind: "event"
      /** Fully-qualified `plugin:<pkg>:<event>` name (the canonical key). */
      type: string
      /**
       * The key the page passed to `onEvent` (`deploy` shorthand or the full
       * type). Sent so the preload can find a subscriber registered under the
       * shorthand before it learned the normalized name — the host normalizes,
       * the page keeps calling `onEvent("deploy", cb)` synchronously.
       */
      key?: string
      payload: unknown
    }
  | { kind: "theme"; theme: PluginWebTheme }
  | { kind: "context"; context: { projectDir?: string; sessionID?: string } }

/**
 * Page-side event dispatcher shared by the preload and the tests.
 *
 * Subscribers are keyed by exactly what the page passed to `onEvent`; a push is
 * delivered when either the canonical `type` or the requested `key` matches.
 * That keeps `onEvent(type, cb)` synchronous (no waiting for the host's
 * normalization reply) while the shorthand stays live on the wire.
 */
export interface PluginWebEventHub {
  subscribe(key: string, callback: (payload: unknown) => void): () => void
  /** Deliver one push; false when nobody was listening. */
  dispatch(frame: PluginWebBridgePush): boolean
  clear(): void
}

export function createPluginWebEventHub(): PluginWebEventHub {
  const buckets = new Map<string, Set<(payload: unknown) => void>>()

  return {
    subscribe(key, callback) {
      const normalized = typeof key === "string" ? key.trim() : ""
      if (normalized.length === 0 || typeof callback !== "function") return () => {}
      let bucket = buckets.get(normalized)
      if (!bucket) {
        bucket = new Set()
        buckets.set(normalized, bucket)
      }
      bucket.add(callback)
      return () => {
        const current = buckets.get(normalized)
        if (!current) return
        current.delete(callback)
        if (current.size === 0) buckets.delete(normalized)
      }
    },

    dispatch(frame) {
      if (!frame || frame.kind !== "event" || typeof frame.type !== "string") return false
      // De-duplicate: a callback registered under both `deploy` and the full
      // type must still fire once per push.
      const recipients = new Set<(payload: unknown) => void>()
      const byType = buckets.get(frame.type)
      if (byType) for (const callback of byType) recipients.add(callback)
      const key = typeof frame.key === "string" ? frame.key : ""
      if (key.length > 0 && key !== frame.type) {
        const byKey = buckets.get(key)
        if (byKey) for (const callback of byKey) recipients.add(callback)
      }
      if (recipients.size === 0) return false
      for (const callback of recipients) {
        try {
          callback(frame.payload)
        } catch {
          /* one page listener must not break the others */
        }
      }
      return true
    },

    clear() {
      buckets.clear()
    },
  }
}

/** Answer to `context()`. */
export interface PluginWebBridgeContext {
  /** Absent for a `scope: "global"` surface (not bound to a project). */
  projectDir?: string
  sessionID?: string
  surface: string
  theme: PluginWebTheme
}

/** True when `method` is one of the bridged methods. */
export function isPluginWebBridgeMethod(method: unknown): method is PluginWebBridgeMethod {
  return typeof method === "string" && (PLUGIN_WEB_BRIDGE_METHODS as readonly string[]).includes(method)
}
