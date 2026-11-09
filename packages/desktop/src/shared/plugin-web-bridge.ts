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
  | { kind: "event"; type: string; payload: unknown }
  | { kind: "theme"; theme: PluginWebTheme }
  | { kind: "context"; context: { projectDir: string; sessionID?: string } }

/** Answer to `context()`. */
export interface PluginWebBridgeContext {
  projectDir: string
  sessionID?: string
  surface: string
  theme: PluginWebTheme
}

/** True when `method` is one of the bridged methods. */
export function isPluginWebBridgeMethod(method: unknown): method is PluginWebBridgeMethod {
  return typeof method === "string" && (PLUGIN_WEB_BRIDGE_METHODS as readonly string[]).includes(method)
}
