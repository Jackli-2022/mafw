import {
  handleForkTopic,
  handleGetTopic,
  handleListTopics,
  handleRecall,
  handleWorkingSet,
} from "../../../src/routes/lead-topics";
import type { LeadTopicRow } from "../../../src/core/lead/lead-topic-store";

const row = (id: string, over: Partial<LeadTopicRow> = {}): LeadTopicRow => ({
  id,
  projectDir: "/p",
  leadSessionId: "ses_hidden",
  title: id === "t1" ? "SQLite 迁移" : "UI polish",
  startMessageId: "m1",
  endMessageId: "m2",
  goalId: `g-${id}`,
  ownerRole: "tech-lead",
  ownerSessionId: null,
  createdAt: "2026-11-10T00:00:00.000Z",
  summary: id === "t1" ? "决定：使用 SQLite" : "CSS 调整",
  summaryHash: "hash",
  summaryUpdatedAt: "2026-11-10T00:00:00.000Z",
  state: id === "t1" ? "warm" : "cold",
  lastActiveAt: id === "t1" ? "2026-11-10T02:00:00.000Z" : "2026-11-09T00:00:00.000Z",
  residentTokens: 10,
  resumedFrom: null,
  ...over,
});

function deps(over: Record<string, any> = {}) {
  const rows = [row("t1"), row("t2")];
  return {
    isLeadSession: () => true,
    projectDirForSession: () => "/p",
    topics: {
      listByProject: () => rows,
      search: (_projectDir: string, query: string) => rows.filter((item) => {
        const q = query.toLowerCase();
        return item.title.toLowerCase().includes(q) || (item.summary ?? "").toLowerCase().includes(q);
      }),
      get: (id: string) => rows.find((item) => item.id === id) ?? null,
    },
    index: {
      listByTopic: (id: string) => id === "t1"
        ? [{ topicId: "t1", messageId: "m1", role: "user", text: "决定：使用 SQLite", tokenEstimate: 5, createdAt: "2026-11-10T00:00:00.000Z" }]
        : [],
      listByProject: () => [],
    },
    goals: () => [],
    workingSetEnabled: () => true,
    ...over,
  } as any;
}

describe("lead topic routes", () => {
  test("topic list filters by query and never leaks session ids", () => {
    const out = handleListTopics({ projectDir: "/p", query: "sqlite" }, deps());
    expect(out.status).toBe(200);
    expect(out.body.items.map((t: any) => t.id)).toEqual(["t1"]);
    expect(JSON.stringify(out.body)).not.toContain("ses_");
  });

  test("topic detail returns the index and 404s unknown ids", () => {
    const out = handleGetTopic({ id: "t1" }, deps());
    expect(out.body.topic).toMatchObject({ id: "t1", summary: "决定：使用 SQLite" });
    expect(out.body.messages.map((m: any) => m.messageId)).toEqual(["m1"]);
    expect(JSON.stringify(out.body)).not.toContain("ses_");

    expect(handleGetTopic({ id: "nope" }, deps()).status).toBe(404);
  });

  test("working-set separates resident/warm/cold and recall is diagnostic only", () => {
    const ws = handleWorkingSet({ projectDir: "/p" }, deps());
    expect(ws.status).toBe(200);
    expect(ws.body.warm).toEqual(expect.arrayContaining(["t1"]));
    expect(ws.body.topics.find((t: any) => t.id === "t1")).toMatchObject({ state: "warm" });

    const recall = handleRecall({ projectDir: "/p", q: "sqlite" }, deps());
    expect(recall.body.candidates[0].topicId).toBe("t1");
  });

  test("recall is empty when the working set is disabled", () => {
    const out = handleRecall({ projectDir: "/p", q: "sqlite" }, deps({ workingSetEnabled: () => false }));
    expect(out.body.candidates).toEqual([]);
  });

  test("forks a topic through the injected Goal creator", async () => {
    const fork = jest.fn(async () => ({ goalId: "g-fork", sessionID: "ses_tl" }));
    const out = await handleForkTopic({ id: "t1", goalTitle: "Fork" }, deps({ fork }));
    expect(out).toMatchObject({ status: 200, body: { goalId: "g-fork", sessionID: "ses_tl" } });
    expect(fork).toHaveBeenCalledWith("t1", { goalTitle: "Fork" });
    expect((await handleForkTopic({ id: "t1" }, deps({ fork: undefined }))).status).toBe(503);
  });
});
