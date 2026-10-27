import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { jsonEntries, jsonSummary, parseJsonSafe } from "./json-tree"

describe("parseJsonSafe", () => {
  test("合法 JSON → ok", () => {
    const r = parseJsonSafe('{"a":1,"b":[true,null]}')
    assert.equal(r.ok, true)
    if (r.ok) assert.deepEqual(r.value, { a: 1, b: [true, null] })
  })
  test("非法 JSON → error 文本（不抛）", () => {
    const r = parseJsonSafe("{oops")
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.error.length > 0)
  })
  test("空文本 → error", () => {
    assert.equal(parseJsonSafe("   ").ok, false)
  })
})

describe("jsonSummary", () => {
  test("对象/数组/原始值", () => {
    assert.equal(jsonSummary({ a: 1, b: 2 }), "{2}")
    assert.equal(jsonSummary([1, 2, 3]), "[3]")
    assert.equal(jsonSummary("x"), '"x"')
    assert.equal(jsonSummary(12), "12")
    assert.equal(jsonSummary(null), "null")
  })
})

describe("jsonEntries（层级渲染 + 上限）", () => {
  test("对象/数组条目", () => {
    const obj = jsonEntries({ a: 1, b: 2 }, 10)
    assert.deepEqual(obj.items.map(([k]) => k), ["a", "b"])
    assert.equal(obj.truncated, 0)
    const arr = jsonEntries([5, 6], 10)
    assert.deepEqual(arr.items.map(([k]) => k), ["0", "1"])
  })
  test("超过上限 → 截断计数", () => {
    const big = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, i]))
    const r = jsonEntries(big, 3)
    assert.equal(r.items.length, 3)
    assert.equal(r.truncated, 5)
  })
  test("原始值 → 无条目", () => {
    assert.deepEqual(jsonEntries(42, 10), { items: [], truncated: 0 })
  })
})
