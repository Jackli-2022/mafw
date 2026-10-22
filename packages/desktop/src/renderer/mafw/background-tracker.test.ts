import { describe, expect, test } from "bun:test"
import { applyBackgroundEvent, collectNewTerminals, rowsForSession, countRunning, type BackgroundRow } from "./background-tracker"

const obs = (id: string, type: "shell" | "subagent" = "shell", sid = "s1", label = "npm run dev") =>
  ({ kind: "bg-observed", row: { id, type, sessionID: sid, label } }) as const

describe("bg-observed", () => {
  test("建 running 行；重复观察幂等（不回退、不重复）", () => {
    let rows = applyBackgroundEvent([], obs("sh1"), 1000)
    expect(rows).toEqual([{ id: "sh1", type: "shell", sessionID: "s1", label: "npm run dev", status: "running", startedAt: 1000 }])
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "sh1", terminal: "completed", source: "synthetic" }, 2000)
    rows = applyBackgroundEvent(rows, obs("sh1"), 3000) // 终态后再观察 → 不回退
    expect(rows[0]).toMatchObject({ status: "completed", endedAt: 2000 })
  })
})

describe("bg-terminal", () => {
  test("三值转换 + 终态幂等不回退", () => {
    let rows = applyBackgroundEvent([], obs("sh1"), 1000)
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "sh1", terminal: "failed", source: "synthetic" }, 2000)
    expect(rows[0]).toMatchObject({ status: "failed", endedAt: 2000 })
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "sh1", terminal: "completed", source: "probe" }, 3000)
    expect(rows[0]!.status).toBe("failed")
  })
  test("行不存在 + meta → 建终态行（重启后首见即完成态）", () => {
    const rows = applyBackgroundEvent([], { kind: "bg-terminal", id: "sh9", terminal: "completed", at: 500, source: "synthetic", meta: { type: "shell", sessionID: "s1", label: "老任务" } }, 9000)
    expect(rows[0]).toMatchObject({ id: "sh9", status: "completed", startedAt: 500, endedAt: 500, label: "老任务" })
  })
  test("行不存在 + 无 meta → no-op", () => {
    expect(applyBackgroundEvent([], { kind: "bg-terminal", id: "x", terminal: "completed" }, 1)).toEqual([])
  })
  test("turn 来源只收敛 subagent 行（不碰 shell 行）", () => {
    let rows = applyBackgroundEvent([], obs("sh1", "shell"), 1000)
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "sh1", terminal: "completed", source: "turn" }, 2000)
    expect(rows[0]!.status).toBe("running") // turn 来源对 shell 行无效
    let rows2 = applyBackgroundEvent([], obs("child1", "subagent"), 1000)
    rows2 = applyBackgroundEvent(rows2, { kind: "bg-terminal", id: "child1", terminal: "completed", source: "turn" }, 2000)
    expect(rows2[0]).toMatchObject({ status: "completed", endedAt: 2000 })
  })
  test("turn.aborted → cancelled", () => {
    let rows = applyBackgroundEvent([], obs("c1", "subagent"), 1000)
    rows = applyBackgroundEvent(rows, { kind: "bg-terminal", id: "c1", terminal: "cancelled", source: "turn" }, 1500)
    expect(rows[0]!.status).toBe("cancelled")
  })
})

describe("bg-snapshot", () => {
  test("补缺失 running 行；不回退已有行；不产生终态", () => {
    let rows = applyBackgroundEvent([], obs("sh1"), 1000)
    rows = applyBackgroundEvent(rows, { kind: "bg-snapshot", shells: [
      { id: "sh1", command: "npm run dev", sessionID: "s1" },   // 已有 → 不动
      { id: "sh2", command: "python serve.py", sessionID: "s2" }, // 补 running
    ] }, 5000)
    expect(rows.length).toBe(2)
    expect(rows.find(r => r.id === "sh2")).toMatchObject({ status: "running", label: "python serve.py", sessionID: "s2", type: "shell" })
    expect(rows.find(r => r.id === "sh1")!.startedAt).toBe(1000)
  })
})

describe("collectNewTerminals / 视图助手", () => {
  test("只计 live running→终态转换（snapshot/无行新建不计）", () => {
    const before: BackgroundRow[] = [{ id: "a", type: "shell", sessionID: "s1", label: "t", status: "running", startedAt: 1 }]
    const after: BackgroundRow[] = [
      { id: "a", type: "shell", sessionID: "s1", label: "t", status: "completed", startedAt: 1, endedAt: 2 },
      { id: "b", type: "shell", sessionID: "s1", label: "u", status: "completed", startedAt: 0, endedAt: 0 },
    ]
    expect(collectNewTerminals(before, after).map(r => r.id)).toEqual(["a"])
  })
  test("rowsForSession 过滤 + countRunning 全局计数", () => {
    const rows: BackgroundRow[] = [
      { id: "a", type: "shell", sessionID: "s1", label: "t", status: "running", startedAt: 1 },
      { id: "b", type: "subagent", sessionID: "s2", label: "u", status: "completed", startedAt: 0, endedAt: 2 },
    ]
    expect(rowsForSession(rows, "s1").map(r => r.id)).toEqual(["a"])
    expect(countRunning(rows)).toBe(1)
  })
  test("排序 startedAt 倒序", () => {
    let rows = applyBackgroundEvent([], obs("a"), 1000)
    rows = applyBackgroundEvent(rows, obs("b"), 2000)
    expect(rows.map(r => r.id)).toEqual(["b", "a"])
  })
})
