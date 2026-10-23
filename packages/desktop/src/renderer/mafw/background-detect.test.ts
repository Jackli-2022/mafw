import { describe, expect, test } from "bun:test"
import { detectBackgroundPart, findBlockingWork } from "./background-detect"

describe("background-detect（v2.1.0 name 兜底）", () => {
  test("detects v2.1.0 shell part by name", () => {
    const ev = detectBackgroundPart({
      type: "tool",
      name: "shell",
      state: { status: "completed", metadata: { status: "running", shellID: "sh1" }, input: { command: "npm run dev" } },
    }, "s1")
    expect(ev).toEqual({
      kind: "bg-observed",
      row: { id: "sh1", type: "shell", sessionID: "s1", label: "npm run dev" },
    })
  })

  test("detects v2.1.0 subagent part by name", () => {
    const ev = detectBackgroundPart({
      type: "tool",
      name: "subagent",
      state: { status: "completed", metadata: { status: "running", sessionID: "child1" }, input: { description: "explore" } },
    }, "s1")
    expect(ev).toEqual({
      kind: "bg-observed",
      row: { id: "child1", type: "subagent", sessionID: "s1", label: "explore" },
    })
  })

  test("keeps v1 tool field behavior", () => {
    const ev = detectBackgroundPart({
      type: "tool",
      tool: "shell",
      state: { status: "completed", metadata: { status: "running", shellID: "sh2" }, input: { command: "sleep 1" } },
    }, "s1")
    expect(ev?.row.id).toBe("sh2")
  })

  test("findBlockingWork reads name too", () => {
    const messages = [{ id: "m1", role: "assistant" }]
    const parts = { m1: [{ type: "tool", name: "shell", state: { status: "running", input: { command: "npm test" } } }] }
    expect(findBlockingWork(messages, parts)).toEqual([{ type: "shell", label: "npm test" }])
  })
})
