import type { PodGoalView } from "../../../src/core/pod/pod-view";
import { deriveAttention } from "../../../src/core/lead/attention";

function view(over: Partial<PodGoalView> & { goalId: string }): PodGoalView {
  return {
    id: `row-${over.goalId}`,
    podId: "pod_1",
    goalId: over.goalId,
    status: "active",
    title: `Goal ${over.goalId}`,
    phase: null,
    verdict: null,
    stage: { owner: "team", kind: "working" },
    bucket: "in_progress" as any,
    resultReady: false,
    accepted: false,
    progress: null,
    sourceRef: null,
    strategy: null,
    assessment: null,
    currentAssignment: null,
    pendingQuestion: null,
    activeRevision: 1,
    revision: 1,
    priority: 0,
    enqueuedAt: "2026-11-10T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    ...over,
  } as PodGoalView;
}

describe("deriveAttention", () => {
  test("person/team/system classification and coalescing", () => {
    const items = deriveAttention([
      view({ goalId: "g1", stage: { owner: "person", kind: "plan_approval" } as any }),
      view({ goalId: "g1", stage: { owner: "person", kind: "plan_approval" } as any }),
      view({ goalId: "g2", stage: { owner: "person", kind: "reviewing" } as any, resultReady: true }),
      view({ goalId: "g3", stage: { owner: "team", kind: "working" } as any }),
      view({ goalId: "g4", stage: { owner: "person", kind: "blocked" } as any, lastError: "worktree_unavailable" }),
    ]);

    expect(items.map((item) => `${item.goalId}:${item.kind}`)).toEqual([
      "g1:plan_approval", "g2:review", "g4:failed",
    ]);
    expect(items.every((item) => item.coalesceKey.includes(item.goalId))).toBe(true);
    expect(items.map((item) => item.priority)).toEqual([100, 70, 60]);
  });

  test("maps question/direction and ignores healthy or ended goals", () => {
    const items = deriveAttention([
      view({ goalId: "q", stage: { owner: "person", kind: "question" } as any }),
      view({ goalId: "d", stage: { owner: "person", kind: "direction_review" } as any }),
      view({ goalId: "blocked", stage: { owner: "person", kind: "blocked" } as any }),
      view({ goalId: "missing", stage: { owner: "person", kind: "blocked" } as any, stateMissing: true }),
      view({ goalId: "ended", endedAt: "2026-11-10T00:00:00.000Z", stage: { owner: "person", kind: "plan_approval" } as any }),
      view({ goalId: "ready", stage: { owner: "person", kind: "result_notified" } as any, resultReady: true }),
      view({ goalId: "not-ready", stage: { owner: "person", kind: "result_notified" } as any }),
    ]);

    expect(items.map((item) => `${item.goalId}:${item.kind}`)).toEqual([
      "d:direction_review", "q:answer", "ready:review", "blocked:blocked",
    ]);
  });
});
