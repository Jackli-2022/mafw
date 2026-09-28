import { describe, test, expect } from "bun:test"
import { formatComposerMeta } from "./composer-meta"

describe("formatComposerMeta", () => {
  test("空闲无数据返回空串", () => {
    expect(formatComposerMeta({ elapsedMs: null, tokens: null, streaming: false })).toBe("")
  })
  test("streaming 显示实时耗时与 token", () => {
    expect(formatComposerMeta({ elapsedMs: 8300, tokens: 1234, streaming: true })).toBe("8s · 1234 tok")
  })
  test("分钟格式化", () => {
    expect(formatComposerMeta({ elapsedMs: 95000, tokens: 12000, streaming: true })).toBe("1m 35s · 12.0k tok")
  })
  test("仅耗时无 token", () => {
    expect(formatComposerMeta({ elapsedMs: 5000, tokens: null, streaming: true })).toBe("5s")
  })
  test("非 streaming 且完成态冻结显示", () => {
    expect(formatComposerMeta({ elapsedMs: 42000, tokens: 500, streaming: false })).toBe("42s · 500 tok")
  })
})
