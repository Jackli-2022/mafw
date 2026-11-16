import { describe, expect, test } from "bun:test"
import { buildTerminalNotice } from "./subagent-notify"

const row = (status: any, title = "调研登录 @explore") => ({ childID: "c1", parentID: "p", title, agent: "explore", status, startedAt: 0, endedAt: 1 })

describe("buildTerminalNotice（应用内 toast；OS 通知归事务层）", () => {
  test("completed：完成文案", () => {
    expect(buildTerminalNotice(row("completed"))).toBe("子代理完成：调研登录 @explore")
  })
  test("failed：失败语义文案", () => {
    expect(buildTerminalNotice(row("failed"))).toBe("子代理失败：调研登录 @explore")
  })
  test("aborted / running：null（静默）", () => {
    expect(buildTerminalNotice(row("aborted"))).toBeNull()
    expect(buildTerminalNotice(row("running"))).toBeNull()
  })
})
