// Task 8: declarative plugin view model.
//
// Everything here is plain data in / plain data out: no Solid, no DOM and no
// plugin code. The renderer consumes these helpers so tab ordering, overflow,
// stale-response guards and action payload semantics stay testable without a
// browser.
import { describe, expect, test } from "bun:test"
import type {
  PluginClientDescriptor,
  PluginPanelDescriptor,
  PluginView,
} from "@mafw/plugin-contract"
import type { PluginGeneration } from "./plugin-client"
import {
  EMPTY_PLUGIN_PANEL_VIEW_STATE,
  actionWidgetInvocation,
  beginPanelViewRequest,
  classifyPanelActionOutput,
  failPanelView,
  panelRequestStillCurrent,
  panelRequestToken,
  pluginPanelRefreshesOn,
  pluginSurfaceIssues,
  pluginSurfaces,
  planPluginTabs,
  replacePanelView,
  resolveActiveSurface,
  safePluginImageDataUrl,
  safePluginLinkHref,
  setPanelActionOutput,
  settlePanelView,
  widgetFallbackText,
} from "./plugin-view-model"

const gen = (revision: string): PluginGeneration => {
  const separator = revision.lastIndexOf(":")
  return {
    bootId: separator > 0 ? revision.slice(0, separator) : revision,
    counter: separator > 0 ? Number(revision.slice(separator + 1)) : 0,
    revision,
  }
}

const panel = (over: Partial<PluginPanelDescriptor> = {}): PluginPanelDescriptor => ({
  id: "stats",
  title: "Stats",
  viewAction: "view",
  ...over,
})

const descriptor = (
  name: string,
  panels: PluginPanelDescriptor[],
  over: Partial<PluginClientDescriptor> = {},
): PluginClientDescriptor => ({
  name,
  version: "1.0.0",
  revision: "boot-a:1",
  ui: { panels },
  actions: [{ name: "view" }, { name: "refresh" }, { name: "go" }],
  events: [{ type: `plugin:${name}:changed` }],
  ...over,
})

const view = (title: string): PluginView => ({
  title,
  body: [{ type: "text", text: title }],
})

describe("pluginSurfaces", () => {
  test("stable sort by order, then title, then package name", () => {
    const surfaces = pluginSurfaces([
      descriptor("zeta", [
        panel({ id: "b", title: "Beta", order: 10 }),
        panel({ id: "a", title: "Alpha" }),
        panel({ id: "c", title: "Charlie", order: 5 }),
      ]),
      descriptor("alpha", [panel({ id: "a", title: "Alpha" })]),
    ])

    expect(surfaces.map((surface) => surface.id)).toEqual([
      "plugin:alpha:a",
      "plugin:zeta:a",
      "plugin:zeta:c",
      "plugin:zeta:b",
    ])
    expect(surfaces.map((surface) => surface.label)).toEqual([
      "Alpha",
      "Alpha",
      "Charlie",
      "Beta",
    ])
  })

  test("keeps descriptor order for equal sort keys and exposes the pair", () => {
    const first = descriptor("acme", [panel({ id: "one", title: "Same" })])
    const second = descriptor("acme-extra", [panel({ id: "two", title: "Same" })])
    const surfaces = pluginSurfaces([first, second])

    // Title tie → package name tie-break ("acme" < "acme-extra").
    expect(surfaces.map((surface) => surface.id)).toEqual([
      "plugin:acme:one",
      "plugin:acme-extra:two",
    ])
    expect(surfaces[0]?.panel.id).toBe("one")
    expect(surfaces[0]?.descriptor).toBe(first)
  })

  test("excludes panels whose view action is missing or undeclared", () => {
    const withBadPanels = descriptor("acme", [
      panel({ id: "good", title: "Good" }),
      panel({ id: "empty", title: "Empty", viewAction: "" }),
      panel({ id: "ghost", title: "Ghost", viewAction: "ghost" }),
    ])

    const surfaces = pluginSurfaces([withBadPanels])
    expect(surfaces.map((surface) => surface.id)).toEqual(["plugin:acme:good"])

    const issues = pluginSurfaceIssues([withBadPanels])
    expect(issues.map((issue) => issue.code)).toEqual([
      "panel-missing-action",
      "panel-missing-action",
    ])
    expect(issues.map((issue) => issue.panel)).toEqual(["empty", "ghost"])
    expect(issues[0]?.package).toBe("acme")
    expect(issues[0]?.message).toContain("acme")
  })

  test("ignores descriptors without panels and empty lists", () => {
    expect(pluginSurfaces([])).toEqual([])
    expect(pluginSurfaces([descriptor("acme", [])])).toEqual([])
    expect(pluginSurfaceIssues([descriptor("acme", [])])).toEqual([])
  })
})

