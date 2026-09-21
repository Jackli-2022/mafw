import { describe, test, expect } from "bun:test"
import { normalizeDockTab, DOCK_TABS } from "../src/renderer/mafw/components/dock-tab"

describe("normalizeDockTab", () => {
  test("合法值直通", () => {
    expect(normalizeDockTab("tasks")).toBe("tasks")
    expect(normalizeDockTab("usage")).toBe("usage")
    expect(normalizeDockTab("notes")).toBe("notes")
  })
  test("quota 迁移到 usage（v4.13 五栏并四栏）", () => {
    expect(normalizeDockTab("quota")).toBe("usage")
  })
  test("非法值回退默认", () => {
    expect(normalizeDockTab("bogus")).toBe("usage")
  })
  test("null/undefined 回退", () => {
    expect(normalizeDockTab(null)).toBe("usage")
    expect(normalizeDockTab(undefined)).toBe("usage")
  })
  test("自定义 fallback", () => {
    expect(normalizeDockTab("bogus", "tasks")).toBe("tasks")
  })
})

describe("DOCK_TABS", () => {
  test("五栏且不含 quota", () => {
    expect(DOCK_TABS).toEqual(["tasks", "trajectory", "usage", "notes", "changes"])
  })
  test("changes 合法值直通", () => {
    expect(normalizeDockTab("changes")).toBe("changes")
  })
})
