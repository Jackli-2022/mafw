import { test } from "node:test"
import assert from "node:assert/strict"
import type { PodGoal, PodGoalStage } from "@mafw/sdk"
import type { PodEventItem } from "./pod-events"
import {
  buildWorkPriority,
  filterWorkGoals,
  goalModeLabel,
  goalProgressPercent,
  goalProgressText,
  workFilterCounts,
} from "./work-overview-model"

function goal(input: Partial<PodGoal> & Pick<PodGoal, "goalId">): PodGoal {
  const stage: PodGoalStage = { owner: "team", kind: "working" }
  return {
    id: `pg-${input.goalId}`,
    podId: "pod_1",
    status: "active",
    title: input.goalId,
    phase: null,
    verdict: null,
    stage,
    bucket: "in_progress",
    resultReady: false,
    enqueuedAt: "2026-11-09T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    activeRevision: 1,
    revision: 1,
    ...input,
  }
}

function event(input: Partial<PodEventItem> & Pick<PodEventItem, "goalId" | "revision">): PodEventItem {
  return {
    id: `ev-${input.goalId}-${input.revision}-${input.createdAt ?? ""}`,
    goalId: input.goalId,
    revision: input.revision,
    kind: "goal.result",
    severity: "p1",
    title: "",
    summary: null,
    state: "unread",
    createdAt: "2026-11-09T00:00:00.000Z",
    ...input,
  }
}

test("important items use only the current revision", () => {
  const current = goal({ goalId: "g1", bucket: "result_ready", activeRevision: 2, revision: 2 })
  const events = [
    event({ goalId: "g1", revision: 1, kind: "goal.result", severity: "p1", state: "unread" }),
    event({ goalId: "g1", revision: 2, kind: "goal.result", severity: "p1", state: "unread", createdAt: "2026-11-09T01:00:00.000Z" }),
  ]
  const items = buildWorkPriority({ goals: [current], events, isResultViewed: () => false })
  assert.deepEqual(items, [{
    kind: "result",
    key: "g1:r2:result",
    goal: current,
    createdAt: "2026-11-09T01:00:00.000Z",
  }])
})

test("attention wins over an unseen result for the same goal", () => {
  const goalWithBoth = goal({
    goalId: "g1",
    bucket: "result_ready",
    stage: {
      owner: "person",
      kind: "plan_approval",
      action: { type: "open_plan_review", goalId: "g1" },
    },
  })
  const items = buildWorkPriority({ goals: [goalWithBoth], events: [], isResultViewed: () => false })
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, "attention")
  assert.equal(items[0].kind === "attention" ? items[0].label : null, "审阅计划")
})

test("filters and counts share one projection", () => {
  const goals = [
    goal({ goalId: "a", bucket: "needs_you" }),
    goal({ goalId: "q", bucket: "queued" }),
    goal({ goalId: "w", bucket: "in_progress" }),
    goal({ goalId: "r", bucket: "result_ready" }),
    goal({ goalId: "e", bucket: "ended" }),
  ]
  assert.deepEqual(filterWorkGoals(goals, "active").map((item) => item.goalId), ["a", "q", "w"])
  assert.deepEqual(workFilterCounts(goals), { all: 5, active: 3, results: 1, history: 1 })
})

test("progress text and percent never fabricate data", () => {
  assert.equal(goalProgressText(goal({ goalId: "empty", progress: null })), null)
  assert.equal(goalProgressPercent(goal({ goalId: "empty", progress: null })), null)
  const withProgress = goal({
    goalId: "p1",
    currentAssignment: { assignmentId: "a1", role: "builder", taskIds: [], attempt: 1 },
    progress: { total: 4, done: 2, inProgress: 1, review: 0, failed: 0, skipped: 0 },
  })
  assert.equal(goalProgressText(withProgress), "Builder 2/4")
  assert.equal(goalProgressPercent(withProgress), 50)
})

test("unseen results are newest first and viewed results stay out", () => {
  const older = goal({ goalId: "a", bucket: "result_ready" })
  const newer = goal({ goalId: "b", bucket: "result_ready" })
  const seen = goal({ goalId: "c", bucket: "result_ready" })
  const events = [
    event({ goalId: "a", revision: 1, createdAt: "2026-11-09T01:00:00.000Z" }),
    event({ goalId: "b", revision: 1, createdAt: "2026-11-09T02:00:00.000Z" }),
  ]
  const items = buildWorkPriority({
    goals: [older, newer, seen],
    events,
    isResultViewed: (item) => item.goalId === "c",
  })
  assert.deepEqual(items.map((item) => item.goal.goalId), ["b", "a"])
})

test("attention labels follow the action type", () => {
  const cases = [
    ["open_question", "回答问题"],
    ["open_direction_review", "裁定方向"],
    ["open_goal", "打开工作"],
  ] as const
  for (const [type, label] of cases) {
    const item = goal({
      goalId: type,
      bucket: "needs_you",
      stage: { owner: "person", kind: "question", action: { type, goalId: type } },
    })
    const [priority] = buildWorkPriority({ goals: [item], events: [], isResultViewed: () => false })
    assert.equal(priority.kind === "attention" ? priority.label : null, label)
  }
})

test("goalModeLabel keeps Quick/Standard readable and falls back to the raw mode", () => {
  assert.equal(goalModeLabel("quick"), "Quick")
  assert.equal(goalModeLabel("standard"), "Standard")
  assert.equal(goalModeLabel("standing"), "Standing")
  assert.equal(goalModeLabel(undefined), null)
  assert.equal(goalModeLabel("custom"), "custom")
})
