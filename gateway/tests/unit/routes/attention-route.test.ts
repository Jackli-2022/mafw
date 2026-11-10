import { handleAttention } from "../../../src/routes/attention";
import type { PodGoalView } from "../../../src/core/pod/pod-view";

const view = (goalId: string, over: Partial<PodGoalView> = {}): PodGoalView => ({
  id: `row-${goalId}`,
  podId: "pod_1",
  goalId,
  status: "active",
  title: `Goal ${goalId}`,
  phase: null,
  verdict: null,
  stage: { owner: "person", kind: "plan_approval" },
  bucket: "needs_you" as any,
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
} as PodGoalView);

describe("GET /api/attention", () => {
  test("returns person-first items for the project", () => {
    const out = handleAttention({ projectDir: "/p" }, {
      views: () => [view("g1"), view("g2", { stage: { owner: "team", kind: "working" } as any })],
    });
    expect(out.status).toBe(200);
    expect(out.body.items.map((item: any) => item.goalId)).toEqual(["g1"]);
  });

  test("is empty when the project has no Pod", () => {
    const out = handleAttention({ projectDir: "/p" }, { views: () => [] });
    expect(out.body.items).toEqual([]);
  });
});
