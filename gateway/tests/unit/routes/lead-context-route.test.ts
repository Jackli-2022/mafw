import { handleLeadContext } from "../../../src/routes/lead-topics";
import type { LeadTopicRow } from "../../../src/core/lead/lead-topic-store";

const topicRow = (id: string): LeadTopicRow => ({
  id,
  projectDir: "/p",
  leadSessionId: "s1",
  title: "SQLite 迁移",
  startMessageId: "m1",
  endMessageId: "m2",
  goalId: "g1",
  ownerRole: "tech-lead",
  ownerSessionId: null,
  createdAt: "2026-11-10T00:00:00.000Z",
  summary: "决定：使用 SQLite",
  summaryHash: "hash",
  summaryUpdatedAt: "2026-11-10T00:00:00.000Z",
  state: "warm",
  lastActiveAt: "2026-11-10T00:00:00.000Z",
  residentTokens: 10,
  resumedFrom: null,
});

function deps(over: Record<string, any> = {}) {
  return {
    isLeadSession: () => true,
    projectDirForSession: () => "/p",
    topics: { listByProject: () => [topicRow("t1")] },
    index: {
      listByTopic: () => [],
      listByProject: () => [],
    },
    goals: () => [{
      goalId: "g1", title: "Goal g1", stage: "plan_approval",
      progress: { done: 0, total: 1 }, blockers: [], pendingAttention: 0,
      lastUpdate: "2026-11-10T00:00:00.000Z",
    }],
    workingSetEnabled: () => true,
    ...over,
  } as any;
}

describe("GET /api/lead/context", () => {
  test("returns context for a Lead session", () => {
    const out = handleLeadContext({ sessionID: "ses_lead", query: "sqlite" }, deps());
    expect(out.status).toBe(200);
    expect(out.body.blocks.map((b: any) => b.kind)).toEqual(["goal-status", "topic-index", "recalled-topic"]);
    expect(out.body.recalledTopicIds).toEqual(["t1"]);
  });

  test("is empty for a non-Lead session or a disabled working set", () => {
    const worker = handleLeadContext({ sessionID: "ses_worker", query: "x" }, deps({ isLeadSession: () => false }));
    expect(worker.body).toMatchObject({ blocks: [], totalTokens: 0, recalledTopicIds: [] });

    const disabled = handleLeadContext({ sessionID: "ses_lead", query: "x" }, deps({ workingSetEnabled: () => false }));
    expect(disabled.body).toMatchObject({ blocks: [], totalTokens: 0, recalledTopicIds: [] });
  });

  test("does not recall the resident or archived topic", () => {
    const base = topicRow("t1");
    const topics = [
      { ...base, id: "resident", title: "SQLite current", state: "resident" as const },
      { ...base, id: "archived", title: "SQLite old", state: "archived" as const },
      { ...base, id: "warm", title: "SQLite warm", state: "warm" as const },
    ];
    const out = handleLeadContext({ sessionID: "ses_lead", query: "sqlite" }, deps({
      topics: { listByProject: () => topics },
    }));
    expect(out.body.recalledTopicIds).toEqual(["warm"]);
  });

  test("reads the index once and pins the active Goal source topic", () => {
    const base = topicRow("p");
    const out = handleLeadContext({ sessionID: "ses_lead", query: "" }, deps({
      topics: { listByProject: () => [{ ...base, title: "Pinned topic", state: "cold" as const }] },
      index: {
        listByTopic: () => { throw new Error("N+1 index read"); },
        listByProject: () => [{
          topicId: "p", messageId: "m1", role: "user", text: "pinned",
          tokenEstimate: 1, createdAt: "2026-11-10T00:00:00.000Z",
        }],
      },
      goals: () => [{
        goalId: "g1", title: "Goal g1", stage: "working",
        progress: null, blockers: [], pendingAttention: 0,
        lastUpdate: "2026-11-10T00:00:00.000Z", sourceTopicId: "p",
      }],
    }));

    expect(out.body.blocks.find((b: any) => b.kind === "topic-index")?.text).toContain("Pinned topic");
  });

  test("is empty when the session cannot be mapped to a project", () => {
    const out = handleLeadContext({ sessionID: "ses_lead", query: "x" }, deps({ projectDirForSession: () => null }));
    expect(out.body).toMatchObject({ blocks: [], totalTokens: 0 });
  });
});
