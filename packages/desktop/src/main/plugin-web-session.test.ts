// packages/desktop/src/main/plugin-web-session.test.ts
// Plugin web surfaces: sandboxed per-package partitions, path-scoped ticket
// cookies and the `will-attach-webview` hardening. Electron is injected so
// every decision is testable without booting the app (spec 2026-11-09 §5.5/§6.2).
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  PLUGIN_WEB_PARTITION_PREFIX,
  PLUGIN_WEB_TICKET_COOKIE,
  applyPluginWebSessionPolicy,
  applyPluginWebviewAttachPolicy,
  configurePluginWebSession,
  createPluginWebSessionPreparer,
  pluginWebAttachDecision,
  pluginWebCookiePath,
  pluginWebPartition,
  pluginWebPartitionPackage,
  pluginWebPreloadPath,
  pluginWebRequestAllowed,
  pluginWebUrl,
} from "./plugin-web-session"

const read = (rel: string) => readFileSync(join(import.meta.dirname, "..", rel), "utf8")
const GATEWAY = "http://127.0.0.1:3000"

// ── fakes (no electron import in this process) ──

type FakeSession = {
  permissionRequest?: (wc: unknown, permission: string, cb: (granted: boolean) => void) => void
  permissionCheck?: (wc: unknown, permission: string, origin: string) => boolean
  beforeRequest?: (details: { url: string }, cb: (res: { cancel: boolean }) => void) => void
  filters: Array<{ urls: string[] }>
  cookieWrites: any[]
  cookies: { set(details: any): Promise<void> }
  setPermissionRequestHandler(fn: FakeSession["permissionRequest"]): void
  setPermissionCheckHandler(fn: FakeSession["permissionCheck"]): void
  webRequest: {
    onBeforeRequest(filter: { urls: string[] }, listener: FakeSession["beforeRequest"]): void
  }
}

function fakeSession(): FakeSession {
  const ses: FakeSession = {
    filters: [],
    cookieWrites: [],
    cookies: {
      set: async (details: any) => {
        ses.cookieWrites.push(details)
      },
    },
    setPermissionRequestHandler(fn) {
      ses.permissionRequest = fn
    },
    setPermissionCheckHandler(fn) {
      ses.permissionCheck = fn
    },
    webRequest: {
      onBeforeRequest(filter, listener) {
        ses.filters.push(filter)
        ses.beforeRequest = listener
      },
    },
  }
  return ses
}

type FakeHost = {
  listeners: Array<(event: any, prefs: any, params: any) => void>
  on(event: string, listener: any): void
  attach(params: { partition?: string; src?: string }): { prevented: boolean; prefs: Record<string, unknown> }
}

function fakeHost(): FakeHost {
  const host: FakeHost = {
    listeners: [],
    on(event, listener) {
      if (event === "will-attach-webview") host.listeners.push(listener)
    },
    attach(params) {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true
        },
      }
      const prefs: Record<string, unknown> = {}
      for (const listener of host.listeners) listener(event, prefs, params)
      return { prevented: event.prevented, prefs }
    },
  }
  return host
}

function decideRequest(ses: FakeSession, url: string): { cancel: boolean } {
  let out: { cancel: boolean } | undefined
  ses.beforeRequest!({ url }, (res) => {
    out = res
  })
  return out!
}

// ── pure helpers ──

describe("pluginWebPartition", () => {
  test("partition is per package", () => {
    assert.equal(pluginWebPartition("demo"), "persist:mafw-plugin-demo")
    assert.equal(PLUGIN_WEB_PARTITION_PREFIX, "persist:mafw-plugin-")
    assert.notEqual(pluginWebPartition("demo"), pluginWebPartition("other"))
  })

  test("partition → package is the inverse; foreign partitions are not ours", () => {
    assert.equal(pluginWebPartitionPackage(pluginWebPartition("demo")), "demo")
    assert.equal(pluginWebPartitionPackage("persist:mafw-plugin-demo-2"), "demo-2")
    assert.equal(pluginWebPartitionPackage("persist:workbench-browser"), null)
    assert.equal(pluginWebPartitionPackage("persist:mafw-plugin-"), null)
    assert.equal(pluginWebPartitionPackage(undefined), null)
  })
})

