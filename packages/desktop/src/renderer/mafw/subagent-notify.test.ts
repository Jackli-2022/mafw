import { describe, expect, test } from "bun:test"
import { buildTerminalNotice, createNotifyGate } from "./subagent-notify"

const row = (status: any, title = "调研登录 @explore") => ({ childID: "c1", parentID: "p", title, agent: "explore", status, startedAt: 0, endedAt: 1 })

describe("buildTerminalNotice", () => {
  test("completed：toast 恒有；hidden 时附 OS", () => {
    expect(buildTerminalNotice(row("completed"), { hidden: false })).toEqual({ toast: "子代理完成：调研登录 @explore" })
    expect(buildTerminalNotice(row("completed"), { hidden: true })!.os).toEqual({ title: "MAFW：子代理完成", body: "调研登录 @explore" })
  })
  test("failed：失败语义文案", () => {
    expect(buildTerminalNotice(row("failed"), { hidden: false })!.toast).toBe("子代理失败：调研登录 @explore")
  })
  test("aborted / running：null（静默）", () => {
    expect(buildTerminalNotice(row("aborted"), { hidden: true })).toBeNull()
    expect(buildTerminalNotice(row("running"), { hidden: true })).toBeNull()
  })
})

describe("createNotifyGate（OS 通知 10s 全局门）", () => {
  test("窗口内只放一条，窗口外放行", () => {
    const gate = createNotifyGate(10_000)
    expect(gate(0)).toBe(true)
    expect(gate(9_999)).toBe(false)
    expect(gate(10_000)).toBe(true)
    expect(gate(10_001)).toBe(false)
  })
})
