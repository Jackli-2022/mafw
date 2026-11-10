import {
  DEFAULT_WORKING_SET_BUDGET,
  estimateTopicTokens,
  selectWorkingSet,
  type WorkingSetTopic,
} from "../../../src/core/lead/working-set";

function topic(
  id: string,
  state: WorkingSetTopic["state"],
  lastActiveAt: string,
  goalId = `g-${id}`,
  residentTokens = 0,
): WorkingSetTopic {
  return { id, state, summary: null, lastActiveAt, goalId, residentTokens };
}

describe("working set", () => {
  test("selects resident/pinned/warm/cold by recency and budget", () => {
    const ws = selectWorkingSet({
      topics: [
        topic("r", "resident", "2026-11-10T04:00:00.000Z"),
        topic("p", "cold", "2026-11-09T00:00:00.000Z", "g1"),
        topic("w1", "warm", "2026-11-10T03:00:00.000Z"),
        topic("w2", "warm", "2026-11-10T02:00:00.000Z"),
        topic("w3", "warm", "2026-11-10T01:00:00.000Z"),
      ],
      pinnedTopicIds: ["p"],
      budget: { warmTopicLimit: 2 },
    });

    expect(ws.resident).toEqual(["r"]);
    expect(ws.pinned).toEqual(["p"]);
    expect(ws.warm).toEqual(["w1", "w2"]);
    expect(ws.cold).toEqual(["w3"]);
    expect(ws.evicted).toEqual([]);
  });

  test("evicts the oldest resident when over the token budget, keeping one", () => {
    const ws = selectWorkingSet({
      topics: [
        topic("old", "resident", "2026-11-10T01:00:00.000Z", "g1", 60),
        topic("mid", "resident", "2026-11-10T02:00:00.000Z", "g1", 60),
        topic("new", "resident", "2026-11-10T03:00:00.000Z", "g1", 60),
      ],
      budget: { maxResidentTokens: 100 },
    });

    expect(ws.resident).toEqual(["new"]);
    expect(ws.evicted).toEqual(["old", "mid"]);
  });

  test("pinned topics never fall into cold", () => {
    const ws = selectWorkingSet({
      topics: [topic("p", "cold", "2026-11-09T00:00:00.000Z"), topic("x", "warm", "2026-11-10T00:00:00.000Z")],
      pinnedTopicIds: ["p"],
      budget: { warmTopicLimit: 0 },
    });
    expect(ws.pinned).toEqual(["p"]);
    expect(ws.cold).toEqual(["x"]);
  });

  test("estimateTopicTokens keeps CJK/latin deterministic", () => {
    expect(estimateTopicTokens("")).toBe(0);
    expect(estimateTopicTokens("hello world")).toBe(2);
    expect(estimateTopicTokens("你好世界")).toBe(2);
    expect(estimateTopicTokens("hello 世界")).toBe(2);
    expect(DEFAULT_WORKING_SET_BUDGET.recallMaxTopics).toBe(2);
    expect(DEFAULT_WORKING_SET_BUDGET.recallMaxTokens).toBe(1200);
  });
});
