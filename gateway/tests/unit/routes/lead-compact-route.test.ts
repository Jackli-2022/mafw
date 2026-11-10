import { handleCompact } from "../../../src/routes/lead-topics";
import type { MafwMessage } from "../../../src/runtime/canonical-types";
import type { LeadTopicRow } from "../../../src/core/lead/lead-topic-store";

const msg = (id: string, role: "user" | "assistant", text: string): MafwMessage => ({
  id,
  role,
  content: [{ type: "text", text }],
});

function deps(over: Record<string, any> = {}) {
  const state = { value: "resident" as LeadTopicRow["state"], summary: null as string | null };
  const row: LeadTopicRow = {
    id: "t1", projectDir: "/p", leadSessionId: "ses_lead", title: "T",
    startMessageId: "m1", endMessageId: "m3", goalId: "g1",
    ownerRole: "tech-lead", ownerSessionId: null,
    createdAt: "2026-11-10T00:00:00.000Z",
    summary: null, summaryHash: null, summaryUpdatedAt: null,
    state: "resident", lastActiveAt: "2026-11-10T00:00:00.000Z",
    residentTokens: 10, resumedFrom: null,
  };
  const topics = {
    get: (id: string) => (id === "t1" ? { ...row, state: state.value, summary: state.summary } : null),
    updateSummary: (_id: string, input: any) => { state.summary = input.summary; },
    setState: (_id: string, next: LeadTopicRow["state"]) => { state.value = next; },
    listByProject: () => [],
    search: () => [],
  };
  const index = { listByTopic: () => [], listByProject: () => [], replaceTopic: jest.fn() };
  const broadcast = jest.fn();
  return {
    deps: {
      isLeadSession: () => true,
      projectDirForSession: () => "/p",
      topics,
      index,
      goals: () => [],
      workingSetEnabled: () => true,
      listMessages: async () => ({
        data: [
          msg("m1", "user", "决定：使用 SQLite"),
          ...Array.from({ length: 12 }, (_, i) => msg(`f${i}`, "assistant", "work")),
          msg("m14", "user", "继续"),
        ],
      }),
      broadcast,
      ...over,
    } as any,
    topics,
    index,
    broadcast,
    state,
  };
}

describe("POST /api/lead/compact", () => {
  test("rewrites summary, evicts old messages and emits one event", async () => {
    const h = deps();
    const out = await handleCompact({ topicId: "t1" }, h.deps);

    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ topicId: "t1", evictedMessageIds: expect.arrayContaining(["m1"]) });
    expect(h.topics.get("t1")?.state).toBe("warm");
    expect(h.topics.get("t1")?.summary).toContain("决定：使用 SQLite");
    expect(h.index.replaceTopic).toHaveBeenCalledWith("t1", expect.any(Array));
    expect(h.broadcast).toHaveBeenCalledTimes(1);
    expect(h.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: "lead.compaction",
      properties: expect.objectContaining({ topicId: "t1" }),
    }));
  });

  test("is neutral 503 when the working set is disabled or deps are missing", async () => {
    const disabled = deps({ workingSetEnabled: () => false });
    expect((await handleCompact({ topicId: "t1" }, disabled.deps)).status).toBe(503);

    const missing = deps({ listMessages: undefined });
    expect((await handleCompact({ topicId: "t1" }, missing.deps)).status).toBe(503);
  });

  test("404s an unknown topic", async () => {
    const h = deps();
    expect((await handleCompact({ topicId: "nope" }, h.deps)).status).toBe(404);
  });

  test("scopes compaction to the topic message range", async () => {
    const h = deps();
    const state = h.state;
    h.deps.topics.get = () => ({
      id: "t1", projectDir: "/p", leadSessionId: "ses_lead", title: "T1",
      startMessageId: "m1", endMessageId: "m2", goalId: "g1",
      ownerRole: "tech-lead", ownerSessionId: null,
      createdAt: "2026-11-10T00:00:00.000Z",
      summary: state.summary, summaryHash: null, summaryUpdatedAt: null,
      state: state.value, lastActiveAt: "2026-11-10T00:00:00.000Z",
      residentTokens: 10, resumedFrom: null,
    });
    h.deps.listMessages = async () => ({
      data: [
        msg("m1", "user", "决定：主题一"),
        msg("m2", "assistant", "收到"),
        msg("m3", "user", "决定：主题二不应被压缩"),
        msg("m4", "assistant", "ok"),
      ],
    });

    const out = await handleCompact({ topicId: "t1" }, h.deps);
    expect(out.status).toBe(200);
    expect(h.topics.get("t1")?.summary).toContain("主题一");
    expect(h.topics.get("t1")?.summary).not.toContain("主题二");
    expect(h.index.replaceTopic).toHaveBeenCalledWith(
      "t1",
      expect.arrayContaining([expect.objectContaining({ messageId: "m1" })]),
    );
    const rows = h.index.replaceTopic.mock.calls[0][1];
    expect(rows.map((row: any) => row.messageId)).toEqual(["m1", "m2"]);
  });
});
