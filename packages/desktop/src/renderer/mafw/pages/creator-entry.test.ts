import { describe, expect, test } from "bun:test"
import {
  creatorEntryReasonText,
  creatorEntryState,
  reusableCreatorSession,
  type ReusableCreatorSessionInput,
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
  const project = "C:\\work\\look"

  /** A blank, loaded, ordinary project session — the only reusable shape. */
  function blankSession(overrides: Partial<ReusableCreatorSessionInput> = {}): ReusableCreatorSessionInput {
    return {
      activeSessionID: "s1",
      messagesBySession: { s1: [] },
      pageState: { s1: loadedEmpty },
      activeSessionRole: undefined,
      activeSessionDirectory: project,
      projectRoot: project,
      ...overrides,
    }
  }

  test("the active session is reusable only when history finished loading empty", () => {
    expect(reusableCreatorSession(blankSession())).toBe("s1")
  })

  test("path comparison follows workbench-root normalization", () => {
    // Same directory written with forward slashes / a trailing separator / other case.
    expect(reusableCreatorSession(blankSession({ activeSessionDirectory: "C:/WORK/look/" }))).toBe("s1")
    expect(reusableCreatorSession(blankSession({ projectRoot: "C:/work/look/" }))).toBe("s1")
  })

  test("non-empty messages are never reused", () => {
    expect(reusableCreatorSession(blankSession({ messagesBySession: { s1: [{}] } }))).toBeNull()
  })

  test("a history load still in flight is not confirmation of an empty session", () => {
    // `openSessionTab` seeds `message[sid] = []`; without a completed page state
    // that seed must not be trusted (an existing conversation may be loading).
    expect(reusableCreatorSession(blankSession({ pageState: {} }))).toBeNull()
    expect(
      reusableCreatorSession(blankSession({ pageState: { s1: { cursor: null, hasMore: false, loading: true } } })),
    ).toBeNull()
    expect(
      reusableCreatorSession(blankSession({ pageState: { s1: { cursor: null, hasMore: true, loading: false } } })),
    ).toBeNull()
  })

  test("a failed or unset page state is not reusable", () => {
    // The failure path leaves the seeded `[]` and never writes pageState.
    expect(reusableCreatorSession(blankSession({ pageState: {} }))).toBeNull()
    expect(
      reusableCreatorSession(blankSession({ pageState: { s1: { cursor: "cursor-2", hasMore: false, loading: false } } })),
    ).toBeNull()
  })

  test("no active session is not reusable", () => {
    expect(reusableCreatorSession({ activeSessionID: null, messagesBySession: {}, pageState: {} })).toBeNull()
    expect(reusableCreatorSession(blankSession({ activeSessionID: "" }))).toBeNull()
  })

  test("Lead and manager sessions are never hijacked", () => {
    // The Lead tab can be empty and selected: switching it to mafw-create would
    // take over the coordination session itself.
    expect(reusableCreatorSession(blankSession({ activeSessionRole: "lead" }))).toBeNull()
    expect(reusableCreatorSession(blankSession({ activeSessionRole: "manager" }))).toBeNull()
    // Any other role (normal user sessions carry none) may be reused.
    expect(reusableCreatorSession(blankSession({ activeSessionRole: undefined }))).toBe("s1")
  })

  test("only a directory inside the project root is reusable", () => {
    // Lead/manager sessions can live in a hash dir outside the project, so the
    // drafts would not land under the promised project path.
    expect(reusableCreatorSession(blankSession({ activeSessionDirectory: "C:/Users/x/.local/state/abc123" }))).toBeNull()
    // Worktree siblings are outside the project (and already gated upstream).
    expect(reusableCreatorSession(blankSession({ activeSessionDirectory: "C:\\work\\look-wt-feature" }))).toBeNull()
    // Missing / placeholder directories cannot prove the project root.
    expect(reusableCreatorSession(blankSession({ activeSessionDirectory: null }))).toBeNull()
    expect(reusableCreatorSession(blankSession({ activeSessionDirectory: undefined }))).toBeNull()
    expect(reusableCreatorSession(blankSession({ activeSessionDirectory: "." }))).toBeNull()
    // No project root means no comparison is possible: fail closed.
    expect(reusableCreatorSession(blankSession({ projectRoot: null }))).toBeNull()
  })

  test("a nested project directory under the root stays reusable", () => {
    expect(reusableCreatorSession(blankSession({ activeSessionDirectory: "C:/work/look/packages/app" }))).toBe("s1")
  })
})
