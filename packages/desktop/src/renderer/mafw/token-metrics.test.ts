// packages/desktop/src/renderer/mafw/token-metrics.test.ts
import { describe, expect, test } from "bun:test"
import { cacheHitRate, totalTokens } from "./token-metrics"

describe("token metrics", () => {
  test("totalTokens 含 cache.read / cache.write", () => {
    expect(totalTokens({ input: 10, output: 2, reasoning: 1, cache: { read: 100, write: 5 } })).toBe(118)
    expect(totalTokens(null)).toBe(0)
  })

  test("cacheHitRate 只算 prompt 侧（input+read+write）", () => {
    // 用户例子：input 49k / cache read 35k → 35/(49+35) ≈ 42%
    expect(cacheHitRate({ input: 49_000, cache: { read: 35_000 } })).toBe(42)
  })

  test("cache.write 计入分母", () => {
    expect(cacheHitRate({ input: 0, cache: { read: 50, write: 50 } })).toBe(50)
  })

  test("无 prompt token → 0", () => {
    expect(cacheHitRate({ output: 100 })).toBe(0)
  })
})
