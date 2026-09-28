import { describe, test, expect } from "bun:test"
import { normalizeDockTab, DOCK_TABS, dockTabWidth } from "../src/renderer/mafw/components/dock-tab"

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

describe("dockTabWidth（v6 W4）", () => {
  test("changes 默认 480", () => expect(dockTabWidth("changes", {})).toBe(480))
  test("普通 tab 默认 320", () => expect(dockTabWidth("usage", {})).toBe(320))
  test("用户记忆值优先", () => expect(dockTabWidth("changes", { changes: 400 })).toBe(400))
})
