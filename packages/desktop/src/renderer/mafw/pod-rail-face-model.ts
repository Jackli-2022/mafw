// 左 dock 鲸群面的行模型（纯函数，无 Solid 依赖）。
// spec: docs/superpowers/specs/2026-10-30-pod-left-rail-design.md §3.2
import { countUnread, type PodUnreadMessage } from "./pod-rail-badge"
import { podShortTime } from "./pod-model"

const ROLE_ORDER = ["lead", "builder", "reviewer"] as const

const STATUS_LABEL: Record<string, string> = {
  working: "工作中",
  available: "待命",
  waiting: "等待",
  sleeping: "休眠",
  retired: "已退役",
}

export type PodMemberRow = {
  id: string
  role: string
  displayName: string
  agentName: string
  statusLabel: string
  dotClass: "working" | "available" | "sleeping" | "waiting"
  sessionId: string | null
  action: string
  openTasks: number
}

type MemberLike = { id: string; role: string; displayName: string; agentName: string; status: string }
type SessionLike = { memberId: string; sessionId: string; endedAt: string | null; createdAt?: string }
type TaskLike = { status: string; ownerMemberId?: string | null }

function activeSessionOf(sessions: SessionLike[], memberId: string): SessionLike | null {
  return sessions
    .filter((session) => session.memberId === memberId && !session.endedAt)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.sessionId.localeCompare(a.sessionId))[0] ?? null
}

function roleRank(role: string): number {
  const index = ROLE_ORDER.indexOf(role as any)
  // 未知角色（如 curator）排在三名班底之后，而不是 index === -1 排到最前。
  return index === -1 ? ROLE_ORDER.length : index
}

function dotOf(status: string): PodMemberRow["dotClass"] {
  if (status === "working") return "working"
  if (status === "sleeping") return "sleeping"
  if (status === "waiting") return "waiting"
  return "available"
}

export function buildMemberRows(
  detail: { members: MemberLike[]; sessions: SessionLike[]; tasks?: TaskLike[] },
  titleOf: (sessionId: string) => string | null,
): PodMemberRow[] {
  const ordered = [...detail.members].sort((a, b) => roleRank(a.role) - roleRank(b.role))
  const tasks = detail.tasks ?? []
  return ordered.map((member) => {
    const session = activeSessionOf(detail.sessions, member.id)
    const statusLabel = STATUS_LABEL[member.status] ?? member.status
    const action = session
      ? `会话中 · ${titleOf(session.sessionId) ?? "会话中"}`
      : statusLabel
    return {
      id: member.id,
      role: member.role,
      displayName: member.displayName,
      agentName: member.agentName,
      statusLabel,
      dotClass: dotOf(member.status),
      sessionId: session?.sessionId ?? null,
      action,
      openTasks: tasks.filter((task) => task.ownerMemberId === member.id && OPEN_TASK_STATUSES.has(task.status)).length,
    }
  })
}

export type PodRecentMessage = {
  id: string
  route: string
  preview: string
  time: string
  unread: boolean
  protocol: "A2A" | "REST" | null
}

/** 最近消息（单行预览）：未读优先保持时间倒序，最多 limit 条。 */
export function buildRecentMessages(
  detail: { members: MemberLike[] },
  messages: Array<{
    id: string
    fromMemberId: string
    toMemberId: string | null
    body: string
    readAt?: string | null
    deliveredAt?: string | null
    protocol?: string | null
    createdAt: string
  }>,
  selfMemberId: string | null,
  nowMs: number,
  limit = 5,
): PodRecentMessage[] {
  const nameOf = (id: string | null) =>
    id ? (detail.members.find((member) => member.id === id)?.displayName ?? id) : "广播"
  return [...messages]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(0, limit))
    .map((message) => ({
      id: message.id,
      route: `${nameOf(message.fromMemberId)} → ${nameOf(message.toMemberId)}`,
      preview: message.body.replace(/\s+/g, " ").trim(),
      time: podShortTime(message.createdAt, nowMs),
      unread: countUnread([message], selfMemberId) > 0,
      protocol: message.protocol === "a2a" ? "A2A" : message.protocol === "rest" ? "REST" : null,
    }))
}

const OPEN_TASK_STATUSES = new Set(["pending", "in_progress", "blocked", "review", "reopened"])

const TODO_STATUSES = new Set(["pending", "in_progress", "blocked", "reopened"])

export function podCounts(
  detail: { tasks: Array<{ status: string }> },
  messages: PodUnreadMessage[],
  selfMemberId: string | null,
): { review: number; todo: number; inbox: number } {
  return {
    review: detail.tasks.filter((task) => task.status === "review").length,
    todo: detail.tasks.filter((task) => TODO_STATUSES.has(task.status)).length,
    inbox: countUnread(messages, selfMemberId),
  }
}

/** 立即提醒只对「指定成员 + 有活跃会话」开放；广播一律禁用。 */
export function canNotify(toMemberId: string | null, hasActiveSession: boolean): boolean {
  return !!toMemberId && hasActiveSession
}

export function deliveryToast(delivery: "delivered" | "pending" | "disabled" | undefined): string {
  if (delivery === "delivered") return "已提醒"
  if (delivery === "pending") return "已发送，对方下次派活时送达"
  return "已发送（投递状态未知）"
}

export type PodEmptyState = "ready" | "create" | "unsupported" | "worktree"

export function podEmptyState(input: { hasPod: boolean; unsupported: boolean; isWorktree: boolean }): PodEmptyState {
  if (input.hasPod) return "ready"
  if (input.unsupported) return "unsupported"
  if (input.isWorktree) return "worktree"
  return "create"
}
