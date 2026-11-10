import { buildRecalledBlock, recallTopics, type RecallTopicInput } from "../../../src/core/lead/topic-recall";

const topic = (over: Partial<RecallTopicInput> & Pick<RecallTopicInput, "id" | "title">): RecallTopicInput => ({
  summary: null,
  index: [],
  ...over,
});

describe("topic recall", () => {
  test("scores title above summary and drops low confidence", () => {
    const topics = [
      topic({ id: "t1", title: "SQLite 迁移" }),
      topic({ id: "t2", title: "UI polish", summary: "migration notes" }),
    ];

    const [first] = recallTopics({ query: "sqlite 迁移", topics });
    expect(first).toMatchObject({ topicId: "t1" });
    expect(first.score).toBeGreaterThan(0.8);
    expect(recallTopics({ query: "weather tomorrow", topics })).toEqual([]);
  });

  test("caps the number of recalled topics", () => {
    const topics = [
      topic({ id: "t1", title: "SQLite 迁移" }),
      topic({ id: "t2", title: "SQLite 迁移 two" }),
      topic({ id: "t3", title: "SQLite 迁移 three" }),
    ];
    expect(recallTopics({ query: "sqlite", topics }).map((c) => c.topicId)).toEqual(["t1", "t2"]);
  });

  test("recalled block names the source topic and keeps summary", () => {
    const block = buildRecalledBlock(
      { topicId: "t1", title: "SQLite 迁移", score: 0.9, matches: ["sqlite"] },
      topic({
        id: "t1",
        title: "SQLite 迁移",
        summary: "决定：使用 SQLite",
        index: [
          { topicId: "t1", messageId: "m1", role: "assistant", text: "assistant note", tokenEstimate: 1, createdAt: "2026-11-10T01:00:00.000Z" },
          { topicId: "t1", messageId: "m2", role: "user", text: "用户原话", tokenEstimate: 1, createdAt: "2026-11-10T00:00:00.000Z" },
        ],
      }),
    );

    expect(block).toContain('<recalled-topic topicId="t1"');
    expect(block).toContain('title="SQLite 迁移"');
    expect(block).toContain("决定：使用 SQLite");
    expect(block).toContain("[user] 用户原话");
    expect(block.indexOf("[user]")).toBeLessThan(block.indexOf("[assistant]"));
  });

  test("does not fake a summary when none exists", () => {
    const block = buildRecalledBlock(
      { topicId: "t1", title: "T", score: 0.5, matches: ["t"] },
      topic({ id: "t1", title: "T" }),
    );
    expect(block).toContain("(no summary yet)");
  });
});
