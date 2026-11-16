import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const card = read("src/renderer/mafw/components/DecisionRecordCard.tsx")
const goal = read("src/renderer/mafw/components/GoalDetailPanel.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const css = read("src/renderer/mafw/decision-record.css")

test("DecisionRecordCard keeps confirm and shelve human-only", () => {
  assert.match(card, /mafw-decision-record/)
  assert.match(card, /mafw-decision-record-confirm/)
  assert.match(card, /mafw-decision-record-shelve/)
  assert.match(card, /ButtonV2/)
  assert.match(card, /确认决定/)
  assert.match(card, /搁置/)
  assert.doesNotMatch(card, /<button/)
})

test("Goal overview renders the Goal-scoped decision history", () => {
  assert.match(goal, /决定记录/)
  assert.match(goal, /decisionRecords/)
  assert.match(goal, /DecisionRecordCard/)
})

test("MafwShell owns record mutations with toasts", () => {
  assert.match(shell, /decisionStore\.confirm/)
  assert.match(shell, /decisionStore\.shelve/)
  assert.match(shell, /decisionStore\.reopen/)
  assert.match(shell, /showToastV2/)
})

test("record CSS uses tokens", () => {
  assert.match(css, /\.mafw-decision-record/)
  assert.match(css, /var\(--/)
})
