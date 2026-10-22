import { describe, expect, test } from "bun:test"
import { buildBackgroundNotice } from "./background-notify"

const row = (status: any, type: "shell" | "subagent" = "shell", label = "npm run dev") =>
  ({ id: "sh1", type, sessionID: "s1", label, status, startedAt: 0, endedAt: 1 })

describe("buildBackgroundNotice", () => {
  test("completed：toast 恒有；hidden 时附 OS", () => {
    expect(buildBackgroundNotice(row("completed"), { hidden: false })).toEqual({ toast: "后台任务完成：npm run dev" })
    expect(buildBackgroundNotice(row("completed"), { hidden: true })!.os).toEqual({ title: "MAFW：后台任务完成", body: "npm run dev" })
  })
  test("failed：失败语义文案", () => {
    expect(buildBackgroundNotice(row("failed"), { hidden: false })!.toast).toBe("后台任务失败：npm run dev")
  })
  test("cancelled / running：null（静默）", () => {
    expect(buildBackgroundNotice(row("cancelled"), { hidden: true })).toBeNull()
    expect(buildBackgroundNotice(row("running"), { hidden: true })).toBeNull()
  })
  test("builder 不做 kind 区分（subagent 行的通知抑制在接线层——P0-1 通道负责）", () => {
    expect(buildBackgroundNotice(row("completed", "subagent"), { hidden: false })!.toast).toBe("后台任务完成：npm run dev")
  })
})
