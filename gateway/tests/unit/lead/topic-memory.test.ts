import type { LeadTopicRow } from "../../../src/core/lead/lead-topic-store";
import { buildTopicMemory } from "../../../src/core/lead/topic-memory";

const NOW = "2026-11-10T00:00:00.000Z";

const topic = (over: Partial<LeadTopicRow> = {}): LeadTopicRow => ({
  id: "t1",
  projectDir: "/p",
  leadSessionId: "s1",
  title: "SQLite 迁移",
  startMessageId: "m1",
  endMessageId: "m3",
  goalId: "g1",
  ownerRole: "tech-lead",
  ownerSessionId: null,
  createdAt: NOW,
  summary: "决定：A",
  summaryHash: "hash",
  summaryUpdatedAt: NOW,
  state: "warm",
  lastActiveAt: NOW,
  residentTokens: 10,
  resumedFrom: null,
  ...over,
});

test("builds a semantic memory with stable anchors", () => {
  const memory = buildTopicMemory({
    topic: topic(),
    summary: "决定：A",
    goalId: "g1",
    projectDir: "/p",
  });
  expect(memory.memoryType).toBe("semantic");
  expect(memory.content).toContain("决定：A");
  expect(memory.content).toContain("SQLite 迁移");
  expect(memory.cueAnchors).toEqual(expect.arrayContaining(["t1", "g1", "/p"]));
});
