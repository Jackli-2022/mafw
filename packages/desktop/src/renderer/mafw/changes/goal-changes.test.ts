import { test } from "node:test"
import assert from "node:assert/strict"
import { toFileDiffEntries, changeTotals, goalDiffErrorText, pinGoalRevision } from "./goal-changes"
import type { GoalRef } from "./changes-context"

const goal: GoalRef = { podId: "p1", goalId: "g1", revision: 2, title: "修复登录", worktreeDir: "C:/wt" }

test("maps worktree diff files and totals", () => {
  const files = toFileDiffEntries([
    { file: "src/a.ts", patch: "@@", additions: 3, deletions: 1, status: "modified" },
  ])
  assert.deepEqual(files[0], { file: "src/a.ts", patch: "@@", additions: 3, deletions: 1, status: "modified" })
  assert.deepEqual(changeTotals(files), { files: 1, additions: 3, deletions: 1 })
})

test("goal diff failures get neutral copy, never runtime names", () => {
  assert.match(goalDiffErrorText(404), /没有可预览的分支/)
  assert.match(goalDiffErrorText(409), /不可读/)
  assert.match(goalDiffErrorText(503), /不支持/)
  assert.doesNotMatch(goalDiffErrorText(503), /capability|runtime/i)
})

test("a newer revision is announced instead of replacing the pinned goal", () => {
  const pinned = pinGoalRevision(goal, { ...goal, revision: 3 })
  assert.equal(pinned.displayed?.revision, 2)
  assert.equal(pinned.newerRevision, 3)
  assert.equal(pinGoalRevision(pinned.displayed, { ...goal, goalId: "g2" }).displayed?.goalId, "g2")
})
