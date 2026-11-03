import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createPodStore, resetPodDetailCache, resolvePodDetailCached, type PodStoreApi } from "./pod-store"

const detail = (id: string, projectDir = "/p") => ({
  pod: { id, projectDir, status: "active" },
  members: [],
  goals: [],
  tasks: [],
  sessions: [],
}) as any

function harness(overrides: Partial<PodStoreApi> = {}) {
  const calls: string[] = []
  const api: PodStoreApi = {
    lookup: async (dir) => { calls.push(`lookup:${dir}`); return detail("pod_1", dir) },
    ensure: async (dir) => { calls.push(`ensure:${dir}`); return detail("pod_1", dir) },
    get: async (id) => { calls.push(`get:${id}`); return detail(id) },
    update: async (id, body) => { calls.push(`update:${id}:${body.status}`); return detail(id) },
    createGoal: async (id, body) => { calls.push(`createGoal:${id}:${body.title}`); return { goalId: "g1", status: "started", queueReason: null, goal: { goalId: "g1", title: body.title } } as any },
    result: async (id, goalID) => { calls.push(`result:${id}:${goalID}`); return { goalId: goalID, verdict: "PASS" } as any },
    cancelGoal: async (id, goalID) => { calls.push(`cancelGoal:${id}:${goalID}`); return { goal: { goalId: goalID } } as any },
    pause: async (id) => { calls.push(`pause:${id}`); return detail(id) },
    resume: async (id) => { calls.push(`resume:${id}`); return detail(id) },
    wake: async (id) => { calls.push(`wake:${id}`); return detail(id) },
    sleep: async (id) => { calls.push(`sleep:${id}`); return detail(id) },
    cost: async () => ({ spentUsd: 1, limitUsd: 10 }),
    listMessages: async () => ({ items: [{ id: "m1", podId: "pod_1", fromMemberId: "m_lead", toMemberId: null, kind: "note", body: "hi", createdAt: "2026-10-30T00:00:00.000Z", readAt: null }] }),
    ...overrides,
  }
  const timers = {
    setTimeout: (fn: () => void) => { fn(); return 0 },
    clearTimeout: () => {},
  }
  return { store: createPodStore(api, { debounceMs: 200, timers }), calls }
}