describe("pluginWebUrl", () => {
  test("keeps the package namespace and revision", () => {
    assert.equal(
      pluginWebUrl("http://127.0.0.1:3000", "demo", "app/index.html", "b1:2"),
      "http://127.0.0.1:3000/api/plugins/demo/ui/app/index.html?revision=b1%3A2",
    )
  })

  test("defaults the entry, strips leading slashes and encodes segments", () => {
    assert.equal(pluginWebUrl(GATEWAY, "demo"), `${GATEWAY}/api/plugins/demo/ui/index.html`)
    assert.equal(pluginWebUrl(GATEWAY, "demo", ""), `${GATEWAY}/api/plugins/demo/ui/index.html`)
    assert.equal(pluginWebUrl(GATEWAY, "demo", "/app/index.html"), `${GATEWAY}/api/plugins/demo/ui/app/index.html`)
    assert.equal(pluginWebUrl(GATEWAY, "demo", "a b/index.html"), `${GATEWAY}/api/plugins/demo/ui/a%20b/index.html`)
    // trailing slash on the gateway base must not double up
    assert.equal(pluginWebUrl(`${GATEWAY}/`, "demo", "x.html"), `${GATEWAY}/api/plugins/demo/ui/x.html`)
  })

  test("never leaks dot segments outside the package ui/ tree", () => {
    assert.equal(pluginWebUrl(GATEWAY, "demo", "../evil.html"), `${GATEWAY}/api/plugins/demo/ui/evil.html`)
    assert.equal(pluginWebUrl(GATEWAY, "demo", "a/../../b.html"), `${GATEWAY}/api/plugins/demo/ui/a/b.html`)
    assert.equal(pluginWebUrl(GATEWAY, "demo", "./"), `${GATEWAY}/api/plugins/demo/ui/index.html`)
  })
})

describe("pluginWebPreloadPath", () => {
  test("points at the emitted preload bundle next to main/", () => {
    const normalized = pluginWebPreloadPath(join("C:", "app", "out", "main")).replace(/\\/g, "/")
    assert.equal(normalized, "C:/app/out/preload/plugin-web.js")
    assert.match(pluginWebPreloadPath().replace(/\\/g, "/"), /\/preload\/plugin-web\.js$/)
  })
})

describe("pluginWebCookiePath", () => {
  test("is scoped to the package namespace", () => {
    assert.equal(pluginWebCookiePath("demo"), "/api/plugins/demo/")
    assert.equal(PLUGIN_WEB_TICKET_COOKIE, "mafw_plugin_ticket")
  })
})

describe("pluginWebRequestAllowed", () => {
  const isAllowed = (url: string) => pluginWebRequestAllowed(GATEWAY, "demo", url)

  test("allows the own-package namespace (documents, ctx.http routes, events, ws)", () => {
    assert.equal(isAllowed(`${GATEWAY}/api/plugins/demo/ui/index.html?revision=b1%3A2`), true)
    assert.equal(isAllowed(`${GATEWAY}/api/plugins/demo/ui/app/app.js`), true)
    assert.equal(isAllowed(`${GATEWAY}/api/plugins/demo/api/files?path=.`), true)
    assert.equal(isAllowed(`${GATEWAY}/api/plugins/demo/events?sessionID=s1`), true)
    assert.equal(isAllowed("ws://127.0.0.1:3000/api/plugins/demo/ws/term"), true)
  })

  test("rejects every other package and every gateway-global API", () => {
    assert.equal(isAllowed(`${GATEWAY}/api/plugins/other/ui/index.html`), false)
    assert.equal(isAllowed(`${GATEWAY}/api/plugins/demo2/ui/index.html`), false)
    assert.equal(isAllowed(`${GATEWAY}/api/sessions`), false)
    assert.equal(isAllowed(`${GATEWAY}/health`), false)
    assert.equal(isAllowed(`${GATEWAY}/api/plugins`), false)
  })

  test("rejects other origins and non-http schemes", () => {
    assert.equal(isAllowed("http://evil.test/api/plugins/demo/ui/index.html"), false)
    assert.equal(isAllowed("http://127.0.0.1:3999/api/plugins/demo/ui/index.html"), false)
    assert.equal(isAllowed("https://127.0.0.1:3000/api/plugins/demo/ui/index.html"), false)
    assert.equal(isAllowed("file:///C:/x/api/plugins/demo/ui/index.html"), false)
    assert.equal(isAllowed("data:text/html,hello"), false)
    assert.equal(isAllowed("not a url"), false)
  })
})

