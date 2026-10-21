import { describe, expect, test } from "bun:test"
import { applySubagentEvent, collectNewTerminals, parseAgentFromTitle, isTrackedChildSession, childrenNeedingProbe, type SubagentRow } from "./subagent-tracker"

const created = (id: string, parent: string, title?: string) =>
  ({ kind: "session-created", info: { id, parentID: parent, title } }) as const

describe("parseAgentFromTitle", () => {
  test("标题尾 @agent 解析", () => {
    expect(parseAgentFromTitle("调研登录流程 @explore")).toBe("explore")
  })
  test("无 @ 缺省", () => { expect(parseAgentFromTitle("随便写写")).toBe("子代理") })
})

describe("applySubagentEvent", () => {
  test("session-created 建 running 行；无 parentID 不建", () => {
    let rows = applySubagentEvent([], created("c1", "p1", "任务 @a"), 1000)
    expect(rows).toEqual([{ childID: "c1", parentID: "p1", title: "任务 @a", agent: "a", status: "running", startedAt: 1000 }])
    rows = applySubagentEvent(rows, { kind: "session-created", info: { id: "x", parentID: "" } }, 1000)
    expect(rows.length).toBe(1)
  })
  test("session-updated 刷新标题与 agent，不动其他行", () => {
    let rows = applySubagentEvent([], created("c1", "p1", "旧 @a"), 1000)
    rows = applySubagentEvent(rows, { kind: "session-updated", sessionID: "c1", title: "新 @b" }, 2000)
    expect(rows[0]).toMatchObject({ title: "新 @b", agent: "b", status: "running" })
  })
  test("turn-terminal 三值；首个终态生效（幂等）", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "turn-terminal", sessionID: "c1", terminal: "completed" }, 2000)
    expect(rows[0]).toMatchObject({ status: "completed", endedAt: 2000 })
    rows = applySubagentEvent(rows, { kind: "turn-terminal", sessionID: "c1", terminal: "failed" }, 3000)
    expect(rows[0]!.status).toBe("completed") // 不回退
  })
  test("turn.aborted → aborted 止住僵尸行", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "turn-terminal", sessionID: "c1", terminal: "aborted" }, 1500)
    expect(rows[0]).toMatchObject({ status: "aborted", endedAt: 1500 })
  })
  test("session.deleted 收敛 running 行（aborted）", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "session-deleted", sessionID: "c1" }, 1200)
    expect(rows[0]).toMatchObject({ status: "aborted", endedAt: 1200 })
  })
  test("children-snapshot：补历史 completed 行；不回退、不标 running、endedAt 取 time.updated", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "children-snapshot", parentID: "p1", children: [
      { id: "c1", title: "在跑 @a" },                                   // 已存在 → 不动
      { id: "c2", title: "老任务 @b", time: { created: 100, updated: 200 } }, // 补历史
    ] }, 5000)
    const c1 = rows.find(r => r.childID === "c1")!
    const c2 = rows.find(r => r.childID === "c2")!
    expect(c1.status).toBe("running")
    expect(c2).toMatchObject({ status: "completed", startedAt: 100, endedAt: 200 })
  })
  test("child-last-message 自愈：assistant 且 time.completed → completed；error → failed；否则不动", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, { kind: "child-last-message", childID: "c1", message: { role: "assistant", time: {} } }, 2000)
    expect(rows[0]!.status).toBe("running") // 未完不误判
    rows = applySubagentEvent(rows, { kind: "child-last-message", childID: "c1", message: { role: "assistant", time: { completed: 2500 } } }, 3000)
    expect(rows[0]).toMatchObject({ status: "completed", endedAt: 2500 })
  })
  test("排序：startedAt 倒序", () => {
    let rows = applySubagentEvent([], created("c1", "p1"), 1000)
    rows = applySubagentEvent(rows, created("c2", "p1"), 2000)
    expect(rows.map(r => r.childID)).toEqual(["c2", "c1"])
  })
})

describe("collectNewTerminals（通知来源）", () => {
  test("只计 running→终态；snapshot 补的历史行不计", () => {
    const before: SubagentRow[] = [
      { childID: "a", parentID: "p", title: "t", agent: "x", status: "running", startedAt: 1 },
    ]
    const after: SubagentRow[] = [
      { childID: "a", parentID: "p", title: "t", agent: "x", status: "completed", startedAt: 1, endedAt: 2 },
      { childID: "b", parentID: "p", title: "hist", agent: "x", status: "completed", startedAt: 0, endedAt: 0 }, // prev 无 → 不计
    ]
    expect(collectNewTerminals(before, after).map(r => r.childID)).toEqual(["a"])
  })
  test("aborted 也在集合内（静默与否由通知层决定）", () => {
    const before: SubagentRow[] = [{ childID: "a", parentID: "p", title: "t", agent: "x", status: "running", startedAt: 1 }]
    const after: SubagentRow[] = [{ childID: "a", parentID: "p", title: "t", agent: "x", status: "aborted", startedAt: 1, endedAt: 2 }]
    expect(collectNewTerminals(before, after).length).toBe(1)
  })
})

describe("isTrackedChildSession / childrenNeedingProbe", () => {
  const rows: SubagentRow[] = [
    { childID: "c1", parentID: "p", title: "t", agent: "x", status: "running", startedAt: 1 },
    { childID: "c2", parentID: "p", title: "t", agent: "x", status: "completed", startedAt: 0, endedAt: 2 },
  ]
  test("tracked child 判定", () => { expect(isTrackedChildSession(rows, "c1")).toBe(true); expect(isTrackedChildSession(rows, "zz")).toBe(false) })
  test("probe 只含 running 行", () => { expect(childrenNeedingProbe(rows)).toEqual(["c1"]) })
})
