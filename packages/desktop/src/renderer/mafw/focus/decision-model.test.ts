import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildDecisionBoard,
  decisionActionForAttention,
  decisionGoalFocus,
  decisionLimitToInclude,
  visibleDecisionItems,
} from "./decision-model"

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

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "dec_1",
    projectDir: "C:/repo",
    goalId: "g1",
    revision: 1,
    kind: "plan",
    status: "draft",
    question: "采用哪个方案？",
    options: [],
    evidence: [],
    rationale: null,
    consequences: null,
    reviewAt: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    history: [],
    ...overrides,
  } as any
}

test("attention maps to decision kinds and the four groups", () => {
  const board = buildDecisionBoard({
    attention: [
      attention({ id: "g1:review:r1", kind: "review", action: { type: "open_result", goalId: "g1" } }),
      attention({ id: "g1:direction:r1", kind: "direction_review", action: { type: "open_direction_review", goalId: "g1" } }),
      attention(),
    ],
    records: [],
  })

  assert.deepEqual(board.groups.map((group) => group.status), ["needs_you", "pending", "decided", "shelved"])
  assert.deepEqual(board.groups.map((group) => group.label), ["需要你定", "待确认", "已定", "已搁置"])
  const needs = board.groups[0]!.items
  assert.deepEqual(needs.map((item) => item.kind), ["plan", "direction", "acceptance"])
  assert.equal(needs[0]!.action.kind, "goal")
  assert.equal((needs[0]!.action as { target: string }).target, "plan")
  assert.equal(board.counts.needsYou, 3)
  assert.equal(board.counts.pending, 0)
})

test("unresolved review items are decisions and resolved ones are absent", () => {
  const board = buildDecisionBoard({
    attention: [
      attention({
        id: "g1:review_item:r1:item_1",
        kind: "review_item",
        priority: 75,
        action: {
          type: "open_review_item",
          goalId: "g1",
          itemId: "item_1",
          rel: "src/a.ts",
          line: 12,
        },
      }),
      attention({ id: "g1:review:r1", kind: "review", action: { type: "open_result", goalId: "g1" } }),
    ],
    records: [],
  })

  const reviewItems = board.groups[0]!.items.filter((item) => item.source === "review")
  assert.equal(reviewItems.length, 1)
  assert.equal(reviewItems[0]!.action.kind, "reviewItem")
  assert.deepEqual(reviewItems[0]!.action, {
    kind: "reviewItem",
    goalId: "g1",
    itemId: "item_1",
    rel: "src/a.ts",
    line: 12,
  })
  assert.equal(board.groups[0]!.items.some((item) => item.kind === "acceptance"), true)
})

test("records map to pending decided and shelved", () => {
  const board = buildDecisionBoard({
    attention: [],
    records: [
      record({ id: "d1", status: "draft" }),
      record({ id: "d2", status: "decided", kind: "direction", question: "方向定了" }),
      record({ id: "d3", status: "shelved", kind: "scope", question: "范围先搁置" }),
    ],
  })

  assert.deepEqual(board.groups.map((group) => group.items.map((item) => item.id)), [
    [],
    ["d1"],
    ["d2"],
    ["d3"],
  ])
  assert.equal(board.counts.pending, 1)
  assert.equal(board.counts.decided, 1)
  assert.equal(board.counts.shelved, 1)
})

test("goal filter keeps only that goal", () => {
  const board = buildDecisionBoard({
    attention: [attention({ goalId: "g1" }), attention({ id: "g2:plan:r1", goalId: "g2" })],
    records: [record({ id: "d1", goalId: "g1" }), record({ id: "d2", goalId: "g2" })],
    goalId: "g1",
  })

  assert.equal(board.groups[0]!.items.every((item) => item.goalId === "g1"), true)
  assert.equal(board.groups[1]!.items.map((item) => item.id).join(","), "d1")
  assert.equal(board.counts.needsYou, 1)
})

test("review item without itemId has no action", () => {
  const action = decisionActionForAttention(
    attention({ kind: "review_item", action: { type: "open_review_item", goalId: "g1" } }),
  )
  assert.equal(action.kind, "none")
})

test("visibleDecisionItems caps a group and keeps the remainder countable", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}` } as any))
  assert.equal(visibleDecisionItems(items, 25).length, 25)
  assert.equal(visibleDecisionItems(items, 0).length, 0)
  assert.equal(visibleDecisionItems(items, 100).length, 60)
})

test("decisionLimitToInclude expands to the focused record", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}` } as any))
  assert.equal(decisionLimitToInclude(items, "d40"), 50)
  assert.equal(decisionLimitToInclude(items, "missing"), 25)
})

test("decisionGoalFocus maps plan and review actions", () => {
  assert.equal(decisionGoalFocus({ kind: "goal", goalId: "g1", target: "plan" }), "plan")
  assert.equal(decisionGoalFocus({ kind: "goal", goalId: "g1", target: "direction" }), "direction")
  assert.equal(decisionGoalFocus({ kind: "goal", goalId: "g1", target: "question" }), "question")
  assert.equal(decisionGoalFocus({ kind: "goal", goalId: "g1", target: "result" }), "result")
  assert.equal(decisionGoalFocus({ kind: "reviewItem", goalId: "g1", itemId: "i1", rel: "src/a.ts" }), "timeline")
  assert.equal(decisionGoalFocus({ kind: "record", recordId: "d1" }), null)
  assert.equal(decisionGoalFocus({ kind: "none" }), null)
})
