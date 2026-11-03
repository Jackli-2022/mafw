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
  const loadedEmpty = { cursor: null, hasMore: false, loading: false }

  test("the active session is reusable only when history finished loading empty", () => {
    expect(
      reusableCreatorSession({
        activeSessionID: "s1",
        messagesBySession: { s1: [] },
        pageState: { s1: loadedEmpty },
      }),
    ).toBe("s1")
  })

  test("non-empty messages are never reused", () => {
    expect(
      reusableCreatorSession({
        activeSessionID: "s1",
        messagesBySession: { s1: [{}] },
        pageState: { s1: loadedEmpty },
      }),
    ).toBeNull()
  })

  test("a history load still in flight is not confirmation of an empty session", () => {
    // `openSessionTab` seeds `message[sid] = []`; without a completed page state
    // that seed must not be trusted (an existing conversation may be loading).
    expect(
      reusableCreatorSession({
        activeSessionID: "s1",
        messagesBySession: { s1: [] },
        pageState: {},
      }),
    ).toBeNull()
    expect(
      reusableCreatorSession({
        activeSessionID: "s1",
        messagesBySession: { s1: [] },
        pageState: { s1: { cursor: null, hasMore: false, loading: true } },
      }),
    ).toBeNull()
    expect(
      reusableCreatorSession({
        activeSessionID: "s1",
        messagesBySession: { s1: [] },
        pageState: { s1: { cursor: null, hasMore: true, loading: false } },
      }),
    ).toBeNull()
  })

  test("a failed or unset page state is not reusable", () => {
    // The failure path leaves the seeded `[]` and never writes pageState.
    expect(
      reusableCreatorSession({
        activeSessionID: "s1",
        messagesBySession: { s1: [] },
        pageState: {},
      }),
    ).toBeNull()
    expect(
      reusableCreatorSession({
        activeSessionID: "s1",
        messagesBySession: { s1: [] },
        pageState: { s1: { cursor: "cursor-2", hasMore: false, loading: false } },
      }),
    ).toBeNull()
  })

  test("no active session is not reusable", () => {
    expect(
      reusableCreatorSession({ activeSessionID: null, messagesBySession: {}, pageState: {} }),
    ).toBeNull()
    expect(
      reusableCreatorSession({
        activeSessionID: "",
        messagesBySession: { "": [] },
        pageState: { "": loadedEmpty },
      }),
    ).toBeNull()
  })
})
