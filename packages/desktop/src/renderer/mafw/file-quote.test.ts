// B2（W5b）：选区引用 → composer 引文块（纯构建）。
import { describe, expect, test } from "bun:test"
import { buildFileQuote } from "./file-quote"

describe("buildFileQuote", () => {
  test("单行引文 → blockquote + 来源", () => {
    const q = buildFileQuote("docs/a.md", "这行要改")
    expect(q).toContain("> 这行要改")
    expect(q).toContain("引用自 `docs/a.md`")
  })
  test("多行逐行加 > 前缀", () => {
    const q = buildFileQuote("a.txt", "l1\nl2\nl3")
    expect(q).toBe("> l1\n> l2\n> l3\n\n引用自 `a.txt`")
  })
  test("行号范围（可选）", () => {
    const q = buildFileQuote("a.md", "x", { startLine: 5, endLine: 9 })
    expect(q).toContain("第 5-9 行")
  })
  test("超长截断带标记", () => {
    const q = buildFileQuote("a.md", "x".repeat(3000))
    expect(q.length).toBeLessThan(2100)
    expect(q).toContain("截断")
  })
  test("空文本 → 空串（调用方不插入）", () => {
    expect(buildFileQuote("a.md", "   ")).toBe("")
  })
})
