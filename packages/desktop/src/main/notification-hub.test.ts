import { describe, expect, test } from "bun:test"
import { NotificationHub, type NotificationStoreLike } from "./notification-hub"

function memoryStore(initial: Record<string, unknown> = {}): NotificationStoreLike & { dump(): Record<string, unknown> } {
  let data = { ...initial }
  return {
    get: (key, defaultValue) => (key in data ? data[key] : defaultValue),
    set: (key, value) => {
      data = { ...data, [key]: value }
    },
    dump: () => data,
  }
}

const input = (over: Parameters<NotificationHub["publish"]>[0] = {} as any) => ({
  kind: "attention" as const,
  severity: "p2" as const,
  title: "需要你",
  reason: "需要你",
  ...over,
})

describe("NotificationHub", () => {
  test("publishes, persists and reloads", () => {
    const store = memoryStore()
    const hub = new NotificationHub(store, () => 100)
    const item = hub.publish(input({ dedupeKey: "a" }))
    expect(item?.id).toBe("a")
    expect(hub.snapshot().unread).toBe(1)

    const reloaded = new NotificationHub(store, () => 200)
    expect(reloaded.snapshot().items).toHaveLength(1)
    expect(reloaded.snapshot().items[0].title).toBe("需要你")
  })

  test("dedupes and does not re-emit onNew for an existing item", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    const seen: string[] = []
    hub.onNew((item) => seen.push(item.id))
    hub.publish(input({ dedupeKey: "a", title: "A" }))
    hub.publish(input({ dedupeKey: "a", title: "B" }))
    expect(seen).toEqual(["a"])
    expect(hub.snapshot().items[0].title).toBe("B")
  })

  test("mark read / all / by dedupe persist", () => {
    const store = memoryStore()
    const hub = new NotificationHub(store, () => 100)
    hub.publish(input({ dedupeKey: "permission:1" }))
    hub.publish(input({ dedupeKey: "question:1", kind: "question" }))
    hub.markReadByDedupe(["permission:1"])
    expect(hub.snapshot().unread).toBe(1)
    hub.markRead("all")
    expect(hub.snapshot().unread).toBe(0)
    expect(new NotificationHub(store, () => 200).snapshot().unread).toBe(0)
  })

  test("clearRead keeps unread and tombstones removed keys", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    const read = hub.publish(input({ dedupeKey: "a" }))!
    hub.publish(input({ dedupeKey: "b" }))
    hub.markRead([read.id])
    hub.clearRead()
    expect(hub.snapshot().items.map((item) => item.dedupeKey)).toEqual(["b"])
    expect(hub.publish(input({ dedupeKey: "a" }))).toBeNull()
  })

  test("reconcileAttention marks resolved attention read", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    hub.publish(input({ dedupeKey: "a" }))
    hub.publish(input({ dedupeKey: "b" }))
    hub.reconcileAttention(["b"])
    expect(hub.snapshot().items.find((item) => item.dedupeKey === "a")?.readAt).toBe(100)
    expect(hub.snapshot().items.find((item) => item.dedupeKey === "b")?.readAt).toBeUndefined()
  })

  test("p3 never reaches onNew", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    const seen: string[] = []
    hub.onNew((item) => seen.push(item.id))
    hub.publish(input({ dedupeKey: "p3", severity: "p3" }))
    expect(seen).toEqual([])
    expect(hub.snapshot().unread).toBe(1)
  })

  test("corrupt store starts empty and onChange fires", () => {
    const hub = new NotificationHub(memoryStore({ state: "nope" }), () => 100)
    expect(hub.snapshot().items).toEqual([])
    let changes = 0
    hub.onChange(() => changes++)
    hub.publish(input({ dedupeKey: "a" }))
    expect(changes).toBe(1)
  })
})
