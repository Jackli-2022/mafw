// Task 9: rail / workbench wiring for sandboxed plugin Web surfaces.
//
// Two layers are pinned here:
//
// - **models** — the L2 tab projection (`webSurfaceTabs`) and the runtime
//   badge/title state the page writes through the bridge. Both are pure, so a
//   headless test can prove ordering, label fallback and prune semantics.
// - **wires** — the shell components. A missing prop is invisible at runtime:
//   a persisted `plugin:<pkg>:<surface>` simply falls back to `code` after a
//   reload, and the rail entry silently disappears. Source pins are the only
//   cheap regression net for that class of bug (same idiom as
//   `revert-undo-capability.test.ts`).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as contractModule from "@mafw/plugin-contract"
import type { PluginClientDescriptor } from "@mafw/plugin-contract"
import {
  railItemsFromWebSurfaces,
  webSurfaceTabs,
  webSurfaceViews,
  type PluginRailItem,
  type PluginWebSurfaceView,
} from "./plugins/plugin-web-surface"
import {
  EMPTY_PLUGIN_SURFACE_RUNTIME,
  applyPluginRailState,
  applyPluginSurfaceBadge,
  applyPluginSurfaceTitle,
  applyPluginTabTitles,
  pluginSurfaceBadge,
  pluginSurfaceTitle,
  prunePluginSurfaceRuntime,
} from "./plugins/plugin-surface-state"
import { parsePluginSurfaceId } from "./workbench-views"

// `@mafw/plugin-contract` is CommonJS in Node tests; read through the synthetic
// default when present (same interop shim as `plugin-view-model.ts`).
const contract =
  (contractModule as unknown as { default?: typeof contractModule }).default ?? contractModule
const PLUGIN_ICON_NAMES = contract.PLUGIN_ICON_NAMES as readonly string[]

const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), "utf8")

/** Descriptor fixture; surfaces are deliberately loose (declared, not projected). */
const descriptor = (
  name: string,
  surfaces: unknown[] | undefined,
  revision = "boot-a:1",
): PluginClientDescriptor =>
  ({
    name,
    version: "1.0.0",
    revision,
    ui: surfaces === undefined ? {} : { webSurfaces: surfaces },
    actions: [],
    events: [],
  }) as unknown as PluginClientDescriptor

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

describe("webSurfaceTabs", () => {
  test("projects every web surface as an L2 tab in rail order", () => {
    const plugins = [
      descriptor("demo", [
        { id: "logs", title: "Logs", rail: { icon: "terminal", order: 20 } },
        { id: "db", title: "DB", rail: { icon: "layout-grid", order: 10 } },
      ]),
    ]
    const tabs = webSurfaceTabs(webSurfaceViews(plugins), plugins)
    // Rail order (order asc), not declaration order: the strip and the rail agree.
    expect(tabs.map((tab) => tab.id)).toEqual(["plugin:demo:db", "plugin:demo:logs"])
    expect(tabs.map((tab) => tab.label)).toEqual(["DB", "Logs"])
    expect(tabs[0]?.descriptor.name).toBe("demo")
    expect(tabs[0]?.view.surfaceId).toBe("plugin:demo:db")
  })

  test("keeps a surface without a rail (tab-only) and skips an unknown package", () => {
    const plugins = [descriptor("demo", [{ id: "hidden", title: "Hidden" }])]
    const views = [
      ...webSurfaceViews(plugins),
      view({ packageName: "gone", surfaceId: "plugin:gone:db", id: "db" }),
    ]
    expect(webSurfaceTabs(views, plugins).map((tab) => tab.id)).toEqual(["plugin:demo:hidden"])
    expect(webSurfaceTabs(views, [])).toEqual([])
  })

  test("tab ids round-trip through the persisted plugin surface parser", () => {
    const plugins = [descriptor("demo", [{ id: "db", title: "DB" }])]
    const tabs = webSurfaceTabs(webSurfaceViews(plugins), plugins)
    // `resolveActiveSurface` + `mafw-workbench-surface` compare raw strings, so a
    // tab id has to be exactly what the persistence layer parses back.
    expect(tabs.map((tab) => parsePluginSurfaceId(tab.id))).toEqual([
      { package: "demo", panel: "db" },
    ])
  })
})

