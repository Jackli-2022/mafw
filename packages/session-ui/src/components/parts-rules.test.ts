import { describe, expect, test } from "bun:test"
import { HIDDEN_TOOLS, CONTEXT_GROUP_TOOLS, renderable, isTopLevelToolEntry } from "./parts-rules"

describe("parts-rules", () => {
  test("HIDDEN_TOOLS 含 todowrite", () => {
    expect(HIDDEN_TOOLS.has("todowrite")).toBe(true)
  })
  test("CONTEXT_GROUP_TOOLS 含 read/glob/grep/list", () => {
    for (const t of ["read", "glob", "grep", "list"]) expect(CONTEXT_GROUP_TOOLS.has(t)).toBe(true)
  })
  test("renderable: hidden tool 不渲染", () => {
    expect(renderable({ type: "tool", tool: "todowrite" })).toBe(false)
  })
  test("renderable: question pending/running 不渲染，completed 渲染", () => {
    expect(renderable({ type: "tool", tool: "question", state: { status: "pending" } })).toBe(false)
    expect(renderable({ type: "tool", tool: "question", state: { status: "running" } })).toBe(false)
    expect(renderable({ type: "tool", tool: "question", state: { status: "completed" } })).toBe(true)
  })
  test("renderable: 普通 tool 渲染", () => {
    expect(renderable({ type: "tool", tool: "bash" })).toBe(true)
  })
  test("renderable: 空 text 不渲染", () => {
    expect(renderable({ type: "text", text: "  " })).toBe(false)
    expect(renderable({ type: "text", text: "hi" })).toBe(true)
  })
  test("isTopLevelToolEntry: 排除 hidden/context-group/question-pending", () => {
    expect(isTopLevelToolEntry({ type: "tool", tool: "bash" })).toBe(true)
    expect(isTopLevelToolEntry({ type: "tool", tool: "todowrite" })).toBe(false)
    expect(isTopLevelToolEntry({ type: "tool", tool: "read" })).toBe(false)
    expect(isTopLevelToolEntry({ type: "tool", tool: "question", state: { status: "pending" } })).toBe(false)
    expect(isTopLevelToolEntry({ type: "tool", tool: "question", state: { status: "completed" } })).toBe(true)
    expect(isTopLevelToolEntry({ type: "text" })).toBe(false)
  })
})
