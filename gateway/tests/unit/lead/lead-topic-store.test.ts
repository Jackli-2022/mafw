import Database from "better-sqlite3";
import { LeadTopicStore } from "../../../src/core/lead/lead-topic-store";

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
});