describe("planPluginTabs", () => {
  const surfaces = pluginSurfaces([
    descriptor("acme", [
      panel({ id: "one", title: "One", order: 1 }),
      panel({ id: "two", title: "Two", order: 2 }),
      panel({ id: "three", title: "Three", order: 3 }),
      panel({ id: "four", title: "Four", order: 4 }),
      panel({ id: "five", title: "Five", order: 5 }),
    ]),
  ])

  test("shows a prefix and overflows the rest when they fit", () => {
    const plan = planPluginTabs(surfaces, { capacity: 3 })
    expect(plan.visible.map((surface) => surface.panel.id)).toEqual(["one", "two", "three"])
    expect(plan.overflow.map((surface) => surface.panel.id)).toEqual(["four", "five"])
  })

  test("keeps the active surface visible by swapping it into the last slot", () => {
    const plan = planPluginTabs(surfaces, { capacity: 3, activeId: "plugin:acme:four" })
    expect(plan.visible.map((surface) => surface.panel.id)).toEqual(["one", "two", "four"])
    expect(plan.overflow.map((surface) => surface.panel.id)).toEqual(["three", "five"])
  })

  test("no overflow when everything fits", () => {
    const plan = planPluginTabs(surfaces, { capacity: 5 })
    expect(plan.visible).toHaveLength(5)
    expect(plan.overflow).toEqual([])
  })

  test("clamps invalid capacity without dropping surfaces", () => {
    expect(planPluginTabs(surfaces, { capacity: 0 }).visible).toEqual([])
    expect(planPluginTabs(surfaces, { capacity: 0 }).overflow).toHaveLength(5)
    const nan = planPluginTabs(surfaces, { capacity: Number.NaN })
    expect(nan.visible).toHaveLength(0)
  })
})

describe("resolveActiveSurface", () => {
  test("keeps a builtin surface", () => {
    expect(resolveActiveSurface("browser", [], true)).toBe("browser")
  })

  test("keeps a removed plugin surface until the client snapshot is loaded", () => {
    expect(resolveActiveSurface("plugin:acme:stats", [], false)).toBe("plugin:acme:stats")
  })

  test("keeps an existing plugin surface", () => {
    expect(resolveActiveSurface("plugin:acme:stats", ["plugin:acme:stats"], true)).toBe(
      "plugin:acme:stats",
    )
  })

  test("falls back to code when the plugin panel disappeared", () => {
    expect(resolveActiveSurface("plugin:acme:stats", ["plugin:acme:other"], true)).toBe("code")
    expect(resolveActiveSurface("plugin:acme:stats", [], true)).toBe("code")
  })
})

