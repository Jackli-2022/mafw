import { describe, expect, test } from "bun:test"
import { errorCardText, isAbortMessageError, isCanonicalMessageError } from "./session-error"

/**
 * Task 9 round 2（过渡期）：desktop 仍写 wire `{name,data:{message}}`。
 * 规范形守卫必须阻止空红卡，同时保留 abort 判定与 stop hint 的输入。
 */
describe("session error（规范形守卫）", () => {
  test("wire 形状不渲染错误卡（不会被当成规范 error）", () => {
    const wired = { name: "ApiError", data: { message: "429 Too Many Requests" } }

    expect(isCanonicalMessageError(wired)).toBe(false)
    expect(errorCardText(wired)).toBeUndefined()
    // wire abort 也不参与中止判定（沿用 stop hint 表达，不误判）
    expect(isAbortMessageError({ name: "MessageAbortedError", data: { message: "Interrupted" } })).toBe(false)
  })

  test("规范 provider 错误 → 卡片文本（保留原文）", () => {
    const error = { kind: "provider", message: "invalid api key" }
    expect(isCanonicalMessageError(error)).toBe(true)
    expect(errorCardText(error)).toBe("invalid api key")
  })

  test("规范 abort 错误 → 不出卡片（divider/stop hint 表达）", () => {
    const error = { kind: "abort", message: "Interrupted by user" }
    expect(isAbortMessageError(error)).toBe(true)
    expect(errorCardText(error)).toBeUndefined()
  })

  test("规范但 message 为空 → 不渲染空卡", () => {
    expect(errorCardText({ kind: "error", message: "" })).toBeUndefined()
    expect(errorCardText({ kind: "error", message: "   " })).toBeUndefined()
    expect(errorCardText({ kind: "error" })).toBeUndefined()
  })

  test("非对象输入安全", () => {
    for (const value of [undefined, null, "boom", 42, false]) {
      expect(isCanonicalMessageError(value)).toBe(false)
      expect(errorCardText(value)).toBeUndefined()
      expect(isAbortMessageError(value)).toBe(false)
    }
  })
})
