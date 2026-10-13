import { describe, expect, test } from "bun:test"
import { stripOverflowed } from "./session-strip-overflow"

describe("stripOverflowed", () => {
  test("无元素 → false", () => {
    expect(stripOverflowed(null)).toBe(false)
    expect(stripOverflowed(undefined)).toBe(false)
  })
  test("内容不超出 → false（含等宽与 1px 子像素容差）", () => {
    expect(stripOverflowed({ scrollWidth: 500, clientWidth: 500 })).toBe(false)
    expect(stripOverflowed({ scrollWidth: 501, clientWidth: 500 })).toBe(false)
  })
  test("内容超出 → true", () => {
    expect(stripOverflowed({ scrollWidth: 502, clientWidth: 500 })).toBe(true)
  })
})
