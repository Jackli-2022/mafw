import { describe, expect, test } from "bun:test"
import { mapSubagentToolPart } from "./subagents"

const partEvent = (tool: string, state: any) => ({
  type: "part.updated",
  properties: {
    sessionID: "parent1",
    part: { type: "tool", tool, sessionID: "parent1", state },
  },
})

describe("mapSubagentToolPart", () => {
  test("subagent tool part metadata.sessionID → session-created", () => {
    expect(mapSubagentToolPart(partEvent("subagent", {
      status: "running",
      input: { description: "Builder check", agent: "general" },
      metadata: { sessionID: "child1", status: "running" },
    }))).toEqual({
      kind: "session-created",
      info: { id: "child1", parentID: "parent1", title: "Builder check", agent: "general" },
    })
  })

  test("没有 metadata.sessionID → null（input.started 不建假行）", () => {
    expect(mapSubagentToolPart(partEvent("subagent", { status: "running", input: {} }))).toBeNull()
  })

  test("非 subagent 工具 → null", () => {
    expect(mapSubagentToolPart(partEvent("bash", {
      status: "running",
      metadata: { sessionID: "child1" },
    }))).toBeNull()
  })

  test("metadata.sessionID 别名 sessionId 也接受（2.1 版本漂移防线）", () => {
    expect(mapSubagentToolPart(partEvent("subagent", {
      status: "running",
      input: { description: "x" },
      metadata: { sessionId: "child2" },
    }))).toMatchObject({ kind: "session-created", info: { id: "child2", parentID: "parent1" } })
  })
})
