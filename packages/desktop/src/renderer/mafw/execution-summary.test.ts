import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { summarizeExecution } from "./execution-summary"

describe("execution-summary", () => {
  test("summarizeExecution separates running, total, and input-required", () => {
    assert.deepEqual(summarizeExecution({
      subagents: [{ status: "running" }, { status: "running" }, { status: "completed" }],
      background: [{ status: "running" }, { status: "failed" }],
      tasks: [{ status: "completed" }, { status: "in_progress" }, { status: "input_required" }],
    }), {
      subagentRunning: 2,
      subagentTotal: 3,
      backgroundRunning: 1,
      backgroundTotal: 2,
      todoDone: 1,
      todoTotal: 3,
      waitingForInput: 1,
    })
  })

  test("empty input is all zero", () => {
    assert.deepEqual(summarizeExecution({ subagents: [], background: [], tasks: [] }), {
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
