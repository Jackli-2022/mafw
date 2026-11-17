import { describe, expect, test } from "bun:test"
import {
  NOTIFICATION_LIMIT,
  NOTIFICATION_SEEN_LIMIT,
  clearReadNotifications,
  emptyNotificationState,
  markNotificationRead,
  markNotificationReadByDedupe,
  normalizeNotificationState,
  publishNotification,
  reconcileAttentionNotifications,
  removeNotification,
  unreadNotificationCount,
  type NotificationInput,
} from "./notification-model"

const input = (over: Partial<NotificationInput> = {}): NotificationInput => ({
  kind: "attention",
  severity: "p2",
  title: "需要你",
  reason: "需要你",
  ...over,
})

describe("notification model", () => {
  test("publish creates an unread item and dedupes by key", () => {
    const first = publishNotification(emptyNotificationState(), input({ dedupeKey: "a", title: "A" }), 100)
    expect(first.isNew).toBe(true)
    expect(first.item?.title).toBe("A")
    expect(unreadNotificationCount(first.state)).toBe(1)

    const second = publishNotification(first.state, input({ dedupeKey: "a", title: "A2" }), 200)
    expect(second.isNew).toBe(false)
    expect(second.state.items).toHaveLength(1)
    expect(second.state.items[0].title).toBe("A2")
    // 更新保留原始 createdAt（presence 每 15s 重报同一 attention，不能永远「刚刚」）。
    expect(second.state.items[0].createdAt).toBe(100)
    expect(unreadNotificationCount(second.state)).toBe(1)
  })

  test("identical re-publish is a no-op returning the same state reference", () => {
    const first = publishNotification(emptyNotificationState(), input({ dedupeKey: "a", title: "A" }), 100)
    const again = publishNotification(first.state, input({ dedupeKey: "a", title: "A" }), 5000)
    expect(again.isNew).toBe(false)
    expect(again.state).toBe(first.state)
    expect(again.item).toBe(first.state.items[0])
  })

  test("mark read keeps the item but clears unread", () => {
    const { state, item } = publishNotification(emptyNotificationState(), input({ dedupeKey: "a" }), 100)
    const read = markNotificationRead(state, [item!.id], 150)
    expect(read.items[0].readAt).toBe(150)
    expect(unreadNotificationCount(read)).toBe(0)
    const all = markNotificationRead(state, "all", 160)
    expect(all.items[0].readAt).toBe(160)
  })

  test("cleared key is tombstoned and never resurrects", () => {
    const { state, item } = publishNotification(emptyNotificationState(), input({ dedupeKey: "a" }), 100)
    const read = markNotificationRead(state, [item!.id], 110)
    const cleared = clearReadNotifications(read)
    expect(cleared.items).toHaveLength(0)
    expect(cleared.seenKeys).toContain("a")

    const again = publishNotification(cleared, input({ dedupeKey: "a" }), 200)
    expect(again.item).toBeNull()
    expect(again.isNew).toBe(false)
    expect(again.state.items).toHaveLength(0)
  })

  test("markReadByDedupe marks matching items only", () => {
    const a = publishNotification(emptyNotificationState(), input({ dedupeKey: "permission:1" }), 100)
    const b = publishNotification(a.state, input({ dedupeKey: "question:1", kind: "question" }), 110)
    const read = markNotificationReadByDedupe(b.state, ["permission:1"], 120)
    expect(read.items.find((i) => i.dedupeKey === "permission:1")?.readAt).toBe(120)
    expect(read.items.find((i) => i.dedupeKey === "question:1")?.readAt).toBeUndefined()
  })

  test("reconcileAttention marks attention items that are no longer active", () => {
    const a = publishNotification(emptyNotificationState(), input({ dedupeKey: "goal:1:blocked:r1" }), 100)
    const b = publishNotification(a.state, input({ dedupeKey: "goal:2:blocked:r1", title: "B" }), 110)
    const out = reconcileAttentionNotifications(b.state, ["goal:2:blocked:r1"], 120)
    expect(out.items.find((i) => i.dedupeKey === "goal:1:blocked:r1")?.readAt).toBe(120)
    expect(out.items.find((i) => i.dedupeKey === "goal:2:blocked:r1")?.readAt).toBeUndefined()
  })

  test("remove drops one item", () => {
    const a = publishNotification(emptyNotificationState(), input({ dedupeKey: "a" }), 100)
    const out = removeNotification(a.state, a.item!.id)
    expect(out.items).toHaveLength(0)
    expect(out.seenKeys).toContain("a")
  })

  test("cap drops oldest read before oldest unread", () => {
    let state = emptyNotificationState()
    for (let i = 0; i < NOTIFICATION_LIMIT; i++) {
      state = publishNotification(state, input({ dedupeKey: `k${i}`, title: `t${i}` }), i).state
    }
    const read = markNotificationRead(state, state.items.slice(-1).map((i) => i.id), NOTIFICATION_LIMIT + 1)
    const next = publishNotification(read, input({ dedupeKey: "new", title: "new" }), NOTIFICATION_LIMIT + 2).state
    expect(next.items).toHaveLength(NOTIFICATION_LIMIT)
    expect(next.items.some((i) => i.title === "t0")).toBe(false)
    expect(next.items.some((i) => i.title === "new")).toBe(true)
  })

  test("seenKeys is capped", () => {
    let state = emptyNotificationState()
    for (let i = 0; i < NOTIFICATION_SEEN_LIMIT + 5; i++) {
      state = publishNotification(state, input({ dedupeKey: `k${i}` }), i).state
    }
    expect(state.seenKeys).toHaveLength(NOTIFICATION_SEEN_LIMIT)
    expect(state.seenKeys).not.toContain("k0")
  })

  test("normalize drops malformed entries and dedupes ids", () => {
    const out = normalizeNotificationState({
      items: [
        { id: "a", kind: "attention", severity: "p2", title: "A", reason: "r", createdAt: 1 },
        { id: "a", kind: "attention", severity: "p2", title: "A2", reason: "r", createdAt: 2 },
        { id: "bad", kind: "nope", severity: "p2", title: "B", reason: "r", createdAt: 3 },
        null,
      ],
      seenKeys: ["a", 4],
    })
    expect(out.items).toHaveLength(1)
    expect(out.items[0].title).toBe("A2")
    expect(out.seenKeys).toEqual(["a"])
  })
})
