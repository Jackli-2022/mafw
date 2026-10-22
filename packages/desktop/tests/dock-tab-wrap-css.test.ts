import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：RightDock 的 tab 换行必须真正可见。
// tabs-v2 库根是 height:100% + overflow:clip，仅给 tab-list 加 flex-wrap 会把
// 第二行（子代理/后台/文件/编辑器）裁掉（2026-10-22 实证：DOM 有 9 个 tab，视觉只有 5 个）。
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")

describe("right dock tab 换行可见性契约", () => {
  test("header 内的 tabs-v2 根放开固定高度与裁切", () => {
    expect(css).toContain('.mafw-right-dock-head [data-component="tabs-v2"]')
    expect(css).toContain("height: auto")
    expect(css).toContain("overflow: visible")
  })
  test("tab list 换行 + 不横向滚动（两行全部可见）", () => {
    expect(css).toContain('.mafw-right-dock-head [data-slot="tabs-v2-list"]')
    expect(css).toContain("flex-wrap: wrap")
  })
  test("换行后列表高度自适应（压过库的 pill 固定 32px 规则）", () => {
    // 2026-10-22 冒烟实证：库规则 specificity 0,4,0 固定 height:32px，列表纵向滚动，
    // 第一行 tab 被滚出可视区（只看到 文件/编辑器）。
    const block = css.match(/\.mafw-right-dock-head \[data-component="tabs-v2"\]\[data-variant="pill"\]\[data-orientation="horizontal"\] \[data-slot="tabs-v2-list"\] \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("height: auto")
    expect(block).toContain("flex-wrap: wrap")
    expect(block).toContain("overflow: visible")
  })
})
