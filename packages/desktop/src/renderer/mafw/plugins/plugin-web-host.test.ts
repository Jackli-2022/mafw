// Task 8: pure host model for the plugin web surface.
//
// Binding identity decides when the `<webview>` must be rebuilt (new partition +
// ticket) versus when the page only receives a `context` push; the refresh delay
// is the `expiresAt - 30min` ticket renewal. Both are pure so they run headless.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginWebSurfaceView } from "./plugin-web-surface"
import {
  PLUGIN_WEB_REFRESH_LEAD_MS,
  PLUGIN_WEB_REFRESH_MIN_MS,
  PLUGIN_WEB_TIMER_MAX_MS,
  pluginWebLoadErrorMessage,
  pluginWebRefreshDelay,
  webSurfaceBinding,
  webSurfaceBindingKey,
  webSurfaceBindsSession,
  webSurfaceContext,
} from "./plugin-web-host"

const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), "utf8")

const view = (over: Partial<PluginWebSurfaceView> = {}): PluginWebSurfaceView => ({
  packageName: "demo",
  surfaceId: "plugin:demo:db",
  id: "db",
  title: "DB",
  entry: "index.html",
  scope: "session",
  reloadOnSessionChange: true,
  revision: "boot-a:3",
  ...over,
})

describe("webSurfaceBinding", () => {
  test("session scope binds projectDir + the active session", () => {
    expect(webSurfaceBinding(view(), "/repo", "s1")).toEqual({ projectDir: "/repo", sessionID: "s1" })
    expect(webSurfaceBindsSession(view())).toBe(true)
  })

  test("session scope without an active session binds the project only", () => {
    expect(webSurfaceBinding(view(), "/repo", null)).toEqual({ projectDir: "/repo" })
    expect(webSurfaceBinding(view(), "/repo", "")).toEqual({ projectDir: "/repo" })
    expect(webSurfaceBinding(view(), "/repo", "  ")).toEqual({ projectDir: "/repo" })
  })

  test("reloadOnSessionChange=false keeps its opening ticket but never shares a partition", () => {
    // Still session-scoped for the ticket/partition (per-binding isolation), but
    // the host does not remount when the session changes.
    expect(webSurfaceBindsSession(view({ reloadOnSessionChange: false }))).toBe(false)
    expect(webSurfaceBinding(view({ reloadOnSessionChange: false }), "/repo", "s1")).toEqual({
      projectDir: "/repo",
      sessionID: "s1",
    })
    expect(
      webSurfaceBindingKey(view({ reloadOnSessionChange: false }), "/repo", "s1"),
    ).toBe(webSurfaceBindingKey(view({ reloadOnSessionChange: false }), "/repo", "s2"))
  })

  test("project and global scopes never bind a session", () => {
    for (const scope of ["project", "global"] as const) {
      expect(webSurfaceBindsSession(view({ scope }))).toBe(false)
      expect(webSurfaceBinding(view({ scope }), "/repo", "s1")).toEqual({ projectDir: "/repo" })
    }
  })
})

describe("webSurfaceBindingKey", () => {
  const key = (over: Partial<PluginWebSurfaceView> = {}, projectDir = "/repo", sessionID = "s1") =>
    webSurfaceBindingKey(view(over), projectDir, sessionID)

  test("is stable for the same surface, revision, project and session", () => {
    expect(key()).toBe(key())
    expect(key()).toBe(webSurfaceBindingKey(view(), "/repo", "s1"))
  })

  test("changes on revision, package, surface, project and session (session scope)", () => {
    const base = key()
    expect(key({ revision: "boot-a:4" })).not.toBe(base)
    expect(key({ packageName: "other", surfaceId: "plugin:other:db" })).not.toBe(base)
    expect(key({ surfaceId: "plugin:demo:other" })).not.toBe(base)
    expect(key({}, "/other", "s1")).not.toBe(base)
    expect(key({}, "/repo", "s2")).not.toBe(base)
  })

  test("ignores the session for project/global scopes and non-reloading surfaces", () => {
    expect(key({ scope: "project" })).toBe(key({ scope: "project" }, "/repo", "s2"))
    expect(key({ scope: "global" })).toBe(key({ scope: "global" }, "/repo", "s2"))
    expect(key({ reloadOnSessionChange: false })).toBe(
      key({ reloadOnSessionChange: false }, "/repo", "s2"),
    )
  })
})

describe("webSurfaceContext", () => {
  test("always carries the live session, including opted-out surfaces", () => {
    // Ticket binding and page context are different things: a page that keeps
    // its ticket still learns the new session through `contextChange`.
    expect(webSurfaceContext("/repo", "s1")).toEqual({ projectDir: "/repo", sessionID: "s1" })
    expect(webSurfaceContext("  /repo  ", " s2 ")).toEqual({ projectDir: "/repo", sessionID: "s2" })
    expect(webSurfaceContext("/repo", null)).toEqual({ projectDir: "/repo" })
    expect(webSurfaceContext("/repo", "   ")).toEqual({ projectDir: "/repo" })
    expect(webSurfaceContext("", "s1")).toEqual({ projectDir: "", sessionID: "s1" })
  })
})

