import type { MafwNotification, NotificationKind } from "../../../shared/notifications"

export type NotificationFilter = "all" | "unread"

export function filterNotifications(
  items: readonly MafwNotification[],
  filter: NotificationFilter,
): MafwNotification[] {
  return filter === "unread" ? items.filter((item) => item.readAt === undefined) : [...items]
}

export function notificationKindLabel(kind: NotificationKind): string {
  switch (kind) {
    case "goal_result":
      return "Goal 结果"
    case "attention":
      return "需要你"
    case "permission":
      return "权限审批"
    case "question":
      return "Agent 提问"
  }
}

export function notificationReasonLabel(item: MafwNotification): string {
  return item.reason?.trim() || notificationKindLabel(item.kind)
}

export function formatNotificationTime(now: number, ts: number): string {
  const delta = Math.max(0, now - ts)
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  const date = new Date(ts)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function notificationBadgeLabel(unread: number): string {
  if (unread <= 0) return ""
  return unread > 9 ? "9+" : String(unread)
}

export function notificationBellAria(unread: number): string {
  return unread > 0 ? `通知（${unread} 条未读）` : "通知"
}

export function notificationKindIcon(kind: NotificationKind): "checklist" | "bell" | "shield" | "help" {
  switch (kind) {
    case "goal_result":
      return "checklist"
    case "permission":
      return "shield"
    case "question":
      return "help"
    case "attention":
      return "bell"
  }
}
