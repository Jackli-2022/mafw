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

  test("a partial snapshot (count > items) never reconciles attention read", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    const withAttention = payload({
      attention: {
        count: 1,
        items: [{
          id: "g1:plan_approval:r1",
          goalId: "g1",
          revision: 1,
          kind: "plan_approval",
          title: "待批准",
          projectId: "C:/p",
        }],
      },
    })
    publishPresenceNotifications(hub, withAttention as any)
    expect(hub.snapshot().unread).toBe(1)

    // 网关抖动 / 冷启动：count 说有 1 条在等待，items 却为空 → 不当作已解决。
    const flapping = payload({ attention: { count: 1, items: [] } })
    publishPresenceNotifications(hub, flapping as any)
    expect(hub.snapshot().unread).toBe(1)

    // 恢复健康的快照才是权威。
    publishPresenceNotifications(hub, payload({ attention: { count: 0, items: [] } }) as any)
    expect(hub.snapshot().unread).toBe(0)
  })

  test("failed attention published before the result is auto-read when the result lands", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    // poll 1：只看到 failed attention，结果还没进 unreadResults。
    publishPresenceNotifications(hub, payload({
      attention: {
        items: [{
          id: "g1:failed:r1",
          goalId: "g1",
          revision: 1,
          kind: "failed",
          title: "失败",
          projectId: "C:/p",
        }],
      },
    }) as any)
    expect(hub.snapshot().unread).toBe(1)

    // poll 2：p1 结果就绪 → 同 goal+revision 的 failed attention 自动已读。
    publishPresenceNotifications(hub, payload({
      unreadResults: {
        count: 1,
        latest: { goalId: "g1", revision: 1, title: "登录页", projectId: "C:/p" },
      },
    }) as any)
    const failed = hub.snapshot().items.find((i) => i.id === "g1:failed:r1")
    const result = hub.snapshot().items.find((i) => i.id === "g1:r1")
    expect(failed?.readAt).toBe(100)
    expect(result?.readAt).toBeUndefined()
    expect(hub.snapshot().unread).toBe(1)
  })

  test("null payload is a no-op", () => {
    const hub = new NotificationHub(memoryStore(), () => 100)
    publishPresenceNotifications(hub, null)
    expect(hub.snapshot().items).toEqual([])
  })
})
