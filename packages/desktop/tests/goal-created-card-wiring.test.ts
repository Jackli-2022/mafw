import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const cards = read("src/renderer/mafw/components/tool-cards/index.ts")
const card = read("src/renderer/mafw/components/tool-cards/goal-created.tsx")
const model = read("src/renderer/mafw/components/tool-cards/goal-created-model.ts")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("mafw_create_goal is registered with the actionable card", () => {
  assert.match(cards, /registerAliased\("mafw_create_goal", MafwGoalCreatedCard\)/)
  assert.match(card, /configureGoalCreatedActions/)
  assert.match(card, /BasicTool/)
  assert.match(card, /ButtonV2/)
  assert.match(card, /打开 Tech Lead 讨论/)
  assert.match(card, /确认撤销/)
})

test("only a completed tech_lead result gets the card", () => {
  assert.match(model, /status !== "completed"/)
  assert.match(model, /routedTo !== "tech_lead"/)
  assert.match(card, /fallback=\{<FallbackTool \{\.\.\.props\} \/>\}/)
})

test("the shell owns Goal navigation and cancellation", () => {
  assert.match(shell, /configureGoalCreatedActions\(\{/)
  assert.match(shell, /openGoalAndDiscuss\(goalId, "timeline"\)/)
  assert.match(shell, /goals\.control\(\{ goalId, action: "ABORT" \}\)/)
  assert.match(shell, /configureGoalCreatedActions\(null\)/)
})
