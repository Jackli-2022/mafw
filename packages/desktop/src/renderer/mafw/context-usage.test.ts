// packages/desktop/src/renderer/mafw/context-usage.test.ts
import { describe, expect, test } from "bun:test"
import { computeContextUsage, formatContextUsage } from "./context-usage"

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

describe("formatContextUsage", () => {
  test("有窗口 → 百分比 + 统一 tooltip", () => {
    expect(formatContextUsage({ used: 676626, total: 1_000_000, percent: 68 })).toEqual({
      main: "68%",
      tooltip: "上下文: 677k / 1.0M (68%)",
    })
  })

  test("窗口未知 → 显示 token 数 + 同一措辞", () => {
    expect(formatContextUsage({ used: 1234, total: 0, percent: 0 })).toEqual({
      main: "1k",
      tooltip: "上下文: 1k tokens（窗口大小未知）",
    })
  })

  test("无数据 → — / 暂无数据", () => {
    expect(formatContextUsage({ used: 0, total: 0, percent: 0 })).toEqual({
      main: "—",
      tooltip: "上下文: 暂无数据",
    })
  })

  test("不足 1% 显示 <1%（避免歧义）", () => {
    expect(formatContextUsage({ used: 1200, total: 1_000_000, percent: 0 })).toEqual({
      main: "<1%",
      tooltip: "上下文: 1k / 1.0M (<1%)",
    })
  })
})
