import { buildLeadContext } from "../../../src/core/lead/lead-context";
import type { LeadGoalStatus } from "../../../src/core/lead/goal-status";
import type { LeadTopicRow } from "../../../src/core/lead/lead-topic-store";
import type { RecallTopicInput } from "../../../src/core/lead/topic-recall";

const status = (goalId: string, stage: string): LeadGoalStatus => ({
  goalId,
  title: `Goal ${goalId}`,
  stage,
  progress: { done: 1, total: 2 },
  blockers: [],
  pendingAttention: 0,
  lastUpdate: "2026-11-10T00:00:00.000Z",
});

const topic = (id: string, title: string, summary: string | null): LeadTopicRow => ({
  id,
  projectDir: "/p",
  leadSessionId: "s1",
  title,
  startMessageId: "m1",
  endMessageId: "m2",
  goalId: `g-${id}`,
  ownerRole: "tech-lead",
  ownerSessionId: null,
  createdAt: "2026-11-10T00:00:00.000Z",
  summary,
  summaryHash: summary ? "hash" : null,
  summaryUpdatedAt: summary ? "2026-11-10T00:00:00.000Z" : null,
  state: "warm",
  lastActiveAt: "2026-11-10T00:00:00.000Z",
  residentTokens: 10,
  resumedFrom: null,
});

const recallTopic = (id: string): RecallTopicInput => ({
  id,
  title: "SQLite 迁移",
  summary: "决定：使用 SQLite",
  index: [],
});

describe("buildLeadContext", () => {
  test("assembles goal status, topic index and recalled blocks in order", () => {
    const ctx = buildLeadContext({
      goals: [status("g1", "plan_approval")],
      topics: [topic("t1", "SQLite 迁移", "决定：使用 SQLite")],
      query: "sqlite",
      recalled: [{
        candidate: { topicId: "t1", title: "SQLite 迁移", score: 0.9, matches: ["sqlite"] },
        topic: recallTopic("t1"),
      }],
    });

    expect(ctx.blocks.map((b) => b.kind)).toEqual(["goal-status", "topic-index", "recalled-topic"]);
    expect(ctx.recalledTopicIds).toEqual(["t1"]);
    expect(ctx.totalTokens).toBeGreaterThan(0);
    expect(ctx.trimmed).toEqual([]);
  });

  test("drops recalled blocks before the topic index when over budget", () => {
    const ctx = buildLeadContext({
      goals: [status("g1", "working")],
      topics: [topic("t1", "SQLite 迁移", "决定：使用 SQLite")],
      query: "sqlite",
      recalled: [{
        candidate: { topicId: "t1", title: "SQLite 迁移", score: 0.9, matches: ["sqlite"] },
        topic: recallTopic("t1"),
      }],
      budget: { recallMaxTokens: 0 },
    });

    expect(ctx.blocks.some((b) => b.kind === "recalled-topic")).toBe(false);
    expect(ctx.trimmed).toContain("recalled-topic");
    expect(ctx.recalledTopicIds).toEqual([]);
  });

  test("truncates topic index lines and keeps at least one", () => {
    const topics = Array.from({ length: 8 }, (_, i) => topic(`t${i}`, `Topic ${i}`, "summary ".repeat(50)));
    const ctx = buildLeadContext({
      goals: [status("g1", "working")],
      topics,
      query: "",
      budget: { warmTopicLimit: 5, warmTopicTokens: 10, recallMaxTokens: 1200 },
    });

    const index = ctx.blocks.find((b) => b.kind === "topic-index")!;
    expect(index.text.split("\n").length).toBeLessThanOrEqual(4);
    expect(index.text).toContain("- ");
    expect(ctx.trimmed).toContain("topic-index");
  });
});
