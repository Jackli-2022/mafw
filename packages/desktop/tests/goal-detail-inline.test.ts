import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const panel = read("../src/renderer/mafw/components/GoalDetailPanel.tsx")
const work = read("../src/renderer/mafw/components/WorldOverviewStage.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")

test("Goal detail is an inline panel, not a modal overlay", () => {
  assert.equal(
    existsSync(new URL("../src/renderer/mafw/components/GoalDetailOverlay.tsx", import.meta.url)),
    false,
  )
  assert.match(panel, /export function GoalDetailPanel/)
  assert.match(panel, /mafw-goal-panel mafw-goal-inline/)
  assert.match(panel, /返回全部 Goal/)
  assert.match(panel, /role="region"/)
  assert.doesNotMatch(panel, /mafw-goal-overlay/)
  assert.doesNotMatch(panel, /e\.target === e\.currentTarget/)
})

test("the right work panel is the project home; Goal detail is a separate context", () => {
  assert.doesNotMatch(work, /GoalDetailPanel/)
  assert.doesNotMatch(work, /props\.selectedGoalId/)
  assert.match(work, /class="mafw-project-work-overview"/)
  assert.match(work, /WorkPriorityList/)
  assert.match(work, /WorkOverview/)
  assert.match(shell, /renderGoal=\{\(\) =>/)
  assert.match(shell, /<GoalDetailPanel/)
  assert.match(shell, /onClose=\{\(\) => \{ setPodGoalId\(null\); focusBack\(\) \}\}/)
})

test("every Goal open path goes into the Goal context", () => {
  assert.doesNotMatch(shell, /import \{ GoalDetailOverlay \}/)
  assert.doesNotMatch(shell, /<GoalDetailOverlay/)
  const start = shell.indexOf("const openGoalDetail =")
  const end = shell.indexOf("};", start)
  const block = shell.slice(start, end)
  assert.match(block, /setGoalDetailFocus\(focus\)/)
  assert.match(block, /setPodGoalId\(goalId\)/)
  assert.match(block, /openGoalFocus\(goalId, focus\)/)
  assert.ok(block.indexOf("setPodGoalId(goalId)") < block.indexOf("openGoalFocus(goalId, focus)"))
  assert.match(shell, /openGoalAndDiscuss\(goalId, "result"\)/)
})

test("ProjectWorkView receives one shell-owned Goal context", () => {
  assert.doesNotMatch(shell, /selectedGoalId=\{podGoalId\(\)\}/)
  assert.doesNotMatch(shell, /detailFocus=\{goalDetailFocus\(\)\}/)
  assert.match(shell, /const podIdForCurrentProject = \(\): string \| null => \{[\s\S]{0,220}podStore\.detail\(\)/)
  assert.match(shell, /renderGoal=\{\(\) =>/)
  assert.match(shell, /onOpenSession=\{\(sid\) => \{ void openPodSession\(sid\) \}\}/)
})

test("switching projects clears the old Goal before rendering the next overview", () => {
  const start = shell.indexOf("const handleSelectProject")
  const end = shell.indexOf("// Open a session as a tab", start)
  const block = shell.slice(start, end)
  const clearAt = block.indexOf("setPodGoalId(null)")
  const switchAt = block.indexOf("setCurrentProject(worktree)")
  assert.ok(clearAt >= 0, "project switch must clear selected Goal")
  assert.ok(switchAt >= 0, "project switch must set the new project")
  assert.ok(clearAt < switchAt, "selection must clear before the next project loads")
})
