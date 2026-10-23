import { describe, expect, test } from "bun:test"
import { isTaskTool, taskChildSessionID } from "./task-session"

describe("taskChildSessionID", () => {
  test("accepts camelCase sessionId", () => {
    expect(taskChildSessionID({ sessionId: "a" })).toBe("a")
  })
  test("accepts opencode sessionID (capital ID)", () => {
    expect(taskChildSessionID({ sessionID: "b" })).toBe("b")
  })
  test("accepts childSessionID", () => {
    expect(taskChildSessionID({ childSessionID: "c" })).toBe("c")
  })
  test("prefers sessionId over sessionID", () => {
    expect(taskChildSessionID({ sessionId: "a", sessionID: "b" })).toBe("a")
  })
  test("ignores empty / non-string values", () => {
    expect(taskChildSessionID({ sessionId: "", sessionID: 42 })).toBeUndefined()
    expect(taskChildSessionID({})).toBeUndefined()
    expect(taskChildSessionID(null)).toBeUndefined()
  })
  test("isTaskTool accepts v1 task and v2 subagent", () => {
    expect(isTaskTool("task")).toBe(true)
    expect(isTaskTool("subagent")).toBe(true)
    expect(isTaskTool("bash")).toBe(false)
    expect(isTaskTool(undefined)).toBe(false)
  })
})
