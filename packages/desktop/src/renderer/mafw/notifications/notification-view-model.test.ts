import { describe, expect, test } from "bun:test"
import {
  filterNotifications,
  formatNotificationTime,
  notificationBadgeLabel,
  notificationBellAria,
  notificationKindLabel,
  notificationReasonLabel,
} from "./notification-view-model"
import type { MafwNotification } from "../../../shared/notifications"

const item = (over: Partial<MafwNotification> = {}): MafwNotification => ({
  id: "n1",
  kind: "attention",
  severity: "p2",
  title: "需要你",
  reason: "需要你",
  createdAt: 0,
  ...over,
})

describe("notification view model", () => {
  test("filters unread", () => {
    const items = [item({ id: "a" }), item({ id: "b", readAt: 1 })]
    expect(filterNotifications(items, "all").map((n) => n.id)).toEqual(["a", "b"])
    expect(filterNotifications(items, "unread").map((n) => n.id)).toEqual(["a"])
  })

  test("kind labels and reason fallback", () => {
    expect(notificationKindLabel("goal_result")).toBe("Goal 结果")
    expect(notificationKindLabel("attention")).toBe("需要你")
    expect(notificationKindLabel("permission")).toBe("权限审批")
    expect(notificationKindLabel("question")).toBe("Agent 提问")
    expect(notificationReasonLabel(item({ reason: "" }))).toBe("需要你")
  })

  test("relative time boundaries", () => {
    const now = new Date(2026, 0, 10, 12, 0, 0).getTime()
    expect(formatNotificationTime(now, now - 30_000)).toBe("刚刚")
    expect(formatNotificationTime(now, now - 60_000)).toBe("1 分钟前")
    expect(formatNotificationTime(now, now - 59 * 60_000)).toBe("59 分钟前")
    expect(formatNotificationTime(now, now - 60 * 60_000)).toBe("1 小时前")
    expect(formatNotificationTime(now, now - 24 * 60 * 60_000)).toBe("1 天前")
    expect(formatNotificationTime(now, now - 8 * 24 * 60 * 60_000)).toBe("1 月 2 日")
  })

  test("badge and aria labels", () => {
    expect(notificationBadgeLabel(0)).toBe("")
    expect(notificationBadgeLabel(5)).toBe("5")
    expect(notificationBadgeLabel(12)).toBe("9+")
    expect(notificationBellAria(0)).toBe("通知")
    expect(notificationBellAria(3)).toBe("通知（3 条未读）")
  })
})
