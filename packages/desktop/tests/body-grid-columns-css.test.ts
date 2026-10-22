import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：三列 grid 的列位必须显式指定——LeftDock 关闭时它不渲染，
// 若靠自动排布，main/dock 会左移一列（2026-10-22 冒烟实证：chat 消失、工作台占满）。
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")

describe("body 三列显式列位", () => {
  test("main 恒在第 2 列，dock 槽恒在第 3 列", () => {
    const main = css.match(/\.mafw-main \{[\s\S]*?\}/)?.[0] ?? ""
    const dock = css.match(/\.mafw-dock-slot \{[\s\S]*?\}/)?.[0] ?? ""
    expect(main).toContain("grid-column: 2")
    expect(dock).toContain("grid-column: 3")
  })
  test("push 模式的左 dock 恒在第 1 列", () => {
    const block = css.match(/\.mafw-left-dock\.push \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("grid-column: 1")
  })
})
