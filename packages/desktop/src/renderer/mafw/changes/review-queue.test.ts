import { test } from "node:test"
import assert from "node:assert/strict"
import { countReviewAttention, reviewActionsVisible } from "./review-queue"

test("counts unresolved review attention, optionally scoped to one goal", () => {
  const items = [
    { id: "a", goalId: "g1", kind: "review_item" },
    { id: "b", goalId: "g1", kind: "review_item" },
    { id: "c", goalId: "g2", kind: "review_item" },
    { id: "d", goalId: "g1", kind: "question" },
  ] as any
  assert.equal(countReviewAttention(items), 3)
  assert.equal(countReviewAttention(items, "g1"), 2)
})

test("accepted goals never expose resolve/reopen actions", () => {
  assert.equal(reviewActionsVisible(false), true)
  assert.equal(reviewActionsVisible(true), false)
})