describe("pluginWebRefreshDelay", () => {
  const now = 1_700_000_000_000

  test("schedules 30 minutes before the ticket expires", () => {
    expect(PLUGIN_WEB_REFRESH_LEAD_MS).toBe(30 * 60 * 1000)
    expect(pluginWebRefreshDelay(now + 8 * 60 * 60 * 1000, now)).toBe(
      8 * 60 * 60 * 1000 - PLUGIN_WEB_REFRESH_LEAD_MS,
    )
  })

  test("never refreshes more than once a minute (no hot loop on stale tickets)", () => {
    expect(pluginWebRefreshDelay(now + 60_000, now)).toBe(PLUGIN_WEB_REFRESH_MIN_MS)
    expect(pluginWebRefreshDelay(now - 10_000, now)).toBe(PLUGIN_WEB_REFRESH_MIN_MS)
  })

  test("clamps to the 32-bit setTimeout ceiling", () => {
    expect(pluginWebRefreshDelay(now + 40 * 24 * 60 * 60 * 1000, now)).toBe(PLUGIN_WEB_TIMER_MAX_MS)
    expect(PLUGIN_WEB_TIMER_MAX_MS).toBe(2_147_483_647)
  })

  test("tolerates a non-finite expiry", () => {
    expect(pluginWebRefreshDelay(Number.NaN, now)).toBe(PLUGIN_WEB_REFRESH_MIN_MS)
    expect(pluginWebRefreshDelay(Number.POSITIVE_INFINITY, now)).toBe(PLUGIN_WEB_TIMER_MAX_MS)
  })
})

describe("pluginWebLoadErrorMessage", () => {
  test("names the HTTP status when the gateway answered", () => {
    expect(pluginWebLoadErrorMessage(403, "")).toBe("插件页面加载失败（HTTP 403）")
    expect(pluginWebLoadErrorMessage(404, "Not Found")).toBe("插件页面加载失败（HTTP 404）")
  })

  test("falls back to the network description", () => {
    expect(pluginWebLoadErrorMessage(0, "ERR_CONNECTION_REFUSED")).toBe(
      "插件页面加载失败：ERR_CONNECTION_REFUSED",
    )
    expect(pluginWebLoadErrorMessage(null, null)).toBe("插件页面加载失败")
  })
})

describe("host + preload wiring pins", () => {
  test("the host consumes the partition and url returned by main verbatim", () => {
    const source = read("PluginWebSurfaceHost.tsx")
    expect(source).toContain("prepareWebSurface")
    expect(source).toContain("prepared.partition")
    expect(source).toContain("prepared.url")
    // The renderer must never recompute the partition (main owns the binding hash).
    expect(source).not.toContain("pluginWebPartition(")
    expect(source).not.toContain("persist:mafw-plugin-")
    // Ticket renewal at expiresAt - 30min, then reload.
    expect(source).toContain("pluginWebRefreshDelay")
    expect(source).toContain("scheduleRefresh")
    expect(source).toContain("reload")
    // Failure surface: retry once, then a banner with a manual retry.
    expect(source).toContain("did-fail-load")
    expect(source).toContain("403")
    expect(source).toContain("DockBanner")
  })

  test("the host routes the bridge channel through the pure router", () => {
    const source = read("PluginWebSurfaceHost.tsx")
    expect(source).toContain("createPluginWebBridge")
    expect(source).toContain("PLUGIN_WEB_BRIDGE_CHANNEL")
    expect(source).toContain('"ipc-message"')
    expect(source).toMatch(/bridge\??\.handle\(/)
    // The webview is the sandboxed surface: no node integration, no popups.
    expect(source).toContain("webpreferences")
    expect(source).not.toContain("allowpopups")
    expect(source).not.toContain("nodeintegration")
  })

  test("the preload exposes window.mafwPlugin over sendToHost", () => {
    const source = read("../../../preload/plugin-web.ts")
    expect(source).toContain('exposeInMainWorld("mafwPlugin"')
    expect(source).toContain("sendToHost(")
    expect(source).toContain("PLUGIN_WEB_BRIDGE_CHANNEL")
    expect(source).toContain("PLUGIN_WEB_BRIDGE_VERSION")
    // Event dispatch must go through the shared hub (requested key + normalized
    // type); a local exact-type map silently killed the `onEvent("deploy")`
    // shorthand on the wire.
    expect(source).toContain("createPluginWebEventHub")
    expect(source).toContain("events.dispatch(frame)")
    expect(source).not.toContain("eventSubscribers")
    for (const method of [
      "context",
      "invoke",
      "onEvent",
      "setBadge",
      "setTitle",
      "openExternal",
      "onThemeChange",
      "onContextChange",
    ]) {
      expect(source).toContain(`${method}:`)
    }
  })
})
