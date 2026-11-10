import { describe, expect, test } from "bun:test"
import type { PodGoal, PodGoalStage } from "@mafw/sdk"
import { buildAttentionList } from "./work-overview-model"

function goal(over: Partial<PodGoal> & { goalId: string }): PodGoal {
  return {
    id: `row-${over.goalId}`,
    podId: "pod_1",
    goalId: over.goalId,
    status: "active",
    title: `Goal ${over.goalId}`,
    phase: null,
    verdict: null,
    stage: { owner: "team", kind: "working" } as PodGoalStage,
    bucket: "in_progress" as any,
    resultReady: false,
    progress: null,
    activeRevision: 1,
    revision: 1,
    priority: 0,
    enqueuedAt: "2026-11-10T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    ...over,
  } as PodGoal
}

describe("buildAttentionList", () => {
  test("health never appears in the attention list", () => {
    const items = buildAttentionList({
      goals: [goal({ goalId: "healthy", stage: { owner: "team", kind: "working" } as any })],
      attention: [],
      isResultViewed: () => false,
    })
    expect(items).toEqual([])
  })

  test("person items sort before result-ready", () => {
    const items = buildAttentionList({
      goals: [
        goal({ goalId: "ready", stage: { owner: "team", kind: "result_notified" } as any, bucket: "result_ready" as any, resultReady: true }),
        goal({ goalId: "blocked", stage: { owner: "person", kind: "blocked" } as any }),
      ],
      attention: [],
      isResultViewed: () => false,
    })
    expect(items.map((item) => item.goal.goalId)).toEqual(["blocked", "ready"])
    expect(items[0].kind).toBe("blocked")
    expect(items[1].kind).toBe("review")
  })

  test("maps plan/question/direction and failed", () => {
    const items = buildAttentionList({
      goals: [
        goal({ goalId: "plan", stage: { owner: "person", kind: "plan_approval" } as any }),
        goal({ goalId: "question", stage: { owner: "person", kind: "question" } as any }),
        goal({ goalId: "direction", stage: { owner: "person", kind: "direction_review" } as any }),
        goal({ goalId: "failed", stage: { owner: "person", kind: "blocked" } as any, lastError: "worktree_unavailable" }),
      ],
      attention: [],
      isResultViewed: () => false,
    })
    expect(items.map((item) => `${item.goal.goalId}:${item.kind}`)).toEqual([
      "plan:plan_approval", "direction:direction_review", "question:answer", "failed:failed",
    ])
  })
})
