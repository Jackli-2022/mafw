import { TopicMemoryService } from "../../../src/core/lead/topic-memory-service";

const topic = {
  id: "t1",
  projectDir: "/p",
  leadSessionId: "s1",
  title: "SQLite",
  startMessageId: "m1",
  endMessageId: "m3",
  goalId: "g1",
  ownerRole: "tech-lead" as const,
  ownerSessionId: null,
  createdAt: "2026-11-10T00:00:00.000Z",
  summary: "决定：A",
  summaryHash: "hash",
  summaryUpdatedAt: "2026-11-10T00:00:00.000Z",
  state: "warm" as const,
  lastActiveAt: "2026-11-10T00:00:00.000Z",
  residentTokens: 10,
  resumedFrom: null,
};

function service(over: Record<string, any> = {}) {
  const addMemory = jest.fn(async () => {});
  const promoted = new Set<string>();
  const svc = new TopicMemoryService({
    topics: { findByGoal: () => topic },
    addMemory,
    enabled: () => true,
    now: () => "2026-11-10T00:00:00.000Z",
    wasPromoted: (key) => promoted.has(key),
    markPromoted: (key) => promoted.add(key),
    ...over,
  });
  return { svc, addMemory, promoted };
}

describe("TopicMemoryService", () => {
  test("promotes once per topic summary hash", async () => {
    const h = service();
    expect(await h.svc.promoteForGoal("g1")).toBe(true);
    expect(h.addMemory).toHaveBeenCalledTimes(1);
    expect(await h.svc.promoteForGoal("g1")).toBe(false);
    expect(h.addMemory).toHaveBeenCalledTimes(1);
  });

  test("skips disabled, missing, and summary-less topics", async () => {
    expect((await service({ enabled: () => false }).svc.promoteForGoal("g1"))).toBe(false);
    expect((await service({ topics: { findByGoal: () => null } }).svc.promoteForGoal("g1"))).toBe(false);
    expect((await service({
      topics: { findByGoal: () => ({ ...topic, summary: null }) },
    }).svc.promoteForGoal("g1"))).toBe(false);
  });
});
