import { describe, expect, test } from "bun:test"
import { errorText } from "./error-text"

describe("errorText (跨 runtime 错误归一)", () => {
  test("字符串原样返回", () => {
    expect(errorText("Tool failed: boom")).toBe("Tool failed: boom")
  })

  test("opencode 2.1 的 {type,message} 对象取 message", () => {
    expect(errorText({ type: "tool.execution", message: "Could not find oldString" })).toBe("Could not find oldString")
  })

  test("嵌套 data.message（旧 message.error 形状）", () => {
    expect(errorText({ name: "MessageAbortedError", data: { message: "aborted" } })).toBe("aborted")
  })

  test("只有 type / 纯对象兜底为字符串，不返回 [object Object]", () => {
    expect(errorText({ type: "provider.auth" })).toBe("provider.auth")
    expect(errorText({ weird: 1 })).toBe('{"weird":1}')
  })

  test("null/undefined → 空串", () => {
    expect(errorText(null)).toBe("")
    expect(errorText(undefined)).toBe("")
  })
})
