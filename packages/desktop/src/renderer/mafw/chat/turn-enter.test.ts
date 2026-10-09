import { describe, expect, test } from "bun:test"
import { shouldAnimateTail, tailIdOf } from "./turn-enter"

describe("tailIdOf", () => {
  test("null for empty, last id otherwise", () => {
    expect(tailIdOf([])).toBe(null)
    expect(tailIdOf([{ id: "a" }, { id: "b" }])).toBe("b")
  })
})

describe("shouldAnimateTail", () => {
  test("only true when a non-null tail changes", () => {
    expect(shouldAnimateTail(null, "a")).toBe(false)   // 首次水合
    expect(shouldAnimateTail("a", "a")).toBe(false)     // tail 未变（流式更新/翻旧页）
    expect(shouldAnimateTail("a", "b")).toBe(true)      // 追加新 turn
    expect(shouldAnimateTail("a", null)).toBe(false)    // 清空
  })
})
