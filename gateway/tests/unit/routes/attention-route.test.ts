import { handleAttention } from "../../../src/routes/attention";
import type { PodGoalView } from "../../../src/core/pod/pod-view";
import type { DecisionRecord } from "../../../src/core/decision/decision-record";

const record = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: "dec_1",
  projectDir: "/p",
  goalId: "g1",
  revision: 1,
  kind: "plan",
  status: "draft",
  question: "采用哪个方案？",
  options: [],
  evidence: [],
  rationale: "方案 A 更省改动",
  consequences: null,
  reviewAt: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  history: [],
  ...over,
});

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

  test("appends draft decisions after the Goal facts and reviews", () => {
    const dirs: string[] = [];
    const out = handleAttention({ projectDir: "/p" }, {
      views: () => [view("g1")],
      reviews: () => [{
        id: "item_1",
        goalId: "g1",
        revision: 1,
        title: "src/a.ts:12",
        rel: "src/a.ts",
        line: 12,
        comment: "这里要补测试",
      }],
      decisions: (projectDir) => {
        dirs.push(projectDir);
        return [record()];
      },
    });

    expect(dirs).toEqual(["/p"]);
    expect(out.body.items.map((item: any) => item.kind)).toEqual([
      "plan_approval", "decision", "review_item",
    ]);
    expect(out.body.items[1].action).toEqual({
      type: "open_decision", goalId: "g1", itemId: "dec_1",
    });
  });

  test("draft decisions without a goal are not goal-scoped attention", () => {
    const out = handleAttention({ projectDir: "/p" }, {
      views: () => [view("g1")],
      decisions: () => [record({ goalId: null }), record({ id: "dec_2", status: "decided" })],
    });
    expect(out.body.items.map((item: any) => item.kind)).toEqual(["plan_approval"]);
  });
});
