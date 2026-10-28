// C2（inputbar 空历史提示）：历史为空时 ↑/↓ 完全无反应易被当成「坏了」——
// 每会话一次轻提示（toast）。纯门函数 + ChatPane wiring。
import { describe, expect, test } from "bun:test"
import { shouldHintEmptyHistory } from "./input-history"

describe("shouldHintEmptyHistory（C2 空历史一次性提示门）", () => {
  test("历史空 + 未提示过 → true", () => {
    expect(shouldHintEmptyHistory(0, false)).toBe(true)
  })
  test("历史空 + 已提示过 → false（每会话一次）", () => {
    expect(shouldHintEmptyHistory(0, true)).toBe(false)
  })
  test("历史非空 → false（↑/↓ 正常翻历史，不需要提示）", () => {
    expect(shouldHintEmptyHistory(3, false)).toBe(false)
  })
})