describe("plugin surface runtime state", () => {
  const id = "plugin:demo:db"

  test("badge: set, clamp, floor and clear", () => {
    const withBadge = applyPluginSurfaceBadge(EMPTY_PLUGIN_SURFACE_RUNTIME, id, 3)
    expect(pluginSurfaceBadge(withBadge, id)).toBe(3)
    expect(pluginSurfaceBadge(withBadge, "plugin:demo:other")).toBe(0)
    // Same count → same object (no signal churn on a repeated setBadge).
    expect(applyPluginSurfaceBadge(withBadge, id, 3)).toBe(withBadge)
    expect(pluginSurfaceBadge(applyPluginSurfaceBadge(withBadge, id, 2.7), id)).toBe(2)
    // Zero / negative / NaN clear the entry instead of rendering "0".
    for (const cleared of [0, -4, Number.NaN]) {
      const next = applyPluginSurfaceBadge(withBadge, id, cleared)
      expect(next.badges[id]).toBeUndefined()
      expect(pluginSurfaceBadge(next, id)).toBe(0)
    }
    // A blank surface id is ignored rather than stored under "".
    expect(applyPluginSurfaceBadge(EMPTY_PLUGIN_SURFACE_RUNTIME, "   ", 2)).toBe(
      EMPTY_PLUGIN_SURFACE_RUNTIME,
    )
  })

  test("title: trimmed override, cleared by an empty string, fallback otherwise", () => {
    const titled = applyPluginSurfaceTitle(EMPTY_PLUGIN_SURFACE_RUNTIME, id, "  Live DB  ")
    expect(pluginSurfaceTitle(titled, id, "DB")).toBe("Live DB")
    expect(pluginSurfaceTitle(titled, "plugin:demo:other", "DB")).toBe("DB")
    expect(applyPluginSurfaceTitle(titled, id, "  ").titles[id]).toBeUndefined()
    expect(pluginSurfaceTitle(applyPluginSurfaceTitle(titled, id, ""), id, "DB")).toBe("DB")
    expect(applyPluginSurfaceTitle(titled, id, "Live DB")).toBe(titled)
  })

  test("prune drops state for surfaces the revision removed and is a no-op otherwise", () => {
    const state = applyPluginSurfaceTitle(
      applyPluginSurfaceBadge(EMPTY_PLUGIN_SURFACE_RUNTIME, id, 4),
      id,
      "Live DB",
    )
    expect(prunePluginSurfaceRuntime(state, [id])).toBe(state)
    expect(prunePluginSurfaceRuntime(state, ["plugin:demo:other"])).toEqual(
      EMPTY_PLUGIN_SURFACE_RUNTIME,
    )
    expect(prunePluginSurfaceRuntime(EMPTY_PLUGIN_SURFACE_RUNTIME, [])).toBe(
      EMPTY_PLUGIN_SURFACE_RUNTIME,
    )
  })
})

describe("rail / tab label merge", () => {
  const items: PluginRailItem[] = [
    { surfaceId: "plugin:demo:db", packageName: "demo", label: "DB", icon: "layout-grid", order: 10, badge: true },
    { surfaceId: "plugin:demo:logs", packageName: "demo", label: "Logs", icon: "terminal", order: 20, badge: false },
  ]

  test("applies the page title and only counts surfaces that declared a badge", () => {
    const state = applyPluginSurfaceTitle(
      applyPluginSurfaceBadge(EMPTY_PLUGIN_SURFACE_RUNTIME, "plugin:demo:db", 7),
      "plugin:demo:db",
      "Live DB",
    )
    const merged = applyPluginRailState(items, state)
    expect(merged.map((item) => item.label)).toEqual(["Live DB", "Logs"])
    expect(merged.map((item) => item.count)).toEqual([7, 0])
    // `badge: false` means "never show a count", even if the page published one.
    const noisy = applyPluginSurfaceBadge(state, "plugin:demo:logs", 5)
    expect(applyPluginRailState(items, noisy).map((item) => item.count)).toEqual([7, 0])
    // No runtime state → the declared projection is returned untouched.
    expect(applyPluginRailState(items, EMPTY_PLUGIN_SURFACE_RUNTIME)).toBe(items)
  })

  test("relabels tab surfaces that the page retitled and leaves the rest alone", () => {
    const tabs = [
      { id: "plugin:demo:db" as const, label: "DB" },
      { id: "plugin:demo:logs" as const, label: "Logs" },
    ]
    expect(
      applyPluginTabTitles(tabs, applyPluginSurfaceTitle(EMPTY_PLUGIN_SURFACE_RUNTIME, "plugin:demo:db", "Live DB")),
    ).toEqual([
      { id: "plugin:demo:db", label: "Live DB" },
      { id: "plugin:demo:logs", label: "Logs" },
    ])
    expect(applyPluginTabTitles(tabs, EMPTY_PLUGIN_SURFACE_RUNTIME)).toBe(tabs)
  })
})

describe("rail sources", () => {
  test("rail items come from the same views as the tabs", () => {
    const plugins = [descriptor("demo", [{ id: "db", title: "DB", rail: { icon: "layout-grid", badge: true } }])]
    const views = webSurfaceViews(plugins)
    expect(railItemsFromWebSurfaces(views)).toEqual([
      { surfaceId: "plugin:demo:db", packageName: "demo", label: "DB", icon: "layout-grid", order: 100, badge: true },
    ])
    expect(webSurfaceTabs(views, plugins).map((tab) => tab.id)).toEqual(["plugin:demo:db"])
  })
})

