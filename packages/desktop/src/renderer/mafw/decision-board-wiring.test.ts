import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const board = readFileSync(new URL("./components/DecisionBoard.tsx", import.meta.url), "utf8")

test("DecisionBoard renders records in batches", () => {
  assert.match(board, /DECISION_PAGE_SIZE/)
  assert.match(board, /visibleDecisionItems/)
  assert.match(board, /decisionLimitToInclude/)
  assert.match(board, /显示更多/)
})
