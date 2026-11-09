// Task 8: host-side bridge router for sandboxed plugin pages.
//
// The router is pure: it validates the page's message, enforces the package
// boundary, delegates to injected host callbacks and never touches Electron or
// Solid directly. The `<webview>` plumbing lives in `PluginWebSurfaceHost.tsx`
// and the page half in `src/preload/plugin-web.ts`.
import { describe, expect, test } from "bun:test"
import {
  PLUGIN_WEB_BRIDGE_CHANNEL,
  PLUGIN_WEB_BRIDGE_METHODS,
  PLUGIN_WEB_BRIDGE_VERSION,
} from "../../../shared/plugin-web-bridge"
import {
  createPluginWebBridge,
  sanitizePluginExternalUrl,
  type PluginWebBridgeDeps,
  type PluginWebBridgePush,
  type PluginWebTheme,
} from "./plugin-web-bridge"

interface Harness {
  bridge: ReturnType<typeof createPluginWebBridge>
  invokes: Array<[string, string, unknown]> | null
  pushes: PluginWebBridgePush[]
  badges: number[]
  titles: string[]
  external: string[]
  errors: string[]
  emitEvent: (type: string, payload: unknown) => void
  emitTheme: (theme: PluginWebTheme) => void
  emitContext: (context: { projectDir: string; sessionID?: string }) => void
  disposed: string[]
}

function harness(overrides: Partial<PluginWebBridgeDeps> = {}): Harness {
  const invokes: Harness["invokes"] = []
  const pushes: PluginWebBridgePush[] = []
  const badges: number[] = []
  const titles: string[] = []
  const external: string[] = []
  const errors: string[] = []
  const disposed: string[] = []
  let eventListener: ((payload: unknown) => void) | null = null
  let themeListener: ((theme: PluginWebTheme) => void) | null = null
  let contextListener: ((context: { projectDir: string; sessionID?: string }) => void) | null = null

  const deps: PluginWebBridgeDeps = {
    pkg: "demo",
    surface: "plugin:demo:db",
    context: () => ({ projectDir: "/repo", sessionID: "s1", theme: "dark" }),
    invoke: async (pkg, action, input) => {
      invokes!.push([pkg, action, input])
      return { ok: true }
    },
    setBadge: (count) => badges.push(count),
    setTitle: (title) => titles.push(title),
    openExternal: (url) => external.push(url),
    subscribeEvent: (type, listener) => {
      expect(type).toBe("plugin:demo:deploy")
      eventListener = listener
      return () => disposed.push(`event:${type}`)
    },
    subscribeTheme: (listener) => {
      themeListener = listener
      return () => disposed.push("theme")
    },
    subscribeContext: (listener) => {
      contextListener = listener
      return () => disposed.push("context")
    },
    send: (push) => pushes.push(push),
    onError: (message) => errors.push(message),
    ...overrides,
  }

  return {
    bridge: createPluginWebBridge(deps),
    invokes,
    pushes,
    badges,
    titles,
    external,
    errors,
    emitEvent: (_type, payload) => eventListener?.(payload),
    emitTheme: (theme) => themeListener?.(theme),
    emitContext: (context) => contextListener?.(context),
    disposed,
  }
}

describe("plugin web bridge contract", () => {
  test("shares one channel, version and method list with the preload", () => {
    expect(PLUGIN_WEB_BRIDGE_CHANNEL).toBe("mafw-plugin-bridge")
    expect(PLUGIN_WEB_BRIDGE_VERSION).toBe(1)
    expect([...PLUGIN_WEB_BRIDGE_METHODS]).toEqual([
      "context",
      "invoke",
      "onEvent",
      "setBadge",
      "setTitle",
      "openExternal",
      "onThemeChange",
      "onContextChange",
    ])
  })
})

