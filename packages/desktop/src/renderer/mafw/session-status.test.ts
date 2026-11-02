import { describe, expect, test } from "bun:test"
import { sessionStatusFromInfo } from "./session-status"

describe("sessionStatusFromInfo（canonical MafwSessionStatus 字符串）", () => {
  test("busy 晚于 idle → busy（中途进入运行中的会话）", () => {
    expect(sessionStatusFromInfo({ time: { busy: 20, idle: 10 } })).toBe("busy")
  })

  test("idle 不早于 busy → idle", () => {
    expect(sessionStatusFromInfo({ time: { busy: 10, idle: 20 } })).toBe("idle")
    expect(sessionStatusFromInfo({ time: { busy: 10, idle: 10 } })).toBe("idle")
  })

  test("没有 time / 没有 busy → idle", () => {
    expect(sessionStatusFromInfo({})).toBe("idle")
    expect(sessionStatusFromInfo(null)).toBe("idle")
    expect(sessionStatusFromInfo({ time: { idle: 5 } })).toBe("idle")
  })

  test("已有本地状态时不覆盖（live 事件比取回的快照新）", () => {
    expect(sessionStatusFromInfo({ time: { busy: 20, idle: 10 } }, "idle")).toBe("idle")
    expect(sessionStatusFromInfo({ time: { busy: 10, idle: 20 } }, "busy")).toBe("busy")
  })

  test("返回值可直接交给 session-ui（字符串，不是 {type} 对象）", () => {
    expect(typeof sessionStatusFromInfo({})).toBe("string")
  })
})