describe("applyPluginWebSessionPolicy", () => {
  test("denies permissions and filters every request through the package namespace", () => {
    const ses = fakeSession()
    applyPluginWebSessionPolicy(ses, () => GATEWAY, "demo")

    let granted: boolean | undefined
    ses.permissionRequest!({}, "media", (value) => {
      granted = value
    })
    assert.equal(granted, false)
    assert.equal(ses.permissionCheck!({}, "media", GATEWAY), false)
    assert.equal(ses.permissionCheck!({}, "notifications", GATEWAY), false)

    assert.deepEqual(ses.filters, [{ urls: ["*://*/*"] }])
    assert.deepEqual(decideRequest(ses, `${GATEWAY}/api/plugins/demo/ui/index.html`), { cancel: false })
    assert.deepEqual(decideRequest(ses, `${GATEWAY}/api/plugins/other/ui/index.html`), { cancel: true })
    assert.deepEqual(decideRequest(ses, `${GATEWAY}/api/sessions`), { cancel: true })
    assert.deepEqual(decideRequest(ses, "http://evil.test/api/plugins/demo/ui/index.html"), { cancel: true })
  })

  test("reads the gateway URL lazily (port changes after a gateway restart)", () => {
    const ses = fakeSession()
    let base = "http://127.0.0.1:3000"
    applyPluginWebSessionPolicy(ses, () => base, "demo")
    assert.deepEqual(decideRequest(ses, "http://127.0.0.1:3000/api/plugins/demo/ui/index.html"), { cancel: false })

    base = "http://127.0.0.1:3100"
    assert.deepEqual(decideRequest(ses, "http://127.0.0.1:3100/api/plugins/demo/ui/index.html"), { cancel: false })
    assert.deepEqual(decideRequest(ses, "http://127.0.0.1:3000/api/plugins/demo/ui/index.html"), { cancel: true })
  })
})

describe("pluginWebAttachDecision", () => {
  test("accepts own-package webviews only", () => {
    const ok = pluginWebAttachDecision(GATEWAY, pluginWebPartition("demo"), `${GATEWAY}/api/plugins/demo/ui/index.html`)
    assert.deepEqual(ok, { ok: true, pkg: "demo" })
    assert.deepEqual(pluginWebAttachDecision(GATEWAY, pluginWebPartition("demo"), "about:blank"), { ok: true, pkg: "demo" })

    assert.equal(
      pluginWebAttachDecision(GATEWAY, pluginWebPartition("demo"), `${GATEWAY}/api/plugins/other/ui/index.html`).ok,
      false,
    )
    assert.equal(
      pluginWebAttachDecision(GATEWAY, pluginWebPartition("demo"), "http://evil.test/api/plugins/demo/ui/index.html").ok,
      false,
    )
    assert.equal(
      pluginWebAttachDecision(GATEWAY, "persist:workbench-browser", `${GATEWAY}/api/plugins/demo/ui/index.html`).ok,
      false,
    )
  })
})

describe("applyPluginWebviewAttachPolicy", () => {
  test("forces the bridge preload and strips node integration", () => {
    const host = fakeHost()
    const preload = "/app/out/preload/plugin-web.js"
    applyPluginWebviewAttachPolicy(host, () => GATEWAY, preload)

    const { prevented, prefs } = host.attach({
      partition: pluginWebPartition("demo"),
      src: `${GATEWAY}/api/plugins/demo/ui/index.html?revision=b1%3A2`,
    })
    assert.equal(prevented, false)
    assert.equal(prefs.preload, preload)
    assert.equal(prefs.nodeIntegration, false)
    assert.equal(prefs.contextIsolation, true)
    assert.equal(prefs.sandbox, true)
    assert.equal(prefs.webSecurity, true)
    assert.equal(prefs.webviewTag, false)
  })

  test("blocks cross-package srcs but leaves other partitions to the browser handler", () => {
    const host = fakeHost()
    applyPluginWebviewAttachPolicy(host, () => GATEWAY, "/app/out/preload/plugin-web.js")

    const denied = host.attach({
      partition: pluginWebPartition("demo"),
      src: `${GATEWAY}/api/plugins/other/ui/index.html`,
    })
    assert.equal(denied.prevented, true)
    assert.equal(denied.prefs.preload, undefined)

    const browser = host.attach({
      partition: "persist:workbench-browser",
      src: "https://example.com/",
    })
    assert.equal(browser.prevented, false)
    assert.equal(browser.prefs.preload, undefined)
  })
})

