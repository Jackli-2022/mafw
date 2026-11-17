import { describe, expect, test } from "bun:test"
import { NotificationHub, type NotificationStoreLike } from "./notification-hub"
import { publishPresenceNotifications } from "./presence-notifications"

function memoryStore(initial: Record<string, unknown> = {}): NotificationStoreLike {
  let data = { ...initial }
  return {
    get: (key, defaultValue) => (key in data ? data[key] : defaultValue),
    set: (key, value) => {
      data = { ...data, [key]: value }
    },
  }
}

function payload(over: Record<string, unknown> = {}) {
  return {
    attention: { items: [] },
    unreadResults: { count: 0, latest: null },
    ...over,
  }
}

describe("publishPresenceNotifications", () => {
  test("attention becomes a p2 notification with the matching Goal panel", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    publishPresenceNotifications(hub, payload({
      attention: {
        items: [{
          id: "g1:plan_approval:r1",
          goalId: "g1",
          revision: 1,
          kind: "plan_approval",
          title: "计划待批准",
          projectId: "C:/p",
        }],
      },
    }) as any)
    const item = hub.snapshot().items[0]
    expect(item.kind).toBe("attention")
    expect(item.severity).toBe("p2")
    expect(item.reason).toBe("需要你")
    expect(item.target).toEqual({ type: "goal", goalId: "g1", projectId: "C:/p", focus: "plan" })
    expect(item.dedupeKey).toBe("g1:plan_approval:r1")
  })

  test("unread result becomes a p1 Goal result notification", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    publishPresenceNotifications(hub, payload({
      unreadResults: {
        count: 1,
        latest: { goalId: "g1", revision: 2, title: "登录页", projectId: "C:/p" },
      },
    }) as any)
    const item = hub.snapshot().items[0]
    expect(item.kind).toBe("goal_result")
    expect(item.severity).toBe("p1")
    expect(item.title).toContain("结果就绪")
    expect(item.target).toEqual({ type: "goal", goalId: "g1", projectId: "C:/p", focus: "result" })
    expect(item.dedupeKey).toBe("g1:r2")
  })

  test("failed attention for the same result revision is suppressed", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    publishPresenceNotifications(hub, payload({
      attention: {
        items: [{
          id: "g1:failed:r2",
          goalId: "g1",
          revision: 2,
          kind: "failed",
          title: "失败",
          projectId: "C:/p",
        }],
      },
      unreadResults: {
        count: 1,
        latest: { goalId: "g1", revision: 2, title: "登录页", projectId: "C:/p" },
      },
    }) as any)
    expect(hub.snapshot().items).toHaveLength(1)
    expect(hub.snapshot().items[0].kind).toBe("goal_result")
  })

  test("attention disappearing from the snapshot is marked read", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    const withAttention = payload({
      attention: {
        items: [{
          id: "g1:blocked:r1",
          goalId: "g1",
          revision: 1,
          kind: "blocked",
          title: "阻塞",
          projectId: "C:/p",
        }],
      },
    })
    publishPresenceNotifications(hub, withAttention as any)
    expect(hub.snapshot().unread).toBe(1)
    publishPresenceNotifications(hub, payload() as any)
    expect(hub.snapshot().unread).toBe(0)
  })

  test("null payload is a no-op", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    publishPresenceNotifications(hub, null)
    expect(hub.snapshot().items).toEqual([])
  })
})
