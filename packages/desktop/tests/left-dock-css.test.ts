import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：左 dock 双模态（spec 2026-10-22-workbench-layout D2）。
// 窗口化 = overlay 绝对定位浮层；最大化 = 正常流推挤列（.push 无定位）。
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")

describe("left dock CSS 契约", () => {
  test("overlay 是绝对定位浮层（含阴影且 z-index 高于 workbench）", () => {
    const block = css.match(/\.mafw-left-dock\.overlay \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("position: absolute")
    expect(block).toContain("box-shadow: var(--elev-panel)")
    const z = Number(block.match(/z-index:\s*(\d+)/)?.[1] ?? 0)
    expect(z).toBeGreaterThanOrEqual(60)
  })
  test("基础容器是纵向 flex（push 模式下作为正常 grid 列）", () => {
    const block = css.match(/\.mafw-left-dock \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("flex-direction: column")
    expect(block).not.toContain("position: absolute")
  })
  test("浮层点外关闭的 backdrop 存在", () => {
    expect(css).toContain(".mafw-left-dock-backdrop")
  })
  test("左 dock 自身是定位容器（resize handle 贴它右缘，而不是 body 右缘）", () => {
    const block = css.match(/\.mafw-left-dock \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("position: relative")
  })
  test("项目切换下拉的 z-index 高于浮层/遮罩（默认窗口化下可用）", () => {
    const block = css.match(/\.mafw-rail-switcher-menu \{[\s\S]*?\}/)?.[0] ?? ""
    const z = Number(block.match(/z-index:\s*(\d+)/)?.[1] ?? 0)
    expect(z).toBeGreaterThan(61)
  })
  test("shell 左列默认 46px（图标轨），不再给 264px 旧 rail", () => {
    expect(css).toContain("var(--rail-w, 46px)")
  })
})
