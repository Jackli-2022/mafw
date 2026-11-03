// 结果事件队列 / 已查看标记的时序契约（final review minors）：
//   1. podStore 正在 refresh/loading 时到达的结果事件不能丢——只保留最新一条，
//      等 store 空闲后补处理（drain）。
//   2. 已查看标记只在结果数据真的加载成功后才写，面板「打开」本身不算查看。
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createPodResultQueue, markResultViewedAfterLoad } from "./pod-result-store"

describe("createPodResultQueue", () => {
  test("busy 时只保留最新一条结果事件，空闲后补处理一次", async () => {
    let busy = true
    const seen: unknown[] = []
    const queue = createPodResultQueue({
      isBusy: () => busy,
      handle: async (event) => { seen.push(event) },
    })

    queue.push({ seq: 1, goalId: "g1" })
    queue.push({ seq: 2, goalId: "g2" })
    await Promise.resolve()
    assert.deepEqual(seen, [], "refresh 忙时不能处理（会被 store 的 single-flight 吞掉）")
    assert.equal(queue.pending(), true)

    busy = false
    queue.drain()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(seen, [{ seq: 2, goalId: "g2" }], "只补最新一条，不重放整段历史")
    assert.equal(queue.pending(), false)
  })

  test("空闲时立即处理；处理期间新事件排队，结束后继续 drain", async () => {
    let busy = false
    const seen: unknown[] = []
    const gate: Array<() => void> = []
    const queue = createPodResultQueue({
      isBusy: () => busy,
      handle: (event) => new Promise<void>((resolve) => {
        seen.push(event)
        gate.push(resolve)
      }),
    })

    queue.push({ seq: 1 })
    assert.deepEqual(seen, [{ seq: 1 }], "空闲立即处理")
    queue.push({ seq: 2 })
    busy = true // 处理中 refresh 又忙了：保留待补
    gate[0]()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(seen, [{ seq: 1 }], "忙时新事件保持 pending")

    busy = false
    queue.drain()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(seen, [{ seq: 1 }, { seq: 2 }])
  })
})

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
