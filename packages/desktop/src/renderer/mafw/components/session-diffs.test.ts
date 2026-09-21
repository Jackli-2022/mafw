import { describe, expect, test } from "bun:test"
import { aggregateSessionDiffs } from "./session-diffs"

const msg = (id: string, diffs?: any[]) => ({ id, role: "user", summary: diffs ? { diffs } : undefined })

describe("aggregateSessionDiffs", () => {
  test("空消息/无 summary → 空数组", () => {
    expect(aggregateSessionDiffs([])).toEqual([])
    expect(aggregateSessionDiffs([msg("m1")])).toEqual([])
    expect(aggregateSessionDiffs([{ id: "m2", role: "assistant" }])).toEqual([])
  })
  test("单回合多文件全收", () => {
    const out = aggregateSessionDiffs([msg("m1", [
      { file: "a.ts", additions: 3, deletions: 1, patch: "P1", status: "modified" },
      { file: "b.ts", additions: 5, deletions: 0, patch: "P2", status: "added" },
    ])])
    expect(out.length).toBe(2)
    expect(out[0].file).toBe("a.ts")
    expect(out[1].file).toBe("b.ts")
  })
  test("同文件跨回合：后者覆盖前者（含 patch）", () => {
    const out = aggregateSessionDiffs([
      msg("m1", [{ file: "a.ts", additions: 1, deletions: 0, patch: "OLD" }]),
      msg("m2", [{ file: "a.ts", additions: 2, deletions: 2, patch: "NEW" }]),
    ])
    expect(out.length).toBe(1)
    expect(out[0].patch).toBe("NEW")
    expect(out[0].additions).toBe(2)
  })
  test("跳过畸形条目（无 file / 非数组 diffs）", () => {
    const out = aggregateSessionDiffs([
      msg("m1", [{ additions: 1 }, { file: "", patch: "x" }, null, { file: "ok.ts", patch: "P" }]),
      { id: "m2", role: "user", summary: { diffs: "not-array" } },
    ])
    expect(out.length).toBe(1)
    expect(out[0].file).toBe("ok.ts")
  })
})
