import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("change-set view fetches goal worktree diff and reports branch errors", () => {
  const view = read("src/renderer/mafw/components/ChangeSetView.tsx")
  assert.match(view, /pod\.worktreeDiff/)
  assert.match(view, /goalDiffErrorText/)
  assert.match(view, /openChangeSetDocument|updateChangeSetDocument/)
})

test("shell resolves the current goal and worktree directory", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /currentGoalRef/)
  assert.match(shell, /resolveGoalWorktreeDir/)
  assert.match(shell, /openGoalChangeSetFromGoal/)
})

test("goal change-set root never falls back to the project directory", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /void resolveGoalWorktreeDir\(goal\.podId, goal\.goalId, project\)/)
  assert.match(shell, /scope: \{ \.\.\.baseScope, worktreeDir: root \}/)
  const goalChanges = read("src/renderer/mafw/changes/goal-changes.ts")
  assert.match(goalChanges, /这一版没有可预览的分支/)
})

test("left-face Goal rows open the Goal tab, revisions open change sets", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /onOpenGoal=\{\(goalId\) => openGoalFocus\(goalId, "timeline"\)\}/)
  assert.match(shell, /onOpenGoalChangeSet=\{\(goal, revision\) => openGoalChangeSetFromGoal\(goal, revision\)\}/)
  assert.match(shell, /onOpenSession=\{\(sid\) => openSessionTab\(sid\)\}/)
})
