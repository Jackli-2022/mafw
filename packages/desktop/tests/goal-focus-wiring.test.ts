import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const picker = read("src/renderer/mafw/focus/picker-model.ts")

test("MafwShell opens goals as focus subjects", () => {
  assert.match(shell, /from "\.\/focus\/goal-focus"/)
  assert.match(shell, /openGoalFocus/)
  assert.match(shell, /applyGoalFocus/)
  assert.match(shell, /setPodGoalId/)
  assert.match(shell, /setFocusState/)
})

test("project home and picker can open a goal focus", () => {
  assert.match(shell, /buildGoalPickerItems/)
  assert.match(shell, /item\.subject\.kind === "goal"/)
  assert.match(shell, /onOpenGoal=\{/)
  assert.match(shell, /openGoalFocus\(/)
})

test("goal picker items carry a goal scope and orient lens", () => {
  assert.match(picker, /export function buildGoalPickerItems/)
  assert.match(picker, /kind: "goal"/)
  assert.match(picker, /lens: "orient"/)
  assert.match(picker, /subject: \{ kind: "goal", goalId: goal\.goalId \}/)
})

test("Goal rail can open the change set subject", () => {
  assert.match(shell, /openChangeSetFromFocus/)
  assert.match(shell, /查看变更集/)
})
