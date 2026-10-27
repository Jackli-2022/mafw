import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { buildQuoteAnchor } from "./quote-anchor"

describe("buildQuoteAnchor（渲染预览划选 → quote 锚）", () => {
  test("普通选区 → quote + 前后文", () => {
    const a = buildQuoteAnchor("hello world foo bar baz", "foo")
    assert.deepEqual(a, { kind: "quote", quote: "foo", context: "hello world foo bar baz" })
  })
  test("长文 → 上下文各截 60 字符", () => {
    const before = "a".repeat(100)
    const after = "b".repeat(100)
    const a = buildQuoteAnchor(`${before}SELECTED${after}`, "SELECTED")
    assert.ok(a)
    assert.ok((a!.context ?? "").length <= 60 + "SELECTED".length + 60)
    assert.ok((a!.context ?? "").includes("SELECTED"))
  })
  test("跨行选区折叠空白并 trim", () => {
    const a = buildQuoteAnchor("x y z", "  y  z  ")
    assert.equal(a!.quote, "y z")
  })
  test("空/纯空白 → null", () => {
    assert.equal(buildQuoteAnchor("abc", "   "), null)
    assert.equal(buildQuoteAnchor("abc", ""), null)
  })
  test("超过 500 字符截断", () => {
    const a = buildQuoteAnchor("x", "y".repeat(800))
    assert.equal(a!.quote.length, 500)
  })
})
