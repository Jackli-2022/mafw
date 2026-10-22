import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// deferred minors：新布局落地后遗留的死代码必须清掉，避免下一个人误接线。
const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("dead code 清理", () => {
  test("UsagePill 组件已删除（右 dock「用量」tab 取代）", () => {
    expect(existsSync(join(root, "src/renderer/mafw/components/UsagePill.tsx"))).toBe(false)
  })
  test("railAutoAction（旧 Rail 自动折叠）已删除", () => {
    const lb = read("src/renderer/mafw/layout-breakpoints.ts")
    expect(lb).not.toContain("railAutoAction")
    expect(lb).not.toContain("RailAutoAction")
  })
  test("applyRightDockWidth 死函数已删除", () => {
    expect(read("src/renderer/mafw/MafwShell.tsx")).not.toContain("applyRightDockWidth")
  })
  test("旧 .mafw-rail 根样式已删除（LeftDock 仍用 .mafw-rail-* 系列）", () => {
    const css = read("src/renderer/mafw/mafw.css")
    expect(css).not.toMatch(/\.mafw-rail\s*\{/)
  })
})
