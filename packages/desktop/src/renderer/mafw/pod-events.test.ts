// packages/desktop/src/renderer/mafw/pod-events.test.ts
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createPodEventsStore, isResultViewed, listUnread, shouldMarkSeen, type PodEventItem } from "./pod-events"

const ev = (over: Partial<PodEventItem> = {}): PodEventItem => ({
  id: "e", podId: "pod_1", goalId: "g1", revision: 1, kind: "goal.result",
  severity: "p1", title: "", summary: null, state: "seen", createdAt: "1", ...over,
})

describe("isResultViewed（事件 + 旧 localStorage 双读）", () => {
  test("events 里同 goal + revision 已 seen → 已查看", () => {
    assert.equal(isResultViewed({ podId: "pod_1", goalId: "g1", revision: 1, events: [ev()], legacy: [] }), true)
  })

  test("不同 revision 不共享已查看状态", () => {
    assert.equal(isResultViewed({ podId: "pod_1", goalId: "g1", revision: 2, events: [ev()], legacy: [] }), false)
  })

  test("事件仍是 unread 时不算已查看", () => {
    assert.equal(isResultViewed({ podId: "pod_1", goalId: "g1", revision: 1, events: [ev({ state: "unread" })], legacy: [] }), false)
  })

  test("不同 Pod 的同名 goal 不共享已查看状态", () => {
    assert.equal(isResultViewed({
      podId: "pod_2",
      goalId: "g1",
      revision: 1,
      events: [ev({ podId: "pod_1" })],
      legacy: [],
    }), false)
  })

  test("legacy localStorage 键仍生效（升级后存量未查看结果不丢）", () => {
    assert.equal(isResultViewed({ podId: "pod_1", goalId: "g1", revision: 2, events: [], legacy: ["pod_1:g1:2"] }), true)
    assert.equal(isResultViewed({ podId: "pod_1", goalId: "g1", revision: 2, events: [], legacy: [] }), false)
  })
})

describe("listUnread / shouldMarkSeen", () => {
  test("p1 优先，其次按 createdAt 倒序", () => {
    const items = [
      ev({ id: "a", severity: "p3", state: "unread", createdAt: "2" }),
      ev({ id: "b", severity: "p1", state: "unread", createdAt: "1" }),
      ev({ id: "c", severity: "p3", state: "seen", createdAt: "3" }),
    ]
    assert.deepEqual(listUnread(items).map((item) => item.id), ["b", "a"])
  })

  test("结果接口失败时绝不能标 seen", () => {
    assert.equal(shouldMarkSeen({ status: "fulfilled" }), true)
    assert.equal(shouldMarkSeen({ status: "rejected" }), false)
    assert.equal(shouldMarkSeen({ status: "pending" }), false)
  })
})

