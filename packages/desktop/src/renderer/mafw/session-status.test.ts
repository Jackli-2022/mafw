import { describe, expect, test } from "bun:test"
import { isWorkingStatus, sessionStatusFromInfo } from "./session-status"

describe("sessionStatusFromInfo（canonical MafwSessionStatus 字符串）", () => {
  test("规范 status 字段是唯一来源（gateway 已按 time.busy > time.idle 投影）", () => {
    expect(sessionStatusFromInfo({ id: "s1", status: "busy" })).toBe("busy")
    expect(sessionStatusFromInfo({ id: "s1", status: "idle" })).toBe("idle")
    // retry：等 provider 重试时仍是运行中
    expect(sessionStatusFromInfo({ id: "s1", status: "retry" })).toBe("retry")
  })

  test("不读原生 time.busy / time.idle（pi 没有这些时间戳）", () => {
    // 旧实现会因为 busy > idle 返回 busy；现在原生形状不是权威，缺 status = unknown
    expect(sessionStatusFromInfo({ time: { busy: 20, idle: 10 } })).toBe("unknown")
    expect(sessionStatusFromInfo({ time: { busy: 10, idle: 20 } })).toBe("unknown")
  })

  test("缺 status / 空输入 = unknown（不伪造 idle）", () => {
    expect(sessionStatusFromInfo({})).toBe("unknown")
    expect(sessionStatusFromInfo(null)).toBe("unknown")
    expect(sessionStatusFromInfo({ status: "weird" })).toBe("unknown")
  })

  test("已有本地状态时不覆盖（live 事件比取回的快照新）", () => {
    expect(sessionStatusFromInfo({ status: "busy" }, "idle")).toBe("idle")
    expect(sessionStatusFromInfo({ status: "idle" }, "busy")).toBe("busy")
    expect(sessionStatusFromInfo({ status: "busy" }, "retry")).toBe("retry")
  })

  test("返回值可直接交给 session-ui（字符串，不是 {type} 对象）", () => {
    expect(typeof sessionStatusFromInfo({})).toBe("string")
  })

  test("isWorkingStatus：busy / retry 都算运行中，idle / unknown 不算", () => {
    expect(isWorkingStatus("busy")).toBe(true)
    expect(isWorkingStatus("retry")).toBe(true)
    expect(isWorkingStatus("idle")).toBe(false)
    expect(isWorkingStatus("unknown")).toBe(false)
    expect(isWorkingStatus(undefined)).toBe(false)
  })
})
