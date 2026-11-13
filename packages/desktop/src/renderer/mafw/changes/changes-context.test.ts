import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveChangesContext, changesContextKey, type GoalRef } from "./changes-context"

const goal: GoalRef = { podId: "p1", goalId: "g1", revision: 2, title: "修复登录", worktreeDir: "C:/wt" }

test("session mode returns the active discussion and its goal", () => {
  const context = resolveChangesContext({
    mode: "session",
    projectDir: "C:/repo",
    activeSession: { id: "s1", title: "修复登录" },
    sessionGoal: goal,
    currentGoal: null,
  })
  assert.deepEqual(context, { kind: "session", sessionID: "s1", goal })
  assert.equal(changesContextKey(context), "session:s1:g1:2")
})

test("goal mode returns the current goal; missing goal is null", () => {
  assert.deepEqual(resolveChangesContext({
    mode: "goal", projectDir: "C:/repo", activeSession: null, sessionGoal: null, currentGoal: goal,
  }), { kind: "goal", goal })
  assert.equal(resolveChangesContext({
    mode: "goal", projectDir: "C:/repo", activeSession: null, sessionGoal: null, currentGoal: null,
  }), null)
})

test("project mode is available without a session or goal", () => {
  assert.deepEqual(resolveChangesContext({
    mode: "project", projectDir: "C:/repo", activeSession: null, sessionGoal: null, currentGoal: null,
  }), { kind: "project" })
})

test("no project means no context in every mode", () => {
  for (const mode of ["session", "goal", "project"] as const) {
    assert.equal(resolveChangesContext({
      mode, projectDir: null, activeSession: { id: "s1", title: "x" }, sessionGoal: goal, currentGoal: goal,
    }), null)
  }
})

test("session mode without an active discussion is null", () => {
  assert.equal(resolveChangesContext({
    mode: "session", projectDir: "C:/repo", activeSession: null, sessionGoal: null, currentGoal: goal,
  }), null)
})
