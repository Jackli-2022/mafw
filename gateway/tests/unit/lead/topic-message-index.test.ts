import Database from "better-sqlite3";
import { LeadTopicStore } from "../../../src/core/lead/lead-topic-store";
import { TopicMessageIndexStore } from "../../../src/core/lead/topic-message-index";

const topic = (id: string) => ({
  id,
  projectDir: "/p",
  leadSessionId: "s1",
  title: `topic ${id}`,
  startMessageId: "m1",
  endMessageId: "m2",
  goalId: `g-${id}`,
  ownerRole: "tech-lead" as const,
  ownerSessionId: null,
  createdAt: "2026-11-10T01:00:00.000Z",
});

describe("TopicMessageIndexStore", () => {
  test("replaces a topic's rows and returns them newest-first", () => {
    const db = new Database(":memory:");
    new LeadTopicStore(db).insert(topic("t1"));
    const index = new TopicMessageIndexStore(db);

    index.replaceTopic("t1", [
      { topicId: "t1", messageId: "m1", role: "user", text: "one", tokenEstimate: 1, createdAt: "2026-11-10T01:00:00.000Z" },
      { topicId: "t1", messageId: "m2", role: "assistant", text: "two", tokenEstimate: 1, createdAt: "2026-11-10T02:00:00.000Z" },
    ]);
    expect(index.listByTopic("t1").map((row) => row.messageId)).toEqual(["m2", "m1"]);

    index.replaceTopic("t1", [
      { topicId: "t1", messageId: "m3", role: "user", text: "three", tokenEstimate: 1, createdAt: "2026-11-10T03:00:00.000Z" },
    ]);
    expect(index.listByTopic("t1").map((row) => row.messageId)).toEqual(["m3"]);
  });

  test("lists index rows across topics in a project", () => {
    const db = new Database(":memory:");
    const topics = new LeadTopicStore(db);
    topics.insert(topic("t1"));
    topics.insert({ ...topic("t2"), createdAt: "2026-11-10T02:00:00.000Z" });
    const index = new TopicMessageIndexStore(db);
    index.replaceTopic("t1", [
      { topicId: "t1", messageId: "m1", role: "user", text: "one", tokenEstimate: 1, createdAt: "2026-11-10T01:00:00.000Z" },
    ]);
    index.replaceTopic("t2", [
      { topicId: "t2", messageId: "m2", role: "user", text: "two", tokenEstimate: 1, createdAt: "2026-11-10T02:00:00.000Z" },
    ]);

    expect(index.listByProject("/p").map((row) => `${row.topicId}:${row.messageId}`)).toEqual(["t2:m2", "t1:m1"]);
  });
});
