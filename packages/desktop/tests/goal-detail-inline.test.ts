import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const panel = read("../src/renderer/mafw/components/GoalDetailPanel.tsx")
const work = read("../src/renderer/mafw/components/ProjectWorkView.tsx")
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

test("the right work panel keeps its list mounted and renders detail in place", () => {
  assert.match(work, /import \{ GoalDetailPanel \} from "\.\/GoalDetailPanel"/)
  assert.match(work, /class="mafw-project-work-overview" hidden=\{!!props\.selectedGoalId\}/)
  assert.match(work, /<Show when=\{props\.selectedGoalId\} keyed>/)
  assert.match(work, /<GoalDetailPanel/)
  assert.match(work, /onClose=\{props\.onCloseGoal\}/)
  assert.match(work, /onOpenSession=\{props\.onOpenSession\}/)
  assert.match(work, /mafw-goal-inline-title/)
  assert.match(work, /data-goal-id/)
  assert.match(work, /\.mafw-work-item["'`]?\)\?\.focus/)
})

test("every Goal open path goes through the right work panel", () => {
  assert.doesNotMatch(shell, /import \{ GoalDetailOverlay \}/)
  assert.doesNotMatch(shell, /<GoalDetailOverlay/)
  const start = shell.indexOf("const openGoalDetail =")
  const end = shell.indexOf("};", start)
  const block = shell.slice(start, end)
  assert.match(block, /openProjectWork\(\)/)
  assert.match(block, /setGoalDetailFocus\(focus\)/)
  assert.match(block, /setPodGoalId\(goalId\)/)
  assert.ok(block.indexOf("openProjectWork()") < block.indexOf("setPodGoalId(goalId)"))
  assert.match(shell, /openGoalDetail\(goalId, "result"\)/)
})

test("ProjectWorkView receives one shell-owned inline selection", () => {
  assert.match(shell, /selectedGoalId=\{podGoalId\(\)\}/)
  assert.match(shell, /detailFocus=\{goalDetailFocus\(\)\}/)
  assert.match(shell, /podId=\{podIdForCurrentProject\(\)\}/)
  assert.match(shell, /const podIdForCurrentProject = \(\): string \| null => \{[\s\S]{0,220}podStore\.detail\(\)/)
  assert.match(shell, /onCloseGoal=\{\(\) => setPodGoalId\(null\)\}/)
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
