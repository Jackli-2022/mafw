import Database from "better-sqlite3";
import { LeadTopicStore } from "../../../src/core/lead/lead-topic-store";
import { TopicMessageIndexStore } from "../../../src/core/lead/topic-message-index";

const baseTopic = (id: string) => ({
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

const indexRow = (topicId: string, messageId: string, role: "user" | "assistant", text: string) => ({
  topicId,
  messageId,
  role,
  text,
  tokenEstimate: text.length,
  createdAt: "2026-11-10T01:00:00.000Z",
});

describe("LeadTopicStore", () => {
  test("inserts and reads topics newest-first", () => {
    const db = new Database(":memory:");
    const store = new LeadTopicStore(db);
    store.insert({
      id: "t1", projectDir: "/p", leadSessionId: "s1", title: "one",
      startMessageId: "m1", endMessageId: "m2", goalId: "g1",
      ownerRole: "tech-lead", ownerSessionId: "s2",
      createdAt: "2026-11-10T01:00:00.000Z",
    });
    store.insert({
      id: "t2", projectDir: "/p", leadSessionId: "s1", title: "two",
      startMessageId: "m3", endMessageId: "m4", goalId: "g2",
      ownerRole: "tech-lead", ownerSessionId: "s3",
      createdAt: "2026-11-10T02:00:00.000Z",
    });

    expect(store.latestForProject("/p")?.id).toBe("t2");
    expect(store.listByProject("/p").map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(store.get("t1")?.goalId).toBe("g1");
  });

  test("same createdAt resolves by id, not insertion order", () => {
    const db = new Database(":memory:");
    const store = new LeadTopicStore(db);
    store.insert(baseTopic("t1"));
    store.insert(baseTopic("t2"));

    expect(store.latestForProject("/p")?.id).toBe("t2");
    expect(store.listByProject("/p").map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  test("legacy lead_topic rows migrate to warm with null summary defaults", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE lead_topic (
      id TEXT PRIMARY KEY, project_dir TEXT NOT NULL, lead_session_id TEXT NOT NULL,
      title TEXT NOT NULL, start_message_id TEXT NOT NULL, end_message_id TEXT NOT NULL,
      goal_id TEXT NOT NULL, owner_role TEXT NOT NULL, owner_session_id TEXT, created_at TEXT NOT NULL
    )`);
    db.prepare("INSERT INTO lead_topic VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("t1", "/p", "s1", "old", "m1", "m2", "g1", "tech-lead", null, "2026-11-09T00:00:00.000Z");

    const store = new LeadTopicStore(db);
    const row = store.get("t1")!;
    expect(row.state).toBe("warm");
    expect(row.summary).toBeNull();
    expect(row.summaryHash).toBeNull();
    expect(row.summaryUpdatedAt).toBeNull();
    expect(row.residentTokens).toBe(0);
    expect(row.resumedFrom).toBeNull();
    expect(row.lastActiveAt).toBe("2026-11-09T00:00:00.000Z");
  });

  test("search matches title/summary and updates summary/state", () => {
    const db = new Database(":memory:");
    const store = new LeadTopicStore(db);
    store.insert({ ...baseTopic("t1"), summary: "SQLite migration decision" });
    store.insert({ ...baseTopic("t2"), summary: "UI polish" });

    expect(store.search("/p", "migration").map((t) => t.id)).toEqual(["t1"]);
    expect(store.search("/p", "topic t2").map((t) => t.id)).toEqual(["t2"]);
    expect(store.search("/p", "").map((t) => t.id)).toEqual(["t2", "t1"]);

    store.updateSummary("t1", {
      summary: "new summary",
      summaryHash: "hash_1",
      now: "2026-11-10T03:00:00.000Z",
      residentTokens: 42,
    });
    store.setState("t1", "resident", "2026-11-10T04:00:00.000Z");
    expect(store.get("t1")).toMatchObject({
      summary: "new summary",
      summaryHash: "hash_1",
      summaryUpdatedAt: "2026-11-10T03:00:00.000Z",
      residentTokens: 42,
      state: "resident",
      lastActiveAt: "2026-11-10T04:00:00.000Z",
    });
  });
});

describe("TopicMessageIndexStore", () => {
  test("replaces topic index rows atomically and lists by project", () => {
    const db = new Database(":memory:");
    const topics = new LeadTopicStore(db);
    topics.insert(baseTopic("t1"));
    const index = new TopicMessageIndexStore(db);

    index.replaceTopic("t1", [
      indexRow("t1", "msg_1", "user", "use SQLite"),
      indexRow("t1", "msg_2", "assistant", "migration planned"),
    ]);
    expect(index.listByTopic("t1").map((r) => r.messageId)).toEqual(["msg_2", "msg_1"]);
    expect(index.listByProject("/p").map((r) => r.messageId)).toEqual(["msg_2", "msg_1"]);

    index.replaceTopic("t1", [indexRow("t1", "msg_2", "assistant", "migration planned")]);
    expect(index.listByTopic("t1").map((r) => r.messageId)).toEqual(["msg_2"]);
  });

  test("limits rows newest-first", () => {
    const db = new Database(":memory:");
    const topics = new LeadTopicStore(db);
    topics.insert(baseTopic("t1"));
    const index = new TopicMessageIndexStore(db);
    index.replaceTopic("t1", [
      { ...indexRow("t1", "m1", "user", "one"), createdAt: "2026-11-10T01:00:00.000Z" },
      { ...indexRow("t1", "m2", "user", "two"), createdAt: "2026-11-10T02:00:00.000Z" },
    ]);

    expect(index.listByTopic("t1", 1).map((r) => r.messageId)).toEqual(["m2"]);
  });
});