describe("configurePluginWebSession", () => {
  const makeDeps = () => {
    const sessions = new Map<string, FakeSession>()
    const hosts = [fakeHost()]
    const created: Array<(host: FakeHost) => void> = []
    const deps = {
      gatewayUrl: () => GATEWAY,
      fromPartition: (partition: string) => {
        if (!sessions.has(partition)) sessions.set(partition, fakeSession())
        return sessions.get(partition)!
      },
      hosts: () => hosts,
      onHostCreated: (listener: (host: FakeHost) => void) => {
        created.push(listener)
      },
      preloadPath: "/app/out/preload/plugin-web.js",
    }
    return { deps, sessions, hosts, created }
  }

  test("configures the partition session and every host exactly once", () => {
    const { deps, sessions, hosts, created } = makeDeps()
    const first = configurePluginWebSession("demo", deps as any)
    const second = configurePluginWebSession("demo", deps as any)

    assert.equal(first, second)
    assert.equal(sessions.size, 1)
    assert.ok(sessions.has(pluginWebPartition("demo")))
    assert.equal(sessions.get(pluginWebPartition("demo"))!.filters.length, 1)
    assert.equal(hosts[0].listeners.length, 1)
    assert.equal(created.length, 1)

    const later = fakeHost()
    created[0](later)
    assert.equal(later.listeners.length, 1)
  })

  test("is idempotent per host across different packages", () => {
    const { deps, hosts, created } = makeDeps()
    configurePluginWebSession("demo", deps as any)
    configurePluginWebSession("other", deps as any)
    assert.equal(hosts[0].listeners.length, 1)
    assert.equal(created.length, 1)
  })
})

