import { describe, expect, test } from "bun:test"
import { sessionStatusFromInfo } from "./session-status"

describe("sessionStatusFromInfo", () => {
  test("busy 晚于 idle → busy（中途进入运行中的会话）", () => {
    expect(sessionStatusFromInfo({ time: { busy: 20, idle: 10 } })).toEqual({ type: "busy" })
  })

  test("idle 不早于 busy → idle", () => {
    expect(sessionStatusFromInfo({ time: { busy: 10, idle: 20 } })).toEqual({ type: "idle" })
    expect(sessionStatusFromInfo({ time: { busy: 10, idle: 10 } })).toEqual({ type: "idle" })
  })

  test("没有 time / 没有 busy → idle", () => {
    expect(sessionStatusFromInfo({})).toEqual({ type: "idle" })
    expect(sessionStatusFromInfo(null)).toEqual({ type: "idle" })
    expect(sessionStatusFromInfo({ time: { idle: 5 } })).toEqual({ type: "idle" })
  })

  test("已有本地状态时不覆盖（live 事件比取回的快照新）", () => {
    expect(sessionStatusFromInfo({ time: { busy: 20, idle: 10 } }, { type: "idle" })).toEqual({ type: "idle" })
    expect(sessionStatusFromInfo({ time: { busy: 10, idle: 20 } }, { type: "busy" })).toEqual({ type: "busy" })
  })
})
