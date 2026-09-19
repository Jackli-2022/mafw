import { describe, test, expect } from "bun:test"
import { thinkingLabel, thinkingDurationSec } from "../src/renderer/mafw/components/thinking-label"

describe("thinkingLabel", () => {
  test("流式中", () => expect(thinkingLabel({ streaming: true, durationSec: null })).toBe("思考中…"))
  test("完成带时长", () => expect(thinkingLabel({ streaming: false, durationSec: 12 })).toBe("已思考 12s"))
  test("完成无时长", () => expect(thinkingLabel({ streaming: false, durationSec: null })).toBe("已思考"))
})

describe("thinkingDurationSec", () => {
  test("start/end 计算", () => expect(thinkingDurationSec({ start: 1000, end: 13000 })).toBe(12))
  test("未结束用 now", () => expect(thinkingDurationSec({ start: 0 }, 5000)).toBe(5))
  test("缺 start 返回 null", () => expect(thinkingDurationSec(undefined)).toBeNull())
  test("最小 1s", () => expect(thinkingDurationSec({ start: 1000, end: 1200 })).toBe(1))
})