describe("createPluginWebSessionPreparer", () => {
  const makePreparer = (
    over: Partial<{
      issueTicket: (name: string, input: { projectDir: string; sessionID?: string }) => Promise<{ ticket: string; expiresAt: number }>
    }> = {},
  ) => {
    const sessions = new Map<string, FakeSession>()
    const hosts = [fakeHost()]
    const issued: Array<{ name: string; input: { projectDir: string; sessionID?: string } }> = []
    const preparer = createPluginWebSessionPreparer({
      gatewayUrl: () => GATEWAY,
      issueTicket: async (name, input) => {
        issued.push({ name, input })
        if (over.issueTicket) return over.issueTicket(name, input)
        return { ticket: "tkt-1", expiresAt: 1_900_000_000_123 }
      },
      fromPartition: (partition) => {
        if (!sessions.has(partition)) sessions.set(partition, fakeSession())
        return sessions.get(partition)!
      },
      hosts: () => hosts,
      onHostCreated: () => {},
      preloadPath: "/app/out/preload/plugin-web.js",
    })
    return { preparer, sessions, hosts, issued }
  }

  test("issues a ticket, installs the path-scoped cookie and returns the surface url", async () => {
    const { preparer, sessions, issued } = makePreparer()
    const result = await preparer.prepare({
      name: "demo",
      projectDir: "C:\\work\\demo",
      sessionID: "s1",
      entry: "app/index.html",
      revision: "b1:2",
    })

    assert.deepEqual(issued, [{ name: "demo", input: { projectDir: "C:\\work\\demo", sessionID: "s1" } }])
    assert.deepEqual(result, {
      partition: pluginWebPartition("demo"),
      url: `${GATEWAY}/api/plugins/demo/ui/app/index.html?revision=b1%3A2`,
      expiresAt: 1_900_000_000_123,
    })

    const ses = sessions.get(pluginWebPartition("demo"))!
    assert.equal(ses.cookieWrites.length, 1)
    assert.deepEqual(ses.cookieWrites[0], {
      url: GATEWAY,
      name: PLUGIN_WEB_TICKET_COOKIE,
      value: "tkt-1",
      path: "/api/plugins/demo/",
      httpOnly: true,
      sameSite: "strict",
      expirationDate: Math.floor(1_900_000_000_123 / 1000),
    })
    assert.equal(preparer.expiresAtFor("demo"), 1_900_000_000_123)
  })

  test("refreshing replaces the cookie in the same partition and keeps the newest expiry", async () => {
    let n = 0
    const { preparer, sessions } = makePreparer({
      issueTicket: async () => ({ ticket: `tkt-${++n}`, expiresAt: 1_900_000_000_000 + n * 1000 }),
    })
    await preparer.prepare({ name: "demo", projectDir: "C:\\work\\demo" })
    await preparer.prepare({ name: "demo", projectDir: "C:\\work\\demo" })

    const ses = sessions.get(pluginWebPartition("demo"))!
    assert.equal(sessions.size, 1)
    assert.deepEqual(
      ses.cookieWrites.map((c) => c.value),
      ["tkt-1", "tkt-2"],
    )
    assert.equal(preparer.expiresAtFor("demo"), 1_900_000_002_000)
  })

  test("omits sessionID when absent and defaults the entry", async () => {
    const { preparer, issued } = makePreparer()
    const result = await preparer.prepare({ name: "demo", projectDir: "C:\\work\\demo" })
    assert.deepEqual(issued[0].input, { projectDir: "C:\\work\\demo" })
    assert.equal(result.url, `${GATEWAY}/api/plugins/demo/ui/index.html`)
  })

  test("rejects invalid package names and empty project dirs before touching the gateway", async () => {
    const { preparer, issued } = makePreparer()
    await assert.rejects(() => preparer.prepare({ name: "../evil", projectDir: "C:\\work\\demo" }), /package name/)
    await assert.rejects(() => preparer.prepare({ name: "a/b", projectDir: "C:\\work\\demo" }), /package name/)
    await assert.rejects(() => preparer.prepare({ name: "", projectDir: "C:\\work\\demo" }), /package name/)
    await assert.rejects(() => preparer.prepare({ name: "demo", projectDir: "  " }), /projectDir/)
    assert.deepEqual(issued, [])
  })

  test("a gateway ticket failure propagates and leaves no cookie behind", async () => {
    const { preparer, sessions } = makePreparer({
      issueTicket: async () => {
        throw new Error("404 not found")
      },
    })
    await assert.rejects(
      () => preparer.prepare({ name: "demo", projectDir: "C:\\work\\demo" }),
      /404 not found/,
    )
    assert.equal(sessions.get(pluginWebPartition("demo"))?.cookieWrites.length ?? 0, 0)
  })
})

// ── wiring contract (renderer/preload/main/build stay connected) ──

describe("wiring contract", () => {
  test("main registers the IPC handler through the preparer", () => {
    const src = read("main/mafw-ipc.ts")
    assert.match(src, /mafw-plugin-web-session/)
    assert.match(src, /createPluginWebSessionPreparer\(/)
    assert.match(src, /plugins\.webTicket\(/)
  })

  test("preload exposes prepareWebSurface", () => {
    assert.match(read("preload/mafw-api.ts"), /prepareWebSurface:.*mafw-plugin-web-session/s)
    assert.match(read("preload/mafw-types.ts"), /prepareWebSurface\(/)
  })

  test("the plugin webview preload is a real build entry", () => {
    const config = read("../electron.vite.config.ts")
    assert.match(config, /"plugin-web":\s*"src\/preload\/plugin-web\.ts"/)
    assert.ok(existsSync(join(import.meta.dirname, "..", "preload/plugin-web.ts")))
  })

  test("the browser webview handler leaves plugin partitions to this module", () => {
    assert.match(read("main/browser-session.ts"), /pluginWebPartitionPackage\(/)
  })
})