describe("createPluginWebBridge", () => {
  test("context answers with the surface binding and the live theme", async () => {
    const h = harness()
    const reply = await h.bridge.handle({ id: 1, method: "context" })
    expect(reply).toEqual({
      id: 1,
      ok: true,
      result: { projectDir: "/repo", sessionID: "s1", surface: "plugin:demo:db", theme: "dark" },
    })
  })

  test("unknown methods are rejected and reported to the host", async () => {
    const h = harness()
    await expect(h.bridge.handle({ id: 2, method: "eval" })).rejects.toThrow(/eval/)
    await expect(h.bridge.handle({ id: 3, method: "require" })).rejects.toThrow(/require/)
    expect(h.errors).toEqual([
      "unknown plugin bridge method: eval",
      "unknown plugin bridge method: require",
    ])
  })

  test("invoke is scoped to the bridge package and ignores page-supplied package names", async () => {
    const h = harness()
    const reply = await h.bridge.handle({
      id: 4,
      method: "invoke",
      params: { pkg: "other", action: "deploy", input: { env: "dev" } },
    })
    expect(reply).toEqual({ id: 4, ok: true, result: { ok: true } })
    expect(h.invokes).toEqual([["demo", "deploy", { env: "dev" }]])
  })

  test("invoke failures become error replies instead of host crashes", async () => {
    const h = harness({
      invoke: async () => {
        throw new Error("action exploded")
      },
    })
    const reply = await h.bridge.handle({ id: 5, method: "invoke", params: { action: "deploy" } })
    expect(reply).toEqual({ id: 5, ok: false, error: "action exploded" })
    // action failures are the page's business — no error banner for them
    expect(h.errors).toEqual([])
  })

  test("invoke rejects missing/oversized actions before calling the gateway", async () => {
    const h = harness()
    await expect(h.bridge.handle({ id: 6, method: "invoke", params: { action: "" } })).rejects.toThrow(/action/)
    await expect(h.bridge.handle({ id: 7, method: "invoke", params: {} })).rejects.toThrow(/action/)
    await expect(
      h.bridge.handle({ id: 8, method: "invoke", params: { action: "x".repeat(201) } }),
    ).rejects.toThrow(/action/)
    expect(h.invokes).toEqual([])
  })

  test("onEvent prefixes the package and forwards matching pushes", async () => {
    const h = harness()
    const reply = await h.bridge.handle({ id: 9, method: "onEvent", params: { type: "deploy" } })
    expect(reply).toEqual({ id: 9, ok: true, result: { type: "plugin:demo:deploy" } })

    h.emitEvent("plugin:demo:deploy", { state: "ok" })
    expect(h.pushes).toEqual([
      { kind: "event", type: "plugin:demo:deploy", payload: { state: "ok" } },
    ])
  })

  test("onEvent refuses event types outside the package", async () => {
    const h = harness()
    await expect(
      h.bridge.handle({ id: 10, method: "onEvent", params: { type: "plugin:other:deploy" } }),
    ).rejects.toThrow(/outside package/)
    expect(h.errors).toEqual(["event type outside package: plugin:other:deploy"])
  })

  test("emit is also package-scoped (no cross-package pushes)", () => {
    const h = harness()
    expect(h.bridge.emit({ kind: "event", type: "plugin:demo:deploy", payload: null })).toBe(true)
    expect(h.bridge.emit({ kind: "event", type: "plugin:other:deploy", payload: null })).toBe(false)
    expect(h.bridge.emit({ kind: "theme", theme: "light" })).toBe(true)
    expect(h.bridge.emit({ kind: "theme", theme: "sepia" as PluginWebTheme })).toBe(false)
    expect(h.pushes.map((push) => push.kind)).toEqual(["event", "theme"])
  })

  test("setBadge clamps counts and setTitle trims/caps the title", async () => {
    const h = harness()
    expect(await h.bridge.handle({ id: 11, method: "setBadge", params: { count: 7.9 } })).toEqual({
      id: 11,
      ok: true,
      result: { count: 7 },
    })
    await h.bridge.handle({ id: 12, method: "setBadge", params: { count: -3 } })
    await h.bridge.handle({ id: 13, method: "setBadge", params: { count: 99_999 } })
    expect(h.badges).toEqual([7, 0, 9999])

    await h.bridge.handle({ id: 14, method: "setTitle", params: { title: "  Deploy  " } })
    await h.bridge.handle({ id: 15, method: "setTitle", params: { title: "x".repeat(400) } })
    expect(h.titles).toEqual(["Deploy", "x".repeat(200)])
  })

  test("openExternal only accepts http(s)/mailto/tel and rejects script/file/data", async () => {
    const h = harness()
    expect(await h.bridge.handle({ id: 16, method: "openExternal", params: { url: "https://x.test/a" } })).toEqual({
      id: 16,
      ok: true,
      result: { url: "https://x.test/a" },
    })
    await h.bridge.handle({ id: 17, method: "openExternal", params: { url: "mailto:a@b.test" } })

    for (const [index, url] of [
      "javascript:alert(1)",
      "file:///C:/secret",
      "data:text/html,hello",
      "vbscript:msgbox(1)",
      "",
      "not a url",
    ].entries()) {
      const reply = await h.bridge.handle({ id: 100 + index, method: "openExternal", params: { url } })
      expect(reply.ok).toBe(false)
      expect(String(reply.error)).toContain("not allowed")
    }
    expect(h.external).toEqual(["https://x.test/a", "mailto:a@b.test"])
  })

  test("theme and context subscriptions forward host pushes", async () => {
    const h = harness()
    await h.bridge.handle({ id: 18, method: "onThemeChange" })
    await h.bridge.handle({ id: 19, method: "onContextChange" })

    h.emitTheme("light")
    h.emitContext({ projectDir: "/repo", sessionID: "s2" })

    expect(h.pushes).toEqual([
      { kind: "theme", theme: "light" },
      { kind: "context", context: { projectDir: "/repo", sessionID: "s2" } },
    ])
  })

  test("malformed frames are rejected instead of silently ignored", async () => {
    const h = harness()
    await expect(h.bridge.handle(null)).rejects.toThrow(/message/)
    await expect(h.bridge.handle([])).rejects.toThrow(/message/)
    await expect(h.bridge.handle("context")).rejects.toThrow(/message/)
    await expect(h.bridge.handle({ id: 20 })).rejects.toThrow(/method/)
    await expect(h.bridge.handle({ id: 21, method: 42 })).rejects.toThrow(/method/)
    expect(h.errors.length).toBe(5)
  })

  test("dispose unsubscribes every page subscription", async () => {
    const h = harness()
    await h.bridge.handle({ id: 22, method: "onEvent", params: { type: "deploy" } })
    await h.bridge.handle({ id: 23, method: "onThemeChange" })
    await h.bridge.handle({ id: 24, method: "onContextChange" })
    h.bridge.dispose()
    expect(h.disposed).toEqual(["event:plugin:demo:deploy", "theme", "context"])
    // a second dispose is a no-op
    h.bridge.dispose()
    expect(h.disposed.length).toBe(3)
  })
})

describe("sanitizePluginExternalUrl", () => {
  test("keeps http(s), mailto and tel; trims whitespace", () => {
    expect(sanitizePluginExternalUrl(" https://mafw.test/x ")).toBe("https://mafw.test/x")
    expect(sanitizePluginExternalUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000/")
    expect(sanitizePluginExternalUrl("mailto:team@mafw.test")).toBe("mailto:team@mafw.test")
    expect(sanitizePluginExternalUrl("tel:+123")).toBe("tel:+123")
  })

  test("rejects everything else including non-strings and oversized urls", () => {
    for (const value of [
      undefined,
      null,
      42,
      {},
      "",
      "   ",
      "javascript:alert(1)",
      "file:///C:/x",
      "data:text/html,<script>",
      "chrome://settings",
      "about:blank",
      "https://x.test/" + "a".repeat(4000),
    ]) {
      expect(sanitizePluginExternalUrl(value)).toBeNull()
    }
  })
})
