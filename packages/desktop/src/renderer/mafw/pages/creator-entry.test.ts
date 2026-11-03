import { describe, expect, test } from "bun:test"
import {
  creatorEntryReasonText,
  creatorEntryState,
  reusableCreatorSession,
} from "./creator-entry"

describe("creator entry state", () => {
  test("loading agents wins over every other reason", () => {
    expect(creatorEntryState({ agentsLoaded: false, hasCreator: false, isWorktree: false }))
      .toEqual({ available: false, reason: "loading" })
    expect(creatorEntryState({ agentsLoaded: false, hasCreator: true, isWorktree: true }))
      .toEqual({ available: false, reason: "loading" })
  })

  test("missing mafw-create disables the entry", () => {
    expect(creatorEntryState({ agentsLoaded: true, hasCreator: false, isWorktree: false }))
      .toEqual({ available: false, reason: "no-agent" })
  })

  test("worktree sessions are not offered the entry", () => {
    expect(creatorEntryState({ agentsLoaded: true, hasCreator: true, isWorktree: true }))
      .toEqual({ available: false, reason: "worktree" })
  })

  test("an ordinary project session with the agent is available", () => {
    expect(creatorEntryState({ agentsLoaded: true, hasCreator: true, isWorktree: false }))
      .toEqual({ available: true })
  })

  test("every disabled reason has neutral copy", () => {
    expect(creatorEntryReasonText("loading")).toBe("正在加载 Agent 列表…")
    expect(creatorEntryReasonText("no-agent")).toBe("当前 runtime 未提供 mafw-create")
    expect(creatorEntryReasonText("worktree")).toBe("并行 worktree 会话不提供创建入口")
    expect(creatorEntryReasonText(undefined)).toBe("")
  })
})

describe("reusable creator session", () => {
  test("the active session is reusable only when it has no messages", () => {
    expect(reusableCreatorSession({ activeSessionID: "s1", messagesBySession: { s1: [] } })).toBe("s1")
    expect(reusableCreatorSession({ activeSessionID: "s1", messagesBySession: { s1: [{}] } })).toBeNull()
  })

  test("no active session or an unloaded message list is not reusable", () => {
    expect(reusableCreatorSession({ activeSessionID: null, messagesBySession: {} })).toBeNull()
    expect(reusableCreatorSession({ activeSessionID: "", messagesBySession: { "": [] } })).toBeNull()
    expect(reusableCreatorSession({ activeSessionID: "s1", messagesBySession: {} })).toBeNull()
  })
})
