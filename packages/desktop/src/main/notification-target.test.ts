import { describe, expect, test } from "bun:test"
import { attentionTarget } from "./notification-target"

describe("attentionTarget", () => {
  test("plan approval opens the plan panel", () => {
    expect(attentionTarget({ kind: "plan_approval", goalId: "g1", projectId: "p1" })).toEqual({
      type: "goal",
      goalId: "g1",
      projectId: "p1",
      focus: "plan",
    })
  })

  test("direction / question use their own focus", () => {
    expect(attentionTarget({ kind: "direction_review", goalId: "g1" }).focus).toBe("direction")
    expect(attentionTarget({ kind: "question", goalId: "g1" }).focus).toBe("question")
  })

  test("blocked / review / failed fall back to the timeline", () => {
    expect(attentionTarget({ kind: "blocked", goalId: "g1" }).focus).toBe("timeline")
    expect(attentionTarget({ kind: "review", goalId: "g1" }).focus).toBe("timeline")
    expect(attentionTarget({ kind: "failed", goalId: "g1" }).focus).toBe("timeline")
  })
})
