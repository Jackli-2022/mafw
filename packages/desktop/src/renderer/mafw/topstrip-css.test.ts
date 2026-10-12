import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "mafw.css"), "utf8")

/** 样式契约：顶行溢出护栏——session tab 增多时 strip 内滚，
 *  窗口控制按钮（flex-shrink:0）绝不被推出可视列宽。
 *  根因链：shell 第二列 1fr = minmax(auto,1fr)，顶行 grid item 的
 *  auto 最小尺寸被 tab min-content 撑大 → 整条 topstrip 超宽。 */
describe("topstrip overflow guards", () => {
  test("shell 右列为 minmax(0, 1fr)——grid 轨道可被压缩到 0", () => {
    expect(css).toMatch(/\.mafw-shell\s*\{[^}]*grid-template-columns:\s*var\(--rail-w[^)]*\)\s+minmax\(0,\s*1fr\)/)
  })

  test("顶行作为 grid item 有 min-width: 0（否则 auto 最小尺寸撑破轨道）", () => {
    expect(css).toMatch(/\.mafw-topstrip\s*\{[^}]*min-width:\s*0/)
  })

  test("sessionstrip 可缩且内滚（flex 收缩 + min-width:0 + overflow-x:auto）", () => {
    const block = css.match(/\.mafw-sessionstrip\s*\{([^}]*)\}/)
    expect(block).not.toBeNull()
    expect(block![1]).toMatch(/min-width:\s*0/)
    expect(block![1]).toMatch(/overflow-x:\s*auto/)
    expect(block![1]).toMatch(/flex:\s*1 1 auto/)
  })

  test("窗口控制永不收缩", () => {
    expect(css).toMatch(/\.mafw-window-controls\s*\{[^}]*flex-shrink:\s*0/)
  })
})
