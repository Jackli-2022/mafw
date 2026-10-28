// packages/session-ui/src/components/streaming-caret.test.ts
// 只有「消息最后一个 part」才允许渲染流式尾光标——避免每个 text 段后面都挂一个闪烁绿块。
import { describe, expect, test } from "bun:test"
import { shouldShowStreamingCaret } from "./streaming-caret"

describe("shouldShowStreamingCaret", () => {
  const base = { role: "assistant", messageCompleted: undefined, partEnd: undefined, isTailPart: true }

  test("assistant 未完成 + 尾部 part → true", () => {
    expect(shouldShowStreamingCaret(base)).toBe(true)
  })

  test("非尾部 part（后面还有 tool/text/reasoning）→ false", () => {
    expect(shouldShowStreamingCaret({ ...base, isTailPart: false })).toBe(false)
  })

  test("消息已完成 → false（即使历史 part 没有 time.end）", () => {
    expect(shouldShowStreamingCaret({ ...base, messageCompleted: 123 })).toBe(false)
  })

  test("part 自身已结束 → false", () => {
    expect(shouldShowStreamingCaret({ ...base, partEnd: 456 })).toBe(false)
  })

  test("user 消息 → false", () => {
    expect(shouldShowStreamingCaret({ ...base, role: "user" })).toBe(false)
  })
})