describe("shell wiring pins", () => {
  const shell = read("MafwShell.tsx")

  test("the shell derives rail items and tabs from the committed descriptors", () => {
    expect(shell).toContain("webSurfaceViews(pluginDescriptors())")
    expect(shell).toContain("pluginRailItems")
    expect(shell).toContain("railItemsFromWebSurfaces(")
    expect(shell).toContain("webSurfaceTabs(")
    // Web tabs join the L2 list, so `resolveActiveSurface` knows their ids and a
    // persisted `plugin:<pkg>:<surface>` survives a reload.
    expect(shell).toContain("...pluginWebSurfaceTabs(),")
  })

  test("a rail click opens the workbench on that surface", () => {
    expect(shell).toContain('openWorkbenchContext("content"')
    expect(shell).toContain("applyWorkbenchSurface(surfaceId)")
    expect(shell).toContain("onPluginItem={openPluginSurface}")
    expect(shell).toContain("pluginItems={pluginRailItems()}")
    expect(shell).toContain("pluginActiveSurface=")
  })

  test("the workbench gets the surface list, the gateway origin and the bridge callbacks", () => {
    expect(shell).toContain("webSurfaces={pluginWebSurfaces()}")
    expect(shell).toContain("gatewayUrl={gatewayUrl()}")
    expect(shell).toContain("onWebBadge={applyWebSurfaceBadge}")
    expect(shell).toContain("onWebTitle={applyWebSurfaceTitle}")
    expect(shell).toContain("onWebError={applyWebSurfaceError}")
    // Badge/title writes go through the pure state module (single source for rail + tabs).
    expect(shell).toContain("applyPluginSurfaceBadge(")
    expect(shell).toContain("applyPluginSurfaceTitle(")
    // Revision removal prunes labels; the tab falls back through resolveActiveSurface.
    expect(shell).toContain("prunePluginSurfaceRuntime(")
  })

  test("the rail renders plugin items inside the destination group, before the spacer", () => {
    const rail = read("components/IconRail.tsx")
    expect(rail).toContain("PluginRailItem")
    expect(rail).toContain("pluginItems")
    expect(rail).toContain("onPluginItem")
    expect(rail).toContain("pluginActiveSurface")
    const destinations = rail.indexOf("pluginEntries()")
    const spacer = rail.indexOf("mafw-icon-rail-spacer")
    expect(destinations).toBeGreaterThan(-1)
    expect(spacer).toBeGreaterThan(destinations)
    // Descriptor icons were validated against PLUGIN_ICON_NAMES; the freshness
    // test below keeps that set inside the v1 registry.
    expect(rail).toContain("item.icon as IconName")
  })

  test("the workbench code view mounts the sandboxed host for web surfaces", () => {
    const code = read("components/WorkbenchCodeView.tsx")
    expect(code).toContain("PluginWebSurfaceHost")
    expect(code).toContain("<PluginWebSurfaceHost")
    expect(code).toContain("projectDir=")
    expect(code).toContain("sessionID={props.sessionID}")
    expect(code).toContain("onBadge=")
    expect(code).toContain("onTitle=")
    expect(code).toContain("onError=")
    // Declarative panels must not double-render for a web surface id.
    expect(code).toContain("&& !webSurface()")
  })

  test("the workbench shell forwards the web surface props", () => {
    const workbench = read("components/WorkbenchShell.tsx")
    for (const wire of [
      "webSurfaces={props.webSurfaces}",
      "gatewayUrl={props.gatewayUrl}",
      "onWebBadge={props.onWebBadge}",
      "onWebTitle={props.onWebTitle}",
      "onWebError={props.onWebError}",
    ]) {
      expect(workbench).toContain(wire)
    }
  })
})

describe("plugin icon freshness", () => {
  // v1 registry keys; `Icon` only renders names in this table (an unknown name
  // is a silent blank <use>). Parsed from source so the check does not depend on
  // how the bundler resolves `@mafw/ui/icon`.
  const iconSource = read("../../../../ui/src/components/icon.tsx")

  function v1IconNames(source: string): Set<string> {
    const start = source.indexOf("export const icons = {")
    const end = source.indexOf("\n}", start)
    const body = source.slice(start, end)
    const names = new Set<string>()
    for (const line of body.split("\n")) {
      const match = /^ {2}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_$]+))\s*:/.exec(line)
      const name = match?.[1] ?? match?.[2] ?? match?.[3]
      if (name) names.add(name)
    }
    return names
  }

  test("every PLUGIN_ICON_NAMES glyph exists in the v1 registry", () => {
    const icons = v1IconNames(iconSource)
    // Sanity: a broken parse must not turn this into a vacuous pass.
    expect(icons.size).toBeGreaterThan(50)
    expect(PLUGIN_ICON_NAMES.length).toBeGreaterThan(0)
    const missing = PLUGIN_ICON_NAMES.filter((name) => !icons.has(name))
    expect(missing).toEqual([])
  })

  test("PLUGIN_ICON_NAMES has no duplicates", () => {
    expect(new Set(PLUGIN_ICON_NAMES).size).toBe(PLUGIN_ICON_NAMES.length)
  })
})
