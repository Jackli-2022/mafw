import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createPodStore, type PodStoreApi } from "./pod-store"

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
    cost: async () => ({ spentUsd: 1, limitUsd: 10 }),
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
})
