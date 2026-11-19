import { describe, expect, test } from "bun:test"
import { taskSessionForParent } from "./task-tool-model"

const sessions = [
  { id: "ses_old", parentID: "ses_parent", title: "Old @Build", time: { created: 1 } },
  { id: "ses_new", parentID: "ses_parent", title: "Fix the bug @Build", time: { created: 2 } },
  { id: "ses_other", parentID: "ses_other", title: "Fix the bug @Build", time: { created: 3 } },
]

describe("task session resolution", () => {
  test("matches the parent, description, and agent", () => {
    expect(taskSessionForParent({ description: "Fix the bug", agent: "build" }, "ses_parent", sessions)).toBe("ses_new")
  })

  test("returns undefined without a parent or a matching title", () => {
    expect(taskSessionForParent({ description: "Fix the bug" }, undefined, sessions)).toBeUndefined()
    expect(taskSessionForParent({ description: "Nope", agent: "build" }, "ses_parent", sessions)).toBeUndefined()
    expect(taskSessionForParent({ description: "Fix the bug", agent: "review" }, "ses_parent", sessions)).toBeUndefined()
  })

  test("uses the newest matching child", () => {
    const older = { id: "ses_a", parentID: "p", title: "Task @Build", time: { created: 1 } }
    const newer = { id: "ses_b", parentID: "p", title: "Task @Build", time: { created: 5 } }
    expect(taskSessionForParent({ description: "Task", agent: "build" }, "p", [older, newer])).toBe("ses_b")
  })
})
