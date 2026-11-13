import { test } from "node:test"
import assert from "node:assert/strict"
import {
  goalFocusScope,
  openChangeSetFocus,
  openGoalFocus,
  openReviewItemFocus,
  type GoalFocusInput,
} from "./goal-focus"
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

test("change set focus carries the goal revision", () => {
  const state = openChangeSetFocus(createWorkbenchState("C:/repo"), input)
  assert.equal(state.stack.length, 1)
  assert.equal(state.stack[0]!.subject.kind, "changeSet")
  const subject = state.stack[0]!.subject as { scope: string; goalId: string; revision: number }
  assert.equal(subject.scope, "goal")
  assert.equal(subject.goalId, "g1")
  assert.equal(subject.revision, 3)
})

test("review item focus carries the anchor", () => {
  const state = openReviewItemFocus(createWorkbenchState("C:/repo"), {
    ...input,
    itemId: "r1",
    rel: "src/a.ts",
    line: 12,
  })
  assert.equal(state.stack.length, 1)
  assert.equal(state.stack[0]!.subject.kind, "reviewItem")
  const subject = state.stack[0]!.subject as { id: string; anchor: { rel: string; line?: number } }
  assert.equal(subject.id, "r1")
  assert.deepEqual(subject.anchor, { rel: "src/a.ts", line: 12 })
})

test("same review item focus replaces instead of pushing", () => {
  let state = openReviewItemFocus(createWorkbenchState("C:/repo"), {
    ...input,
    itemId: "r1",
    rel: "src/a.ts",
    line: 12,
  })
  state = openReviewItemFocus(state, {
    ...input,
    itemId: "r1",
    rel: "src/a.ts",
    line: 20,
  })
  assert.equal(state.stack.length, 1)
  assert.deepEqual((state.stack[0]!.subject as { anchor: { line?: number } }).anchor, {
    rel: "src/a.ts",
    line: 20,
  })
})