describe("pod-store", () => {
  test("open uses lookup and never ensure; create calls ensure once", async () => {
    const { store, calls } = harness()
    await store.open("/p")
    assert.equal(store.detail()?.pod.id, "pod_1")
    assert.deepEqual(calls, ["lookup:/p"])
    await store.create()
    assert.deepEqual(calls, ["lookup:/p", "ensure:/p"])
  })

  test("loads the mailbox alongside the detail", async () => {
    const { store } = harness()
    await store.open("/p")
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(store.messages()[0]?.id, "m1")
  })

  test("markRead patches the message optimistically", async () => {
    const calls: string[] = []
    const { store } = harness({
      markRead: async (podID, messageID) => {
        calls.push(`markRead:${podID}:${messageID}`)
        return { message: { id: messageID, readAt: "2026-10-31T00:00:00.000Z" } as any }
      },
    })
    await store.open("/p")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await store.markRead("m1")
    assert.deepEqual(calls, ["markRead:pod_1:m1"])
    assert.equal(store.messages().find((m) => m.id === "m1")?.readAt, "2026-10-31T00:00:00.000Z")
  })

  test("markRead patches before the request resolves and rolls back on failure", async () => {
    let failRead: ((err: Error) => void) | null = null
    const pending = new Promise((_resolve, reject) => { failRead = reject })
    const { store } = harness({ markRead: () => pending as any })
    await store.open("/p")
    await new Promise((resolve) => setTimeout(resolve, 0))

    const inFlight = store.markRead("m1")
    assert.ok(store.messages().find((m) => m.id === "m1")?.readAt, "optimistic patch before resolve")

    failRead!(new Error("boom"))
    assert.equal(await inFlight, false)
    assert.equal(store.messages().find((m) => m.id === "m1")?.readAt, null, "rollback on failure")
  })

  test("setStatus uses pause/resume and never the legacy idle toggle", async () => {
    const { store, calls } = harness()
    await store.open("/p")
    await store.setStatus("paused")
    await store.setStatus("active")
    assert.deepEqual(calls, ["lookup:/p", "pause:pod_1", "resume:pod_1"])
  })

  test("goal composer/result/cancel delegate and refresh detail", async () => {
    const { store, calls } = harness()
    await store.open("/p")
    await store.createGoal({ title: "Fix Pod", objective: "Truthful" })
    await store.result("g1")
    await store.cancelGoal("g2")
    assert.deepEqual(calls, ["lookup:/p", "createGoal:pod_1:Fix Pod", "get:pod_1", "result:pod_1:g1", "cancelGoal:pod_1:g2", "get:pod_1"])
  })

  test("refresh is single-flight and exposes busy state", async () => {
    let resolveGet: (value: any) => void = () => {}
    let gets = 0
    const pending = new Promise((resolve) => { resolveGet = resolve })
    const { store } = harness({
      get: async () => { gets++; return pending as any },
    })
    await store.open("/p")
    const first = store.refresh()
    const second = store.refresh()
    assert.equal(store.busy(), true)
    assert.equal(gets, 1)
    resolveGet(detail("pod_1"))
    await Promise.all([first, second])
    assert.equal(store.busy(), false)
  })

  test("a route-missing gateway marks the store unsupported instead of empty", async () => {
    const { store } = harness({
      lookup: async () => { throw new Error("Received HTML instead of JSON from /api/projects/p/pod/lookup (gateway older than the SDK)") },
    })
    await store.open("/p")
    assert.equal(store.detail(), null)
    assert.equal(store.unsupported(), true)
  })

  test("legacy gateway detail is normalized and marked stage-unsupported", async () => {
    const legacy = {
      pod: { id: "pod_1", projectDir: "/p", status: "active" },
      members: [], sessions: [],
      goals: [{ id: "pg1", podId: "pod_1", goalId: "g1", status: "active", enqueuedAt: "t", startedAt: "t", endedAt: null }],
      tasks: [{ id: "t1", podId: "pod_1", goalId: null, sourceKey: "manual:t1", externalTaskId: null, title: "note", status: "pending" }],
    } as any
    const { store } = harness({ lookup: async () => legacy })
    await store.open("/p")
    assert.equal(store.detail()?.stageSupported, false)
    assert.deepEqual(store.detail()?.attention, [])
    assert.deepEqual(store.detail()?.messageHealth, [])
    assert.equal(store.detail()?.tasks[0]?.kind, "note")
    assert.equal(store.detail()?.goals[0]?.title, "未命名目标")
    assert.equal(store.detail()?.goals[0]?.stage?.kind, "waiting")
  })

  test("other lookup failures surface as an error, not as an empty pod", async () => {
    const { store } = harness({ lookup: async () => { throw new Error("fetch failed: ECONNREFUSED") } })
    await store.open("/p")
    assert.equal(store.unsupported(), false)
    assert.match(store.error() ?? "", /ECONNREFUSED/)
  })

  test("lookup 404 is an empty state; ensure 404 is unsupported", async () => {
    const { store } = harness({
      lookup: async () => { throw new Error("HTTP 404: Not Found") },
      ensure: async () => { throw new Error("HTTP 404: Not Found") },
    })
    await store.open("/p")
    assert.equal(store.detail(), null)
    assert.equal(store.unsupported(), false)
    await store.create()
    assert.equal(store.unsupported(), true)
  })

  test("unregistered project errors do not claim the gateway is unsupported", async () => {
    const { store } = harness({
      lookup: async () => { throw new Error("HTTP 404: project is not registered: /p") },
      ensure: async () => { throw new Error("HTTP 404: project is not registered: /p") },
    })
    await store.open("/p")
    await store.create()
    assert.equal(store.unsupported(), false)
    assert.match(store.error() ?? "", /project is not registered/)
  })

  test("event bursts coalesce into one refresh", async () => {
    const calls: string[] = []
    const pending: Array<() => void> = []
    const store = createPodStore({
      lookup: async () => detail("pod_1"),
      ensure: async () => detail("pod_1"),
      get: async (id) => { calls.push(`get:${id}`); return detail(id) },
      update: async (id) => detail(id),
      cost: async () => ({ spentUsd: 0, limitUsd: 0 }),
      listMessages: async () => ({ items: [] }),
    }, {
      debounceMs: 200,
      timers: {
        setTimeout: (fn) => { pending.push(fn); return pending.length },
        clearTimeout: (h) => { pending[(h as number) - 1] = () => {} },
      },
    })
    await store.open("/p")
    const event = { type: "pod.updated", properties: { podId: "pod_1" } }
    store.ingest(event)
    store.ingest(event)
    store.ingest(event)
    for (const fn of pending) fn()
    assert.deepEqual(calls, ["get:pod_1"])
  })

  test("unknown pod with no detail triggers lookup", async () => {
    const calls: string[] = []
    const store = createPodStore({
      lookup: async () => { calls.push("lookup"); throw new Error("HTTP 404: Not Found") },
      ensure: async () => detail("pod_1"),
      get: async () => detail("pod_1"),
      update: async () => detail("pod_1"),
      cost: async () => ({ spentUsd: 0, limitUsd: 0 }),
      listMessages: async () => ({ items: [] }),
    }, { debounceMs: 200, timers: { setTimeout: (fn) => { fn(); return 0 }, clearTimeout: () => {} } })
    await store.open("/p")
    store.ingest({ type: "pod.updated", properties: { podId: "pod_9" } })
    assert.deepEqual(calls, ["lookup", "lookup"])
  })

  test("late lookup from the previous project is dropped", async () => {
    let resolveA: (value: any) => void = () => {}
    const a = new Promise((resolve) => { resolveA = resolve })
    const { store } = harness({
      lookup: async (dir) => (dir === "/a" ? (a as any) : detail("pod_b", "/b")),
    })
    const opening = store.open("/a")
    await store.open("/b")
    resolveA(detail("pod_a", "/a"))
    await opening
    assert.equal(store.detail()?.pod.id, "pod_b")
  })

  test("cached send-target pod detail is invalidated when the lookup revision changes", async () => {
    resetPodDetailCache()
    let podId = "pod_old"
    let lookups = 0
    const lookup = async () => { lookups++; return detail(podId) }
    const first = await resolvePodDetailCached({
      projectDir: "/p", lookup, revision: 1, now: () => 1_000,
    })
    assert.equal(first?.pod.id, "pod_old")
    assert.equal(lookups, 1)

    // 同一 revision 且 TTL 内：复用缓存（发送路径不该每次 lookup）。
    const cached = await resolvePodDetailCached({
      projectDir: "/p", lookup, revision: 1, now: () => 1_500,
    })
    assert.equal(cached?.pod.id, "pod_old")
    assert.equal(lookups, 1)

    // Pod 重建 → revision 递增 → 旧 pod id 不得继续被发送路径复用。
    podId = "pod_new"
    const rebuilt = await resolvePodDetailCached({
      projectDir: "/p", lookup, revision: 2, now: () => 1_600,
    })
    assert.equal(rebuilt?.pod.id, "pod_new")
    assert.equal(lookups, 2)

    // TTL 过期同样重新探测。
    const expired = await resolvePodDetailCached({
      projectDir: "/p", lookup, revision: 2, ttlMs: 10, now: () => 5_000,
    })
    assert.equal(expired?.pod.id, "pod_new")
    assert.equal(lookups, 3)
  })
})
