import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 终审 Important 修复的接线契约（source-level，与 house 既有 design-contract 风格一致）。
const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("workbench 终审修复接线", () => {
  test("浮层打开时选中会话/导航 → 关闭浮层（shouldCloseOnSelect 接线到三处路径）", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain("closeLeftDockIfOverlay")
    // openSessionTab 与 topstrip 选中都走同一关闭门
    expect((shell.match(/closeLeftDockIfOverlay\(\)/g) || []).length).toBeGreaterThanOrEqual(3)
  })
  test("非 chat 视图不渲染工作台（页面整页让位，宽窄一致）", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toMatch(/open=\{dockPresent\(\) && chatActive\(\)\}/)
  })
  test("展开态信号独立于最大化信号（fullscreen 不再冒充 maximized）", () => {
    const main = read("src/main/windows.ts")
    const preload = read("src/preload/index.ts")
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(main).toContain("window-expanded-changed")
    expect(preload).toContain("onExpandedChange")
    expect(shell).toContain("onExpandedChange")
  })
  test("Ctrl+K 打开左栏搜索面（全局快捷键）", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toMatch(/key\.toLowerCase\(\) !== "k"/)
    expect(shell).toContain('toggleLeftDock("search")')
  })
  test("切回会话面清空搜索词（避免残留过滤把会话列表藏起来）", () => {
    const dock = read("src/renderer/mafw/components/LeftDock.tsx")
    expect(dock).toMatch(/props\.face !== "search"[\s\S]{0,160}setQuery\(""\)/)
  })
  test("浮层打开时接管焦点、关闭后还原（overlay 专属）", () => {
    const dock = read("src/renderer/mafw/components/LeftDock.tsx")
    expect(dock).toContain("previouslyFocused")
    expect(dock).toMatch(/props\.mode !== "overlay"[\s\S]{0,120}return/)
    expect(dock).toMatch(/previouslyFocused\?\.focus\?\.\(\)/)
  })
  test("rail 的 + 新建会话揭示 chat（复用 openSessionTab）", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toMatch(/createSession\(\)\.then\(\(sid\)/)
  })
})
