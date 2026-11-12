import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const card = read("src/renderer/mafw/components/DecisionRecordCard.tsx")
const board = read("src/renderer/mafw/components/DecisionBoard.tsx")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
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

test("DecisionBoard expands record items in place", () => {
  assert.match(board, /DecisionRecordCard/)
  assert.match(board, /expandedRecordId/)
  assert.match(board, /onDecisionConfirm/)
  assert.match(board, /recordBusy/)
})

test("ChatPane passes records into the board", () => {
  assert.match(chat, /decisionRecords/)
  assert.match(chat, /decisionRecordBusy/)
  assert.match(chat, /onDecisionConfirm/)
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
