import { describe, expect, test } from "bun:test"
import { reconcileSubagentsOnce, type ReconcileFetchers } from "./subagent-reconcile"

function fetchers(over: Partial<ReconcileFetchers>): ReconcileFetchers {
  return {
    children: async () => [],
    messages: async () => ({ data: [] }),
    getSession: async () => ({}),
    ...over,
  }
}

describe("reconcileSubagentsOnce（对账编排，fetch 注入）", () => {
  test("children 快照入 ingest；fetchers.children 抛错 → fail-open 不入", async () => {
    const seen: any[] = []
    await reconcileSubagentsOnce({
      activeSessionId: "p1", runningChildIDs: [],
      fetchers: fetchers({ children: async () => ([{ id: "c9", title: "历史 @a" }]) }),
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([{ kind: "children-snapshot", parentID: "p1", children: [{ id: "c9", title: "历史 @a" }] }])

    const seen2: any[] = []
    await reconcileSubagentsOnce({
      activeSessionId: "p1", runningChildIDs: [],
      fetchers: fetchers({ children: async () => { throw new Error("net") } }),
      ingest: (ev) => seen2.push(ev),
    })
    expect(seen2).toEqual([])
  })
  test("running 行最后一条消息 → child-last-message（role/time/error 透传）", async () => {
    const seen: any[] = []
    await reconcileSubagentsOnce({
      activeSessionId: null, runningChildIDs: ["c1"],
      fetchers: fetchers({ messages: async () => ({ data: [{ info: { role: "assistant", time: { completed: 5 }, error: { name: "MessageAbortedError" } } }] }) }),
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([{ kind: "child-last-message", childID: "c1", message: { role: "assistant", time: { completed: 5 }, error: { name: "MessageAbortedError" } } }])
  })
  test("空历史 + session.get 明确 not-found → 收敛 session-deleted（reviewer Imp3）", async () => {
    const seen: any[] = []
    await reconcileSubagentsOnce({
      activeSessionId: null, runningChildIDs: ["c1"],
      fetchers: fetchers({ messages: async () => ({ data: [] }), getSession: async () => ({ error: "not found" }) }),
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([{ kind: "session-deleted", sessionID: "c1" }])
  })
  test("空历史 + 会话存在 → 不收敛（新会话尚无消息）", async () => {
    const seen: any[] = []
    await reconcileSubagentsOnce({
      activeSessionId: null, runningChildIDs: ["c1"],
      fetchers: fetchers({ messages: async () => ({ data: [] }), getSession: async () => ({ id: "c1" }) }),
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([])
  })
  test("messages 抛错 → fail-open（不查 get、不收敛）", async () => {
    let getCalls = 0
    const seen: any[] = []
    await reconcileSubagentsOnce({
      activeSessionId: null, runningChildIDs: ["c1"],
      fetchers: fetchers({ messages: async () => { throw new Error("net") }, getSession: async () => { getCalls++; return {} } }),
      ingest: (ev) => seen.push(ev),
    })
    expect(seen).toEqual([])
    expect(getCalls).toBe(0)
  })
})
