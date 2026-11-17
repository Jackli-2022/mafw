// 自绘通知的跨进程契约（main / preload / renderer 共用）。
//
// p1 = Goal 结果；p2 = 需要你（计划批准 / 方向 / 提问 / 权限）。
// 子代理/后台任务完成（p3）不进通知中心，保持现有 in-app toast。

export type NotificationSeverity = "p1" | "p2" | "p3"

export type NotificationKind = "goal_result" | "attention" | "permission" | "question"

export type NotificationTarget =
  | { type: "session"; sessionID: string; projectId?: string }
  | {
      type: "goal"
      goalId: string
      projectId?: string
      focus?: "timeline" | "result" | "plan" | "direction" | "question"
    }
  | { type: "approval"; sessionID: string; requestId?: string; projectId?: string }
  | { type: "question"; sessionID: string; requestId?: string; projectId?: string }
  | { type: "work"; projectId?: string }
  | { type: "config"; section?: string }

export interface MafwNotification {
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  body?: string
  reason: string
  projectId?: string
  createdAt: number
  readAt?: number
  target?: NotificationTarget
  dedupeKey?: string
}

export interface NotificationInput {
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  body?: string
  reason: string
  projectId?: string
  target?: NotificationTarget
  dedupeKey?: string
  /** 测试 / 迁移用；正常路径由 hub 生成。 */
  id?: string
  createdAt?: number
}

export interface NotificationSnapshot {
  items: MafwNotification[]
  unread: number
}

export interface NotificationPrefs {
  /** 自绘悬浮窗；关闭时退回原生通知（仅 p1/p2）。 */
  selfDrawn: boolean
  /** 勿扰：不弹悬浮窗，通知中心照常收。 */
  doNotDisturb: boolean
  /** 悬浮窗创建/加载失败时用原生通知兜底。 */
  fallbackToNative: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  selfDrawn: true,
  doNotDisturb: false,
  fallbackToNative: true,
}

export function isNotificationTarget(value: unknown): value is NotificationTarget {
  if (!value || typeof value !== "object") return false
  const target = value as Record<string, unknown>
  switch (target.type) {
    case "session":
      return typeof target.sessionID === "string" && target.sessionID.length > 0
    case "goal":
      return typeof target.goalId === "string" && target.goalId.length > 0
    case "approval":
    case "question":
      return typeof target.sessionID === "string" && target.sessionID.length > 0
    case "work":
      return true
    case "config":
      return true
    default:
      return false
  }
}
