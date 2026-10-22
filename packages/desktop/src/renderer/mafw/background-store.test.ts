import { describe, expect, test, beforeEach } from "bun:test"
import { backgroundRows, ingestBackgroundEvent, onBackgroundTerminal, resetBackgroundStore } from "./background-store"

beforeEach(() => resetBackgroundStore())

describe("background store", () => {
  test("ingest 应用到 rows 并触发一次终态回调（幂等不回退不再触发）", () => {
    const seen: string[] = []
    const off = onBackgroundTerminal(r => seen.push(`${r.id}:${r.status}`))
    ingestBackgroundEvent({ kind: "bg-observed", row: { id: "sh1", type: "shell", sessionID: "s1", label: "t" } }, 1)
    ingestBackgroundEvent({ kind: "bg-terminal", id: "sh1", terminal: "completed", source: "synthetic" }, 2)
    ingestBackgroundEvent({ kind: "bg-terminal", id: "sh1", terminal: "failed", source: "probe" }, 3) // 幂等不回退 → 不再触发
    expect(seen).toEqual(["sh1:completed"])
    expect(backgroundRows()[0]!.status).toBe("completed")
    off()
    ingestBackgroundEvent({ kind: "bg-observed", row: { id: "sh2", type: "shell", sessionID: "s1", label: "u" } }, 4)
    ingestBackgroundEvent({ kind: "bg-terminal", id: "sh2", terminal: "failed", source: "synthetic" }, 5)
    expect(seen.length).toBe(1) // 注销后不再收
  })
  test("snapshot 补行不触发回调", () => {
    const seen: string[] = []
    onBackgroundTerminal(r => seen.push(r.id))
    ingestBackgroundEvent({ kind: "bg-snapshot", shells: [{ id: "sh9", command: "old", sessionID: "s1" }] }, 1)
    expect(seen).toEqual([])
    expect(backgroundRows()[0]).toMatchObject({ id: "sh9", status: "running" })
  })
  test("对账收敛（source: probe）落终态但不触发回调（静默，spec §5.1）", () => {
    const seen: string[] = []
    onBackgroundTerminal(r => seen.push(r.id))
    ingestBackgroundEvent({ kind: "bg-observed", row: { id: "sh1", type: "shell", sessionID: "s1", label: "t" } }, 1)
    ingestBackgroundEvent({ kind: "bg-terminal", id: "sh1", terminal: "completed", source: "probe" }, 2)
    expect(backgroundRows()[0]!.status).toBe("completed")
    expect(seen).toEqual([])
  })
})
