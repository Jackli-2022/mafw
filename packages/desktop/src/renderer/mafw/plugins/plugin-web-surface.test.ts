// Task 7: projection of `ui.webSurfaces` into workbench surfaces + rail items.
//
// The projection is pure data: surface identity (`plugin:<pkg>:<surface>`),
// defaults for descriptors validated by older gateways, deterministic ordering
// and the sandboxed page URL. Task 8/9 render these views unchanged.
import { describe, expect, test } from "bun:test"
import type { PluginClientDescriptor } from "@mafw/plugin-contract"
import { railItemsFromWebSurfaces, webSurfaceSrc, webSurfaceViews } from "./plugin-web-surface"

/** Descriptor fixture; surfaces are deliberately loose (old/unvalidated input). */
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

describe("webSurfaceViews", () => {
  test("projects web surfaces and rail items deterministically", () => {
    const views = webSurfaceViews([
      descriptor("demo", [{ id: "db", title: "DB", rail: { icon: "layout-grid", order: 2 } }], "r"),
    ])
    expect(views[0]?.surfaceId).toBe("plugin:demo:db")
    expect(railItemsFromWebSurfaces(views)).toEqual([
      {
        surfaceId: "plugin:demo:db",
        packageName: "demo",
        label: "DB",
        icon: "layout-grid",
        order: 2,
        badge: false,
      },
    ])
  })

  test("applies defaults for unprojected entries and keeps the descriptor revision", () => {
    const [view] = webSurfaceViews([descriptor("demo", [{ id: "db", title: "DB" }], "boot-a:7")])
    expect(view).toEqual({
      packageName: "demo",
      surfaceId: "plugin:demo:db",
      id: "db",
      title: "DB",
      entry: "index.html",
      scope: "session",
      reloadOnSessionChange: true,
      revision: "boot-a:7",
    })
    expect(view?.rail).toBeUndefined()
  })

  test("keeps projected fields and rejects an invalid scope", () => {
    const views = webSurfaceViews([
      descriptor("demo", [
        {
          id: "logs",
          title: "Logs",
          icon: "terminal",
          entry: "app/index.html",
          scope: "project",
          reloadOnSessionChange: false,
          rail: { icon: "terminal", badge: true },
        },
        { id: "bad-scope", title: "Bad", scope: "window" },
      ]),
    ])
    expect(views.find((view) => view.id === "logs")).toMatchObject({
      id: "logs",
      icon: "terminal",
      entry: "app/index.html",
      scope: "project",
      reloadOnSessionChange: false,
      rail: { icon: "terminal", order: 100, badge: true },
    })
    expect(views.find((view) => view.id === "bad-scope")?.scope).toBe("session")
  })

  test("tolerates old descriptors without ui.webSurfaces", () => {
    expect(webSurfaceViews([])).toEqual([])
    expect(webSurfaceViews([descriptor("old", undefined)])).toEqual([])
    expect(
      webSurfaceViews([
        { name: "old", version: "1.0.0", revision: "r", actions: [], events: [] } as unknown as
          PluginClientDescriptor,
      ]),
    ).toEqual([])
  })

  test("skips invalid names, invalid ids and duplicate surface ids", () => {
    const views = webSurfaceViews([
      descriptor("../evil", [{ id: "x", title: "X" }]),
      descriptor("demo", [
        { id: "db", title: "DB" },
        { id: "db", title: "Duplicate" },
        { id: "bad:id", title: "Bad" },
        { id: "ok", title: "OK" },
      ]),
    ])
    expect(views.map((view) => view.surfaceId)).toEqual(["plugin:demo:db", "plugin:demo:ok"])
    expect(views[0]?.title).toBe("DB")
  })

  test("falls back to the surface id when the title is missing", () => {
    const [view] = webSurfaceViews([descriptor("demo", [{ id: "db" }])])
    expect(view?.title).toBe("db")
  })

  test("orders views by rail order, then package, then surface", () => {
    const views = webSurfaceViews([
      descriptor("zeta", [{ id: "b", title: "ZB" }]),
      descriptor("beta", [{ id: "a", title: "BA" }]),
      descriptor("alpha", [{ id: "z", title: "AZ", rail: { icon: "terminal", order: 5 } }]),
    ])
    expect(views.map((view) => view.surfaceId)).toEqual([
      "plugin:alpha:z",
      "plugin:beta:a",
      "plugin:zeta:b",
    ])
  })
})

describe("railItemsFromWebSurfaces", () => {
  test("only surfaces that declare a rail contribute an item", () => {
    const views = webSurfaceViews([
      descriptor("demo", [
        { id: "db", title: "DB" },
        { id: "logs", title: "Logs", rail: { icon: "terminal" } },
        { id: "broken", title: "Broken", rail: { order: 1 } },
      ]),
    ])
    expect(railItemsFromWebSurfaces(views).map((item) => item.surfaceId)).toEqual([
      "plugin:demo:logs",
    ])
  })

  test("sorts by order then package then surface", () => {
    const views = webSurfaceViews([
      descriptor("zeta", [{ id: "b", title: "ZB", rail: { icon: "terminal", order: 10 } }]),
      descriptor("beta", [{ id: "a", title: "BA", rail: { icon: "terminal", order: 10 } }]),
      descriptor("alpha", [{ id: "z", title: "AZ", rail: { icon: "terminal", order: 1 } }]),
    ])
    expect(railItemsFromWebSurfaces(views).map((item) => item.surfaceId)).toEqual([
      "plugin:alpha:z",
      "plugin:beta:a",
      "plugin:zeta:b",
    ])
  })
})

describe("webSurfaceSrc", () => {
  test("builds the package asset URL with an encoded revision token", () => {
    const [view] = webSurfaceViews([
      descriptor("demo", [{ id: "db", title: "DB", entry: "app/main.html" }], "boot-a:2"),
    ])
    expect(webSurfaceSrc("http://127.0.0.1:3000/", view!)).toBe(
      "http://127.0.0.1:3000/api/plugins/demo/ui/app/main.html?revision=boot-a%3A2",
    )
  })

  test("defaults to index.html and omits an empty revision", () => {
    const [view] = webSurfaceViews([descriptor("demo", [{ id: "db", title: "DB" }], "")])
    expect(webSurfaceSrc("http://127.0.0.1:3000", view!)).toBe(
      "http://127.0.0.1:3000/api/plugins/demo/ui/index.html",
    )
  })

  test("drops empty and dot segments from the entry", () => {
    const [view] = webSurfaceViews([
      descriptor("demo", [{ id: "db", title: "DB", entry: "/app/../app/./index.html" }]),
    ])
    expect(webSurfaceSrc("http://h:1", view!)).toBe(
      "http://h:1/api/plugins/demo/ui/app/app/index.html?revision=boot-a%3A1",
    )
  })
})
