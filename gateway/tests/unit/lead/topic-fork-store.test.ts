import Database from "better-sqlite3";
import { TopicForkStore } from "../../../src/core/lead/topic-fork-store";

const row = (id: string, goalId: string) => ({
  id,
  sourceTopicId: "t1",
  targetGoalId: goalId,
  inheritedFrom: "m1",
  inheritedTo: "m3",
  mode: "reference",
  createdAt: "2026-11-10T00:00:00.000Z",
});

describe("TopicForkStore", () => {
  test("inserts and reads forks by source and goal", () => {
    const db = new Database(":memory:");
    const store = new TopicForkStore(db);
    store.insert(row("f1", "g1"));
    store.insert(row("f2", "g2"));

    expect(store.listBySource("t1").map((item) => item.id)).toEqual(["f2", "f1"]);
    expect(store.getByGoal("g1")?.id).toBe("f1");
    expect(store.getByGoal("nope")).toBeNull();
  });
});
