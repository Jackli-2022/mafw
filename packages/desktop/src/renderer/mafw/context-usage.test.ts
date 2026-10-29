// packages/desktop/src/renderer/mafw/context-usage.test.ts
import { describe, expect, test } from "bun:test"
import { computeContextUsage } from "./context-usage"

describe("computeContextUsage", () => {
  test("缓存命中计入上下文（input 很小但 cache.read 很大）", () => {
    const u = computeContextUsage({ input: 914, cache: { read: 675712 } }, 1_000_000)
    expect(u.used).toBe(676626)
    expect(u.total).toBe(1_000_000)
    expect(u.percent).toBe(68)
  })

  test("cache.write 也计入", () => {
    const u = computeContextUsage({ input: 100, cache: { read: 0, write: 400 } }, 1000)
    expect(u.used).toBe(500)
    expect(u.percent).toBe(50)
  })

  test("无 tokens → 0，窗口未知 → total=0 / percent=0", () => {
    expect(computeContextUsage(null, 1_000_000)).toEqual({ used: 0, total: 1_000_000, percent: 0 })
    const u = computeContextUsage({ input: 1234 }, 0)
    expect(u).toEqual({ used: 1234, total: 0, percent: 0 })
  })

  test("小数百分比四舍五入", () => {
    expect(computeContextUsage({ input: 1 }, 3).percent).toBe(33)
  })
})
