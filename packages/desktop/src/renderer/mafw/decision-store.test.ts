import { test } from "node:test"
import assert from "node:assert/strict"
import { createDecisionStore } from "./decision-store"

function attention(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1:plan_approval:r1",
    goalId: "g1",
    revision: 1,
    kind: "plan_approval",
    priority: 100,
    coalesceKey: "g1:plan_approval:r1",
    title: "工作台重构",
    action: { type: "open_plan_review", goalId: "g1" },
    ...overrides,
  } as any
}

test("decision store exposes attention items and counts", async () => {
  const store = createDecisionStore({
    api: {
      attention: async () => ({
        items: [
          attention(),
          attention({
            id: "g1:review_item:r1:item_1",
            kind: "review_item",
            priority: 75,
            action: { type: "open_review_item", goalId: "g1", itemId: "item_1", rel: "src/a.ts" },
          }),
        ],
      }),
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  assert.equal(store.items().length, 2)
  assert.equal(store.counts().needsYou, 2)
  assert.equal(store.revision(), 1)
})

test("decision store keeps the last list on failure", async () => {
  let calls = 0
  const store = createDecisionStore({
    api: {
      attention: async () => {
        calls += 1
        if (calls === 2) throw new Error("offline")
        return { items: [attention()] }
      },
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  await store.refresh()
  assert.equal(store.items().length, 1)
  assert.equal(store.counts().needsYou, 1)
})

test("decision store filters by goal", async () => {
  const store = createDecisionStore({
    api: {
      attention: async () => ({
        items: [
          attention({ goalId: "g1" }),
          attention({ id: "g2:plan_approval:r1", goalId: "g2", coalesceKey: "g2:plan_approval:r1" }),
        ],
      }),
    },
    projectDir: () => "C:/repo",
  })

  await store.refresh()
  assert.equal(store.board("g1").counts.needsYou, 1)
  assert.equal(store.board("g2").counts.needsYou, 1)
  assert.equal(store.board(null).counts.needsYou, 2)
})

test("decision store does nothing without a project", async () => {
  let calls = 0
  const store = createDecisionStore({
    api: { attention: async () => { calls += 1; return { items: [] } } },
    projectDir: () => null,
  })
  await store.refresh()
  assert.equal(calls, 0)
  assert.equal(store.items().length, 0)
})
