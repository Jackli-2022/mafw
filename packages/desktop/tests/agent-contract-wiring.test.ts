import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const goal = read("src/renderer/mafw/components/GoalDetailPanel.tsx")
const card = read("src/renderer/mafw/components/AgentContractCard.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const css = read("src/renderer/mafw/agent-contract.css")

test("Goal overview renders the agent contract after the hero", () => {
  assert.match(goal, /AgentContractCard/)
  assert.match(goal, /agentContractFor/)
  const hero = goal.indexOf("<GoalUserHero")
  const contract = goal.indexOf("<AgentContractCard")
  assert.ok(hero >= 0 && contract > hero, "contract card follows the hero")
})

test("AgentContractCard shows level, four parameters and human-only", () => {
  assert.match(card, /mafw-agent-contract/)
  assert.match(card, /levelLabel/)
  assert.match(card, /humanOnly/)
  assert.match(card, /Mandate/)
  assert.match(card, /Discretion/)
  assert.match(card, /Escalation/)
  assert.match(card, /Audit/)
  assert.match(card, /ButtonV2/)
  assert.doesNotMatch(card, /<button/)
})

test("frame carries the execution badge", () => {
  assert.match(shell, /executionBadgeFor/)
  assert.match(shell, /execution: focusedGoal/)
})

test("agent contract CSS uses tokens", () => {
  assert.match(css, /\.mafw-agent-contract/)
  assert.match(css, /var\(--/)
})
