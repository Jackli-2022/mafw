import { describe, expect, test } from "bun:test"
import { findPendingToolPart, flowCardInitialExpanded, inlineAnchor, isTopLevelToolEntry, type ToolPartLike } from "./flow-card-placement"

describe("flowCardInitialExpanded", () => {
  test("pending 展开（操作点）", () => {
    expect(flowCardInitialExpanded("pending")).toBe(true)
  })

  test("已处理状态默认收起", () => {
    for (const s of ["allowed-once", "allowed-always", "denied", "expired", "answered", "cancelled"]) {
      expect(flowCardInitialExpanded(s)).toBe(false)
    }
  })
})

const tool = (over: Partial<ToolPartLike> = {}): ToolPartLike => ({
  type: "tool",
  callID: "call-1",
  tool: "bash",
  state: { status: "running" },
  ...over,
})

describe("isTopLevelToolEntry（镜像 session-ui groupParts 顶层条目规则）", () => {
  test("普通工具（bash/edit）是顶层条目", () => {
    expect(isTopLevelToolEntry(tool())).toBe(true)
    expect(isTopLevelToolEntry(tool({ tool: "edit" }))).toBe(true)
  })

  test("context 组工具（read/glob/grep/list）不是顶层条目", () => {
    for (const t of ["read", "glob", "grep", "list"]) {
      expect(isTopLevelToolEntry(tool({ tool: t }))).toBe(false)
    }
  })

  test("todowrite 隐藏，不是顶层条目", () => {
    expect(isTopLevelToolEntry(tool({ tool: "todowrite" }))).toBe(false)
  })

  test("pending/running 的 question 工具不渲染，不是顶层条目；completed 是", () => {
    expect(isTopLevelToolEntry(tool({ tool: "question", state: { status: "pending" } }))).toBe(false)
    expect(isTopLevelToolEntry(tool({ tool: "question", state: { status: "running" } }))).toBe(false)
    expect(isTopLevelToolEntry(tool({ tool: "question", state: { status: "completed" } }))).toBe(true)
  })

  test("非 tool part 永远不是", () => {
    expect(isTopLevelToolEntry({ type: "text" })).toBe(false)
  })
})

describe("inlineAnchor", () => {
  const partsOf = (mid: string): ToolPartLike[] =>
    mid === "msg-a" ? [tool({ callID: "call-1" })] : []

  test("callID 匹配到顶层工具卡 → 返回锚点", () => {
    expect(inlineAnchor({ messageID: "msg-a", callID: "call-1" }, partsOf)).toEqual({
      messageID: "msg-a",
      callID: "call-1",
    })
  })

  test("缺 callID / 缺 messageID → null（走回合底部兜底）", () => {
    expect(inlineAnchor({ messageID: "msg-a" }, partsOf)).toBeNull()
    expect(inlineAnchor({ callID: "call-1" }, partsOf)).toBeNull()
    expect(inlineAnchor({}, partsOf)).toBeNull()
  })

  test("锚 part 尚未加载（历史分页未拉取）→ null", () => {
    expect(inlineAnchor({ messageID: "msg-x", callID: "call-1" }, partsOf)).toBeNull()
  })

  test("锚 part 是 context 组工具 → null（卡在组内，钩子不触发）", () => {
    const readParts = (mid: string): ToolPartLike[] =>
      mid === "msg-a" ? [tool({ tool: "read", callID: "call-1" })] : []
    expect(inlineAnchor({ messageID: "msg-a", callID: "call-1" }, readParts)).toBeNull()
  })

  test("锚 part 是 pending question → null（问题卡保持回合底部兜底）", () => {
    const qParts = (mid: string): ToolPartLike[] =>
      mid === "msg-a" ? [tool({ tool: "question", callID: "call-1", state: { status: "pending" } })] : []
    expect(inlineAnchor({ messageID: "msg-a", callID: "call-1" }, qParts)).toBeNull()
  })
})

describe("findPendingToolPart（asked 事件反查 tool 链接：事件不带 tool 字段时从 store parts 恢复内联锚点）", () => {
  const partsOf = (map: Record<string, ToolPartLike[]>) => (mid: string) => map[mid] || []

  test("pending 的同名工具 part → 返回锚点", () => {
    const map = { "msg-a": [tool({ tool: "bash", callID: "call-1", state: { status: "pending" } })] }
    expect(findPendingToolPart("bash", partsOf(map), ["msg-a"])).toEqual({ messageID: "msg-a", callID: "call-1" })
  })

  test("工具名不匹配 → null", () => {
    const map = { "msg-a": [tool({ tool: "edit", callID: "call-1", state: { status: "pending" } })] }
    expect(findPendingToolPart("bash", partsOf(map), ["msg-a"])).toBeNull()
  })

  test("part 已完成（running/completed）→ null（不是本次待审请求）", () => {
    const map = { "msg-a": [tool({ tool: "bash", callID: "call-1", state: { status: "running" } })] }
    expect(findPendingToolPart("bash", partsOf(map), ["msg-a"])).toBeNull()
  })

  test("多个命中取最后一个（最新回合）", () => {
    const map = {
      "msg-a": [tool({ tool: "bash", callID: "call-old", state: { status: "pending" } })],
      "msg-b": [tool({ tool: "bash", callID: "call-new", state: { status: "pending" } })],
    }
    expect(findPendingToolPart("bash", partsOf(map), ["msg-a", "msg-b"])).toEqual({
      messageID: "msg-b",
      callID: "call-new",
    })
  })

  test("excludeCallIDs 排除已被其他卡片占用的 callID", () => {
    const map = { "msg-a": [tool({ tool: "bash", callID: "call-1", state: { status: "pending" } })] }
    expect(findPendingToolPart("bash", partsOf(map), ["msg-a"], ["call-1"])).toBeNull()
  })

  test("无候选 / callID 缺失 → null", () => {
    expect(findPendingToolPart("bash", partsOf({}), ["msg-a"])).toBeNull()
    const noCall = { "msg-a": [tool({ tool: "bash", callID: undefined, state: { status: "pending" } })] }
    expect(findPendingToolPart("bash", partsOf(noCall), ["msg-a"])).toBeNull()
  })
})
