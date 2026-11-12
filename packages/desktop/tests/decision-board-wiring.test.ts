import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const board = read("src/renderer/mafw/components/DecisionBoard.tsx")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const css = read("src/renderer/mafw/decision-board.css")

test("DecisionBoard renders groups with v2 controls", () => {
  assert.match(board, /mafw-decision-board/)
  assert.match(board, /ButtonV2/)
  assert.match(board, /TooltipV2/)
  assert.match(board, /openDelay=\{300\}/)
  assert.match(board, /onAction\(item\)/)
  assert.doesNotMatch(board, /<button/)
})

test("ChatPane mounts the board above the transcript", () => {
  assert.match(chat, /DecisionBoard/)
  assert.match(chat, /decisionBoard\?: \(\) => DecisionBoardView/)
  assert.match(chat, /onDecisionAction\?: \(item: DecisionItem\) => void/)
})

test("MafwShell feeds the active thread's decision board", () => {
  assert.match(shell, /activeTechLeadGoalId/)
  assert.match(shell, /decisionStore\.board\(activeTechLeadGoalId\(\)\)/)
  assert.match(shell, /onDecisionAction=\{handleDecisionAction\}/)
})

test("decision actions open the goal and the plan overlay", () => {
  assert.match(shell, /openDecisionGoal/)
  assert.match(shell, /openReviewAnchorToFocus/)
  assert.match(shell, /setGoalPlanOpenRequest/)
  assert.match(shell, /setGoalPlanOpenRequest\(\{ nonce: \(goalPlanOpenRequest\(\)\?\.nonce \?\? 0\) \+ 1, goalId \}\)/)
  assert.match(shell, /planOpenRequest=\{goalPlanOpenRequest\(\)\}/)
  assert.match(read("src/renderer/mafw/components/GoalDetailPanel.tsx"), /planOpenRequest\?: PlanOpenRequest \| null/)
  assert.match(read("src/renderer/mafw/components/GoalDetailPanel.tsx"), /shouldOpenPlan/)
  assert.match(read("src/renderer/mafw/components/GoalDetailPanel.tsx"), /setPlanOpen\(true\)/)
})

test("decision board CSS uses tokens and never floats over the frame", () => {
  assert.match(css, /\.mafw-decision-board/)
  assert.match(css, /var\(--/)
  assert.doesNotMatch(css, /position:\s*absolute/)
})
