import { describe, expect, test } from "bun:test"
import { watchKey, planWatchEvent, WATCH_DEBOUNCE_MS } from "./fs-watcher"

describe("fs-watcher 注册表纯逻辑", () => {
  test("watchKey 归一（root\\rel 反斜杠归一为正斜杠）", () => {
    expect(watchKey("C:\\proj", "src\\a.ts")).toBe("C:/proj::src/a.ts")
  })
  test("debounce 窗口内重复事件合并为一次推送", () => {
    expect(WATCH_DEBOUNCE_MS).toBe(300)
    expect(planWatchEvent({ lastSentAt: 1000, now: 1200 })).toBe("debounce")
    expect(planWatchEvent({ lastSentAt: 1000, now: 1400 })).toBe("send")
    expect(planWatchEvent({ lastSentAt: 0, now: 100 })).toBe("send")
  })
})
