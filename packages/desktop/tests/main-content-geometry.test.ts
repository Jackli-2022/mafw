import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：main 内的 content 必须铺满 main（不能依赖 :only-child——chat resize handle
// 是第二个子元素会使其失效，内容掉进 grid-row 2 的 auto 行：实测 1060px main 里只有 233px 高）。
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")

describe("main/content 尺寸一致", () => {
  test("content 显式跨越 main 的全部行", () => {
    const block = css.match(/\.mafw-content \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("grid-row: 1 / -1")
  })
})
