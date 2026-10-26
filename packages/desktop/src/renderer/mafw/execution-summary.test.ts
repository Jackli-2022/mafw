import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { summarizeExecution } from "./execution-summary"

describe("execution-summary", () => {
  test("summarizeExecution uses todos for todo counts and tasks for background", () => {
    assert.deepEqual(summarizeExecution({
      subagents: [{ status: "running" }, { status: "running" }, { status: "completed" }],
      background: [{ status: "running" }, { status: "failed" }],
      todos: [{ status: "completed" }, { status: "in_progress" }, { status: "pending" }],
      tasks: [{ status: "working" }, { status: "input_required" }, { status: "completed" }],
    }), {
      subagentRunning: 2,
      subagentTotal: 3,
      backgroundRunning: 2,
      backgroundTotal: 5,
      todoDone: 1,
      todoTotal: 3,
      waitingForInput: 1,
    })
  })

  test("empty input is all zero", () => {
    assert.deepEqual(summarizeExecution({ subagents: [], background: [], todos: [], tasks: [] }), {
      subagentRunning: 0,
      subagentTotal: 0,
      backgroundRunning: 0,
      backgroundTotal: 0,
      todoDone: 0,
      todoTotal: 0,
      waitingForInput: 0,
    })
  })
})