describe("widget helpers", () => {
  test("unknown widgets become text, never markup", () => {
    expect(widgetFallbackText({ type: "future", payload: 1 })).toBe(
      '{"type":"future","payload":1}',
    )
    expect(widgetFallbackText("plain")).toBe("plain")
    expect(widgetFallbackText(7)).toBe("7")
  })

  test("action widget emits the exact action and input", () => {
    expect(
      actionWidgetInvocation({
        type: "action",
        label: "Run",
        action: "go",
        input: { job: 7, force: true },
        style: "primary",
      }),
    ).toEqual({ action: "go", input: { job: 7, force: true } })

    expect(
      actionWidgetInvocation({ type: "action", label: "Refresh", action: "refresh" }),
    ).toEqual({ action: "refresh", input: undefined })

    expect(actionWidgetInvocation({ type: "text", text: "nope" })).toBeNull()
    expect(actionWidgetInvocation({ type: "action", label: "X", action: "bad name" })).toBeNull()
  })

  test("only http(s)/mailto/tel links survive", () => {
    expect(safePluginLinkHref("https://example.com/docs")).toBe("https://example.com/docs")
    expect(safePluginLinkHref("http://example.com")).toBe("http://example.com")
    expect(safePluginLinkHref("mailto:dev@example.com")).toBe("mailto:dev@example.com")
    expect(safePluginLinkHref("tel:+123")).toBe("tel:+123")
    expect(safePluginLinkHref("javascript:alert(1)")).toBeNull()
    expect(safePluginLinkHref("data:text/html,<b>x</b>")).toBeNull()
    expect(safePluginLinkHref("/relative")).toBeNull()
    expect(safePluginLinkHref("")).toBeNull()
  })

  test("only data:image sources render as images", () => {
    expect(safePluginImageDataUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA")
    expect(safePluginImageDataUrl("data:text/html;base64,AAAA")).toBeNull()
    expect(safePluginImageDataUrl("https://example.com/x.png")).toBeNull()
  })
})

describe("panel refresh subscription", () => {
  test("refreshes only for the exact declared package event", () => {
    const target = panel({ refreshOn: ["plugin:acme:changed", "plugin:acme:job"] })
    expect(pluginPanelRefreshesOn(target, "acme", "plugin:acme:changed")).toBe(true)
    expect(pluginPanelRefreshesOn(target, "acme", "plugin:acme:job")).toBe(true)
    expect(pluginPanelRefreshesOn(target, "acme", "plugin:acme:other")).toBe(false)
    expect(pluginPanelRefreshesOn(target, "other", "plugin:acme:changed")).toBe(false)
    expect(pluginPanelRefreshesOn(panel(), "acme", "plugin:acme:changed")).toBe(false)
  })
})

describe("panel view request state machine", () => {
  test("begin captures a new request id and generation", () => {
    const first = beginPanelViewRequest(EMPTY_PLUGIN_PANEL_VIEW_STATE, gen("boot-a:3"))
    expect(first.requestId).toBe(1)
    expect(first.status).toBe("loading")
    expect(first.generation?.revision).toBe("boot-a:3")
    expect(panelRequestToken(first)).toEqual({ requestId: 1, generation: gen("boot-a:3") })

    const second = beginPanelViewRequest(first, gen("boot-a:4"))
    expect(second.requestId).toBe(2)
    expect(second.generation?.revision).toBe("boot-a:4")
  })

  test("old revision fetches are discarded", () => {
    const first = beginPanelViewRequest(EMPTY_PLUGIN_PANEL_VIEW_STATE, gen("boot-a:3"))
    const second = beginPanelViewRequest(first, gen("boot-a:4"))
    const stale = panelRequestToken(first)!

    expect(panelRequestStillCurrent(second, stale, gen("boot-a:4"))).toBe(false)
    expect(panelRequestStillCurrent(second, panelRequestToken(second)!, gen("boot-a:3"))).toBe(false)
    expect(panelRequestStillCurrent(second, panelRequestToken(second)!, gen("boot-a:4"))).toBe(true)

    // A stale response must not overwrite the newer request.
    const settled = settlePanelView(second, stale.requestId, view("old"))
    expect(settled).toBe(second)
  })

  test("settles a valid view and keeps the last good view on failure", () => {
    const ready = settlePanelView(beginPanelViewRequest(EMPTY_PLUGIN_PANEL_VIEW_STATE, gen("boot-a:1")), 1, view("Good"))
    expect(ready.status).toBe("ready")
    expect(ready.view?.title).toBe("Good")
    expect(ready.error).toBeNull()

    const invalid = settlePanelView(beginPanelViewRequest(ready, gen("boot-a:2")), 2, { not: "a view" })
    expect(invalid.status).toBe("error")
    expect(invalid.view?.title).toBe("Good")
    expect(invalid.error).toContain("插件视图")

    const failedState = beginPanelViewRequest(ready, gen("boot-a:3"))
    const failed = failPanelView(failedState, failedState.requestId, "boom")
    expect(failed.status).toBe("error")
    expect(failed.view?.title).toBe("Good")
    expect(failed.error).toBe("boom")
  })

  test("replacePanelView invalidates in-flight fetches and setPanelActionOutput keeps bookkeeping", () => {
    const state = beginPanelViewRequest(EMPTY_PLUGIN_PANEL_VIEW_STATE, gen("boot-a:1"))
    const shown = replacePanelView(state, view("Acted"))
    expect(shown.status).toBe("ready")
    expect(shown.requestId).toBe(state.requestId + 1)
    expect(panelRequestStillCurrent(shown, { requestId: state.requestId, generation: gen("boot-a:1") }, gen("boot-a:1"))).toBe(false)

    const withOutput = setPanelActionOutput(shown, "result text")
    expect(withOutput.actionOutput).toBe("result text")
    expect(setPanelActionOutput(withOutput, null).actionOutput).toBeNull()
  })
})

describe("classifyPanelActionOutput", () => {
  test("valid views replace the panel", () => {
    const outcome = classifyPanelActionOutput(view("Next"))
    expect(outcome.kind).toBe("view")
    if (outcome.kind === "view") expect(outcome.view.title).toBe("Next")
  })

  test("undefined/null mean refetch only", () => {
    expect(classifyPanelActionOutput(undefined).kind).toBe("empty")
    expect(classifyPanelActionOutput(null).kind).toBe("empty")
  })

  test("other JSON shows the result, then refetch is requested by the caller", () => {
    expect(classifyPanelActionOutput({ ok: true, count: 2 })).toEqual({
      kind: "result",
      text: JSON.stringify({ ok: true, count: 2 }, null, 2),
    })
    expect(classifyPanelActionOutput("done")).toEqual({ kind: "result", text: "done" })
    expect(classifyPanelActionOutput(42)).toEqual({ kind: "result", text: "42" })
  })
})
