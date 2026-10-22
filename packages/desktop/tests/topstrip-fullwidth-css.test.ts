import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 契约：会话 tab 条必须横跨整窗顶部（含图标轨上方），图标轨从顶条下方开始。
const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")

describe("topstrip 整窗宽度", () => {
  test("topstrip 跨全部列", () => {
    const block = css.match(/\.mafw-topstrip \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("grid-column: 1 / -1")
  })
  test("图标轨只占第 2 行（顶条下方），不占顶行", () => {
    const block = css.match(/\.mafw-rail-col \{[\s\S]*?\}/)?.[0] ?? ""
    expect(block).toContain("grid-row: 2")
    expect(block).not.toContain("grid-row: 1 / -1")
  })
})
