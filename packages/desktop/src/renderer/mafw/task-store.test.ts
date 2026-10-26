import { describe, expect, test } from "bun:test"
import { applyTask } from "./task-store"
import type { TaskEntity } from "@mafw/sdk"

const task = (id: string, updatedAt: number, status: TaskEntity["status"] = "working"): TaskEntity => ({
  id, kind: "shell", parentSessionID: "p1", title: id, status, createdAt: 1, updatedAt,
})

describe("applyTask", () => {
  test("upserts by id and sorts newest first", () => {
    let rows = applyTask([], task("a", 1))
    rows = applyTask(rows, task("b", 2))
    expect(rows.map(r => r.id)).toEqual(["b", "a"])
    rows = applyTask(rows, task("a", 3, "completed"))
    expect(rows.map(r => r.id)).toEqual(["a", "b"])
    expect(rows[0].status).toBe("completed")
  })

  test("ignores malformed task", () => {
    expect(applyTask([], undefined as any)).toEqual([])
  })
})
