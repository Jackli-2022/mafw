import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const result = read("components/PodResultView.tsx")
const detail = read("components/GoalDetailPanel.tsx")
const shell = read("MafwShell.tsx")

test("the result offers an explicit Goal worktree entry", () => {
  assert.match(result, /查看本版文件/)
  assert.match(result, /onOpenWorktree/)
  assert.match(result, /podResultCanOpenWorktree/)
})

test("the Goal entry carries revision and title, and never auto-switches scope", () => {
  assert.match(detail, /onOpenWorktree/)
  assert.match(detail, /title: podGoal\(\)\?\.title/)
  assert.match(shell, /openGoalContent/)
  assert.match(shell, /onOpenWorktree/)
  assert.match(shell, /rememberContentLocation\(\)/)
})

test("Goal revision content keeps a return path to the Goal", () => {
  assert.match(shell, /contentReturnGoalId/)
  assert.match(shell, /backWorkbenchContext/)
  assert.match(shell, /setContentReturnGoalId\(returnGoal\)/)
  assert.match(shell, /workbenchContext\(\) === "content" && contentReturnGoalId\(\)/)
})
