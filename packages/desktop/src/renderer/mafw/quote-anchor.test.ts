import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { buildQuoteAnchor } from "./quote-anchor"

describe("buildQuoteAnchor（渲染预览划选 → quote 锚）", () => {
  test("普通选区 → quote", () => {
    assert.deepEqual(buildQuoteAnchor("foo"), { kind: "quote", quote: "foo" })
  })
  test("跨行选区折叠空白并 trim（M3）", () => {
    const a = buildQuoteAnchor("  y\n  z  ")
    assert.equal(a!.quote, "y z")
  })
  test("空/纯空白 → null", () => {
    assert.equal(buildQuoteAnchor("   "), null)
    assert.equal(buildQuoteAnchor(""), null)
  })
  test("超过 500 字符截断", () => {
    const a = buildQuoteAnchor("y".repeat(800))
    assert.equal(a!.quote.length, 500)
  })
})
