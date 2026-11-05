// 已查看标记的时序契约：
//   已查看只在结果数据真的加载成功后才写，面板「打开」本身不算查看。
//   新版写在 `pod_events`（seenAll）；旧 gateway 没有事件路由时退回 localStorage。
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { markResultViewedAfterLoad } from "./pod-result-store"

describe("markResultViewedAfterLoad", () => {
  const calls: Array<[string, string, number]> = []
  const mark = (podId: string, goalId: string, revision: number) => { calls.push([podId, goalId, revision]) }

  test("结果加载失败（null/异常）不标记已查看", () => {
    calls.length = 0
    assert.equal(markResultViewedAfterLoad({
      podId: "pod_1", goalId: "g1", result: null, mark,
    }), false)
    assert.equal(markResultViewedAfterLoad({
      podId: "pod_1", goalId: "g1", result: undefined, mark,
    }), false)
    assert.deepEqual(calls, [])
  })

  test("结果加载成功后才按结果 revision 标记", () => {
    calls.length = 0
    const marked = markResultViewedAfterLoad({
      podId: "pod_1",
      goalId: "g1",
      result: { goalId: "g1", revision: 2 } as any,
      mark,
    })
    assert.equal(marked, true)
    assert.deepEqual(calls, [["pod_1", "g1", 2]])
  })

  test("结果缺 revision 时回退 Goal revision，都没有则不臆造", () => {
    calls.length = 0
    markResultViewedAfterLoad({
      podId: "pod_1", goalId: "g1", result: { goalId: "g1" } as any, fallbackRevision: 3, mark,
    })
    assert.deepEqual(calls, [["pod_1", "g1", 3]])

    calls.length = 0
    markResultViewedAfterLoad({
      podId: "pod_1", goalId: "g1", result: { goalId: "g1" } as any, mark,
    })
    assert.deepEqual(calls, [], "revision 未知时不写 viewed（避免误标下一版）")
  })
})

describe("markResultViewedAfterLoad: event store first, legacy fallback", () => {
  test("事件路由可用 → 调 seenAll（带 revision），不写 legacy", async () => {
    const seen: Array<[string, string, number]> = []
    const legacy: Array<[string, string, number]> = []
    const marked = markResultViewedAfterLoad({
      podId: "pod_1",
      goalId: "g1",
      result: { goalId: "g1", revision: 2 } as any,
      mark: (podId, goalId, revision) => { legacy.push([podId, goalId, revision]) },
      events: {
        supported: () => true,
        markSeen: async (podId, goalId, revision) => { seen.push([podId, goalId, revision]); return true },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(marked, true)
    assert.deepEqual(seen, [["pod_1", "g1", 2]])
    assert.deepEqual(legacy, [])
  })

  test("旧 gateway 没有事件路由 → 直接走 legacy localStorage", () => {
    const legacy: Array<[string, string, number]> = []
    markResultViewedAfterLoad({
      podId: "pod_1",
      goalId: "g1",
      result: { goalId: "g1", revision: 2 } as any,
      mark: (podId, goalId, revision) => { legacy.push([podId, goalId, revision]) },
      events: { supported: () => false, markSeen: async () => false },
    })
    assert.deepEqual(legacy, [["pod_1", "g1", 2]])
  })

  test("seenAll 发现路由缺失 → 补写 legacy（不能角标永远清不掉）", async () => {
    let supported = true
    const legacy: Array<[string, string, number]> = []
    markResultViewedAfterLoad({
      podId: "pod_1",
      goalId: "g1",
      result: { goalId: "g1", revision: 2 } as any,
      mark: (podId, goalId, revision) => { legacy.push([podId, goalId, revision]) },
      events: {
        supported: () => supported,
        markSeen: async () => { supported = false; return false },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(legacy, [["pod_1", "g1", 2]])
  })
})
