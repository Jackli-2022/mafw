import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：左栏图标轨（IconRail）的骨架样式。
// spec: docs/superpowers/specs/2026-10-22-workbench-layout-design.md D3
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")

describe("icon rail CSS 契约", () => {
  test("轨宽 46px 且纵向排列", () => {
    const block = css.match(/\.mafw-icon-rail \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("width: 46px")
    expect(block).toContain("flex-direction: column")
  })
  test("激活图标有左侧 accent 指示", () => {
    const block = css.match(/\.mafw-icon-rail-icon\.active \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("inset 2px 0 0")
  })
  test("图标按钮固定 32×32（压过 ButtonV2 small 的 24px 高度）", () => {
    const block = css.match(/\.mafw-icon-rail \.mafw-icon-rail-icon[^{]*\{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("width: 32px")
    expect(block).toContain("height: 32px")
    expect(block).toContain("min-height: 32px")
  })
  test("徽标与连接状态点存在", () => {
    expect(css).toContain(".mafw-icon-rail-badge")
    expect(css).toContain(".mafw-icon-rail-conn-dot")
    expect(css).toContain(".mafw-icon-rail-conn-dot.ready")
    expect(css).toContain(".mafw-icon-rail-conn-dot.reconnecting")
    expect(css).toContain(".mafw-icon-rail-conn-dot.failed")
    expect(css).toContain(".mafw-icon-rail-conn-dot.stopped")
  })
})
