import { describe, expect, test } from "bun:test"
import { descendantRows } from "./subagent-tree"
import type { SubagentRow } from "./subagent-tracker"

const row = (childID: string, parentID: string, depth = 1): SubagentRow => ({
  childID, parentID, depth, title: childID, agent: "general", status: "running", startedAt: 1,
})

describe("descendantRows", () => {
  test("returns direct + nested descendants in order", () => {
    const rows = [row("c1", "root"), row("c2", "root"), row("gc1", "c1", 2), row("other", "elsewhere")]
    expect(descendantRows(rows, "root").map(r => r.childID)).toEqual(["c1", "gc1", "c2"])
  })

  test("cycle does not loop", () => {
    const rows = [row("a", "root"), row("b", "a"), row("a", "b")]
    expect(descendantRows(rows, "root").map(r => r.childID)).toEqual(["a", "b"])
  })

  test("empty root", () => {
    expect(descendantRows([row("c1", "root")], "")).toEqual([])
    expect(descendantRows([], "root")).toEqual([])
  })
})
