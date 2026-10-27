import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：左栏图标轨（IconRail）的骨架样式。
// spec: 2026-10-22-workbench-layout D3 + 2026-10-27-left-rail-visual-polish §6.1（1a 填充块 / 34px / 静音点）
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")

describe("icon rail CSS 契约", () => {
  test("轨宽 46px 且纵向排列", () => {
    const block = css.match(/\.mafw-icon-rail \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("width: 46px")
    expect(block).toContain("flex-direction: column")
  })
  test("激活图标为 1a 填充块（accent 12% 底 + accent 图标，无 inset 左条）", () => {
    const block = css.match(/\.mafw-icon-rail-icon\.active \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("color-mix(in srgb, var(--accent) 12%, transparent)")
    expect(block).toContain("color: var(--accent)")
    expect(block).not.toContain("inset 2px 0 0")
  })
  test("顶部新建动作为虚线描边样式", () => {
    const block = css.match(/\.mafw-icon-rail-icon\.new-action \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("border: 1px dashed")
  })
  test("图标按钮固定 34×34（压过 ButtonV2 small 的 24px 高度）", () => {
    const block = css.match(/\.mafw-icon-rail \.mafw-icon-rail-icon[^{]*\{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("width: 34px")
    expect(block).toContain("height: 34px")
    expect(block).toContain("min-height: 34px")
  })
  test("icon 命中区 box-sizing: border-box（虚线边框不把新建钮撑成 36px）", () => {
    const icon = css.match(/\.mafw-icon-rail-icon \{[\s\S]*?\}/)?.[0] ?? ""
    expect(icon).toContain("box-sizing: border-box")
  })
  test("徽标与静音连接状态点存在（无辉光/呼吸动画引用）", () => {
    expect(css).toContain(".mafw-icon-rail-badge")
    expect(css).toContain(".mafw-icon-rail-conn-dot")
    const ready = css.match(/\.mafw-icon-rail-conn-dot\.ready \{[\s\S]*?\}/)?.[0] ?? ""
    expect(ready).not.toContain("mafw-breathe")
    expect(ready).not.toContain("box-shadow")
    expect(css).toContain(".mafw-icon-rail-conn-dot.reconnecting")
    expect(css).toContain(".mafw-icon-rail-conn-dot.failed")
    expect(css).toContain(".mafw-icon-rail-conn-dot.stopped")
  })
})
