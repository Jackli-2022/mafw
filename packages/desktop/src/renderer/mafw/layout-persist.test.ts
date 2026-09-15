import { describe, expect, test } from "bun:test"
import { saveLayout, loadLayout, pruneMissing, LAYOUT_KEY } from "./layout-persist"

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
