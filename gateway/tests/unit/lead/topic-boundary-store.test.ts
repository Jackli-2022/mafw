import Database from "better-sqlite3";
import { TopicBoundaryStore } from "../../../src/core/lead/topic-boundary-store";

const row = (id: string, status: "proposed" | "accepted" = "proposed") => ({
  id,
  projectDir: "/p",
  leadSessionId: "s1",
  fromTopicId: "t1",
  toTopicId: null,
  trigger: "explicit" as const,
  confidence: 0.9,
  status,
  createdAt: "2026-11-10T00:00:00.000Z",
});

describe("TopicBoundaryStore", () => {
  test("inserts, lists and updates status without deleting", () => {
    const db = new Database(":memory:");
    const store = new TopicBoundaryStore(db);
    store.insert(row("b1"));
    store.insert(row("b2"));

    expect(store.listByTopic("t1").map((item) => item.id)).toEqual(["b2", "b1"]);
    store.updateStatus("b1", "undone", null);
    expect(store.get("b1")?.status).toBe("undone");
    expect(store.listByTopic("t1")).toHaveLength(2);
  });
});
