import { describe, test, expect } from "bun:test"
import { normalizeDockTab, DOCK_TABS, DOCK_DEFAULT_WIDTH } from "../src/renderer/mafw/components/dock-tab"

describe("normalizeDockTab（2026-10-26 工作台合并后：仅会话数据面板）", () => {
  test("合法值直通", () => {
    expect(normalizeDockTab("tasks")).toBe("tasks")
    expect(normalizeDockTab("usage")).toBe("usage")
    expect(normalizeDockTab("notes")).toBe("notes")
  })
  test("quota 迁移到 usage（v4.13 五栏并四栏）", () => {
    expect(normalizeDockTab("quota")).toBe("usage")
  })
  test("非法值回退默认（tasks）", () => {
    expect(normalizeDockTab("bogus")).toBe("tasks")
  })
  test("null/undefined 回退（tasks）", () => {
    expect(normalizeDockTab(null)).toBe("tasks")
    expect(normalizeDockTab(undefined)).toBe("tasks")
  })
  test("旧工作台四 tab（files/editor/browser/terminal）不再是 dock tab → 回退", () => {
    for (const legacy of ["files", "editor", "browser", "terminal"]) {
      expect(normalizeDockTab(legacy)).toBe("tasks")
    }
  })
  test("自定义 fallback", () => {
    expect(normalizeDockTab("bogus", "tasks")).toBe("tasks")
  })
})

describe("DOCK_TABS（会话数据面板七栏）", () => {
  test("七栏且不含 quota / 工作台四件套", () => {
    expect(DOCK_TABS).toEqual(["tasks", "trajectory", "usage", "notes", "changes", "subagents", "background"])
  })
  test("changes / subagents / background 合法值直通", () => {
    expect(normalizeDockTab("changes")).toBe("changes")
    expect(normalizeDockTab("subagents")).toBe("subagents")
    expect(normalizeDockTab("background")).toBe("background")
  })
})

describe("dock 宽度（overlay 用）", () => {
  test("overlay 默认宽度 520（工作台骨架需要更宽）", () => expect(DOCK_DEFAULT_WIDTH).toBe(520))
  test("不再导出按 tab 宽度函数", async () => {
    const mod = await import("../src/renderer/mafw/components/dock-tab")
    expect("dockTabWidth" in mod).toBe(false)
    expect("DOCK_WIDE_TABS" in mod).toBe(false)
  })
})
