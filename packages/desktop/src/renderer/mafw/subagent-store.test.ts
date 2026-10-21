import { describe, expect, test, beforeEach } from "bun:test"
import { subagentRows, ingestSubagentEvent, onSubagentTerminal, resetSubagentStore } from "./subagent-store"

beforeEach(() => resetSubagentStore())

describe("subagent store", () => {
  test("ingest 应用到 rows 并触发一次终态回调（aborted 也触发，通知层过滤）", () => {
    const seen: string[] = []
    const off = onSubagentTerminal(r => seen.push(`${r.childID}:${r.status}`))
    ingestSubagentEvent({ kind: "session-created", info: { id: "c1", parentID: "p", title: "t @a" } }, 1)
    ingestSubagentEvent({ kind: "turn-terminal", sessionID: "c1", terminal: "completed" }, 2)
    ingestSubagentEvent({ kind: "turn-terminal", sessionID: "c1", terminal: "failed" }, 3) // 幂等不回退 → 不再触发
    expect(seen).toEqual(["c1:completed"])
    expect(subagentRows()[0]!.status).toBe("completed")
    off()
    ingestSubagentEvent({ kind: "session-created", info: { id: "c2", parentID: "p" } }, 4)
    ingestSubagentEvent({ kind: "turn-terminal", sessionID: "c2", terminal: "failed" }, 5)
    expect(seen.length).toBe(1) // 注销后不再收
  })
  test("snapshot 补历史行不触发回调", () => {
    const seen: string[] = []
    onSubagentTerminal(r => seen.push(r.childID))
    ingestSubagentEvent({ kind: "children-snapshot", parentID: "p", children: [{ id: "old", title: "历史 @a" }] }, 1)
    expect(seen).toEqual([])
  })
})
