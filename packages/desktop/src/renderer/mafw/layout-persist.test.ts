import { describe, expect, test } from "bun:test"
import {
  saveLayout,
  loadLayout,
  pruneMissing,
  LAYOUT_KEY,
  loadProjectLayouts,
  saveProjectLayout,
  loadProjectLayout,
  migrateLegacyLayout,
  LAYOUTS_KEY,
} from "./layout-persist"

function memIO() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
}

describe("layout persistence", () => {
  test("save then load round-trips the snapshot", () => {
    const io = memIO()
    saveLayout(io, { tabs: [{ id: "s1", title: "A" }, { id: "s2" }], activeViewId: "s2" })
    const snap = loadLayout(io)
    expect(snap?.tabs.map(t => t.id)).toEqual(["s1", "s2"])
    expect(snap?.activeViewId).toBe("s2")
  })

  test("load with empty storage returns null", () => {
    expect(loadLayout(memIO())).toBeNull()
  })

  test("corrupt JSON returns null (fail-open)", () => {
    const io = memIO()
    io.setItem(LAYOUT_KEY, "{not json")
    expect(loadLayout(io)).toBeNull()
  })

  test("pruneMissing keeps only existing sessions and fixes activeViewId", () => {
    const snap = { tabs: [{ id: "s1" }, { id: "gone" }, { id: "s2" }], activeViewId: "gone", savedAt: 1 }
    const out = pruneMissing(snap, new Set(["s1", "s2"]))
    expect(out?.tabs.map(t => t.id)).toEqual(["s1", "s2"])
    expect(out?.activeViewId).toBe("s1") // fell back to first surviving tab
  })

  test("pruneMissing with nothing left returns null", () => {
    const snap = { tabs: [{ id: "gone" }], activeViewId: "gone", savedAt: 1 }
    expect(pruneMissing(snap, new Set(["other"]))).toBeNull()
  })

  test("save ignores empty tab lists (nothing to restore)", () => {
    const io = memIO()
    saveLayout(io, { tabs: [], activeViewId: null })
    expect(loadLayout(io)).toBeNull()
  })
})

describe("per-project layout persistence", () => {
  test("projects are isolated and survive switching back", () => {
    const io = memIO()
    saveProjectLayout(io, "/p/a", { tabs: [{ id: "a1", title: "A1" }], activeViewId: "a1" })
    saveProjectLayout(io, "/p/b", { tabs: [{ id: "b1", title: "B1" }], activeViewId: "b1" })

    expect(loadProjectLayout(io, "/p/a")?.tabs.map(t => t.id)).toEqual(["a1"])
    expect(loadProjectLayout(io, "/p/b")?.tabs.map(t => t.id)).toEqual(["b1"])
    expect(loadProjectLayout(io, "/p/c")).toBeNull()
  })

  test("closing all tabs removes only that project", () => {
    const io = memIO()
    saveProjectLayout(io, "/p/a", { tabs: [{ id: "a1" }], activeViewId: "a1" })
    saveProjectLayout(io, "/p/b", { tabs: [{ id: "b1" }], activeViewId: "b1" })

    saveProjectLayout(io, "/p/a", { tabs: [], activeViewId: null })

    expect(loadProjectLayout(io, "/p/a")).toBeNull()
    expect(loadProjectLayout(io, "/p/b")?.tabs.map(t => t.id)).toEqual(["b1"])
  })

  test("legacy global layout migrates to the first project exactly once", () => {
    const io = memIO()
    saveLayout(io, { tabs: [{ id: "legacy", title: "Old" }], activeViewId: "legacy" })

    const migrated = migrateLegacyLayout(io, "/p/a")
    expect(migrated?.tabs.map(t => t.id)).toEqual(["legacy"])
    expect(loadProjectLayout(io, "/p/a")?.activeViewId).toBe("legacy")
    expect(io.getItem(LAYOUT_KEY)).toBeNull()

    expect(migrateLegacyLayout(io, "/p/b")).toBeNull()
  })

  test("corrupt project map fails open to no layouts", () => {
    const io = memIO()
    io.setItem(LAYOUTS_KEY, "{oops")
    expect(loadProjectLayouts(io)).toEqual({})
    expect(loadProjectLayout(io, "/p/a")).toBeNull()
  })
})
