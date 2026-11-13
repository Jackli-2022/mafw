import { test } from "node:test"
import assert from "node:assert/strict"
import { goalFocusScope, openGoalFocus, type GoalFocusInput } from "./goal-focus"
import { createWorkbenchState } from "./focus-model"

const input: GoalFocusInput = {
  projectDir: "C:/repo",
  goalId: "g1",
  revision: 3,
  worktreeDir: "C:/repo-goal-g1",
  title: "工作台重构",
}

test("goal focus uses a goal scope", () => {
  assert.deepEqual(goalFocusScope(input), {
    kind: "goal",
    worldId: "C:/repo",
    goalId: "g1",
    revision: 3,
    worktreeDir: "C:/repo-goal-g1",
  })

  const state = openGoalFocus(createWorkbenchState("C:/repo"), input)
  assert.equal(state.stack.length, 1)
  assert.equal(state.stack[0]!.subject.kind, "goal")
  assert.equal((state.stack[0]!.subject as { goalId: string }).goalId, "g1")
  assert.equal(state.stack[0]!.scope.kind, "goal")
})
