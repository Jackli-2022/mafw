import { describe, expect, test } from "bun:test"
import { isAbnormalStop, normalizeStopReason, stopReasonLabel } from "./stop-reason"

describe("stop-reason", () => {
  test("raw finish 归一", () => {
    expect(normalizeStopReason("stop")).toBe("end_turn")
    expect(normalizeStopReason("length")).toBe("max_tokens")
    expect(normalizeStopReason("tool-calls")).toBe("tool_use")
    expect(normalizeStopReason("content-filter")).toBe("refusal")
    expect(normalizeStopReason("interrupted")).toBe("cancelled")
  })

  test("canonical 值幂等", () => {
    expect(normalizeStopReason("max_tokens")).toBe("max_tokens")
    expect(normalizeStopReason("cancelled")).toBe("cancelled")
    expect(normalizeStopReason("end_turn")).toBe("end_turn")
  })

  test("labels 与异常判定", () => {
    expect(stopReasonLabel("max_tokens")).toBe("达到输出上限")
    expect(stopReasonLabel("refusal")).toBe("内容被过滤")
    expect(stopReasonLabel("end_turn")).toBe("")
    expect(isAbnormalStop("end_turn")).toBe(false)
    expect(isAbnormalStop("tool_use")).toBe(false)
    expect(isAbnormalStop("unknown")).toBe(false)
    expect(isAbnormalStop("cancelled")).toBe(true)
    expect(isAbnormalStop("error")).toBe(true)
  })
})