describe("pod events store", () => {
  const page = (items: PodEventItem[], unread = items.length) => ({ items, unread })

  test("refresh 加载事件并同步 supported", async () => {
    const calls: string[] = []
    const store = createPodEventsStore({
      list: async (podId, opts) => {
        calls.push(`list:${podId}:${opts.state}:${opts.limit}`)
        return page([ev({ state: "unread" })])
      },
      seenAll: async () => ({ ok: true }),
    })
    store.setPod("pod_1")
    await store.refresh()

    assert.deepEqual(calls, ["list:pod_1:undefined:200"])
    assert.equal(store.items().length, 1)
    assert.equal(store.unreadCount(), 1)
    assert.equal(store.supported(), true)
  })

  test("事件路由 404 → supported=false 且清空（旧 gateway 走 legacy 逻辑）", async () => {
    const store = createPodEventsStore({
      list: async () => { throw new Error("HTTP 404: not found") },
      seenAll: async () => ({ ok: true }),
    })
    store.setPod("pod_1")
    await store.refresh()

    assert.equal(store.supported(), false)
    assert.equal(store.items().length, 0)
  })

  test("ingest 只收当前 Pod 的事件，并按 eventId 去重", async () => {
    const store = createPodEventsStore({
      list: async () => page([]),
      seenAll: async () => ({ ok: true }),
    })
    store.setPod("pod_1")
    const event = {
      type: "pod.event",
      properties: { podId: "pod_1", eventId: "evt_1", goalId: "g1", revision: 1, kind: "goal.result", severity: "p1" },
    }
    assert.equal(store.ingest(event), true)
    assert.equal(store.ingest(event), true)
    assert.equal(store.items().length, 1, "同 eventId 不重复追加")
    assert.equal(store.unreadCount(), 1)

    assert.equal(store.ingest({ ...event, properties: { ...event.properties, podId: "pod_2" } }), true)
    assert.equal(store.items().length, 1, "别的 Pod 的事件不混进当前列表")
  })

  test("markSeen 只清当前 goal+revision 并透传 revision", async () => {
    const calls: Array<[string, string, number]> = []
    const store = createPodEventsStore({
      list: async () => page([
        ev({ id: "a", state: "unread", revision: 1 }),
        ev({ id: "b", state: "unread", revision: 2 }),
      ]),
      seenAll: async (podId, goalId, revision) => { calls.push([podId, goalId, revision]); return { ok: true } },
    })
    store.setPod("pod_1")
    await store.refresh()

    assert.equal(await store.markSeen("pod_1", "g1", 2), true)
    assert.deepEqual(calls, [["pod_1", "g1", 2]])
    assert.equal(store.items().find((item) => item.id === "a")?.state, "unread", "别的 revision 不能被顺手清掉")
    assert.equal(store.items().find((item) => item.id === "b")?.state, "seen")
    assert.equal(store.unreadCount(), 1)
  })

  test("markSeen 幂等：已经清过不再调接口", async () => {
    let calls = 0
    const store = createPodEventsStore({
      list: async () => page([ev({ state: "seen" })]),
      seenAll: async () => { calls++; return { ok: true } },
    })
    store.setPod("pod_1")
    await store.refresh()

    assert.equal(await store.markSeen("pod_1", "g1", 1), true)
    assert.equal(calls, 0)
  })

  test("seenAll 失败 → 回滚已查看状态（不能角标清了但结果没看到）", async () => {
    const store = createPodEventsStore({
      list: async () => page([ev({ state: "unread" })]),
      seenAll: async () => { throw new Error("network down") },
    })
    store.setPod("pod_1")
    await store.refresh()

    assert.equal(await store.markSeen("pod_1", "g1", 1), false)
    assert.equal(store.unreadCount(), 1)
    assert.equal(store.supported(), true, "普通失败不是路由缺失，不降级")
  })

  test("markSeen 在 inbox 还没拉到该事件时也调接口，并立即被视为已查看", async () => {
    let calls = 0
    const store = createPodEventsStore({
      list: async () => page([]),
      seenAll: async () => { calls++; return { ok: true } },
    })
    store.setPod("pod_1")
    await store.refresh()

    assert.equal(await store.markSeen("pod_1", "g1", 2), true)
    assert.equal(calls, 1, "本地没有未读记录也要清 server 端（幂等）")
    assert.equal(store.items().some((item) => item.state === "seen" && item.goalId === "g1" && item.revision === 2), true)
  })

  test("markSeen 在 podStore 尚未解析时采纳当前 Pod", async () => {
    const store = createPodEventsStore({
      list: async () => page([]),
      seenAll: async () => ({ ok: true }),
    })
    assert.equal(await store.markSeen("pod_1", "g1", 1), true)
    assert.equal(store.podId(), "pod_1")
  })

  test("刷新时保留本地已知的 seen 事件（server 分页挤掉也不复活角标）", async () => {
    const store = createPodEventsStore({
      list: async () => page([]),
      seenAll: async () => ({ ok: true }),
    })
    store.setPod("pod_1")
    await store.refresh()
    await store.markSeen("pod_1", "g1", 1)
    await store.refresh()

    assert.equal(store.items().some((item) => item.state === "seen" && item.goalId === "g1" && item.revision === 1), true)
  })
})
