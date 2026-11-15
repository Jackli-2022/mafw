import { test } from "node:test"
import assert from "node:assert/strict"
import { visibleChatReviewItems, unresolvedReviewCount } from "./chat-review"

const item = (id: string, status: "pending" | "responded" | "resolved") => ({
  id,
  podId: "pod",
  goalId: "goal",
  revision: 1,
  status,
  rel: "src/a.ts",
  startLine: 1,
  endLine: null,
  comment: `comment ${id}`,
  response: null,
  originRevision: null,
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
}) as any

test("chat review shows unresolved items first and caps the list", () => {
  const items = [item("a", "pending"), item("b", "resolved"), item("c", "responded"), item("d", "pending")]
  assert.deepEqual(visibleChatReviewItems(items, 2).map((row) => row.id), ["a", "c"])
  assert.equal(unresolvedReviewCount(items), 3)
})

test("chat review hides a fully resolved Goal", () => {
  assert.deepEqual(visibleChatReviewItems([item("a", "resolved")]), [])
  assert.equal(unresolvedReviewCount([item("a", "resolved")]), 0)
})
