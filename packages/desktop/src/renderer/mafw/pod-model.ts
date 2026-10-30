import type {
  PodDetail,
  PodGoal,
  PodGoalStatus,
  PodMember,
  PodMemberRole,
  PodMemberStatus,
  PodSession,
  PodStatus,
  PodTask,
  PodTaskStatus,
} from "@mafw/sdk"

export type PodTaskLane = "todo" | "in_progress" | "review" | "done" | "failed"

export const POD_TASK_LANES: readonly {
  id: PodTaskLane
  label: string
  statuses: readonly PodTaskStatus[]
}[] = [
  { id: "todo", label: "待办", statuses: ["pending", "reopened"] },
  { id: "in_progress", label: "进行中", statuses: ["in_progress", "blocked"] },
  { id: "review", label: "待审", statuses: ["review"] },
  { id: "done", label: "完成", statuses: ["done"] },
  { id: "failed", label: "失败", statuses: ["failed"] },
]

const ROLE_LABEL: Record<PodMemberRole, string> = {
  lead: "Lead",
  builder: "Builder",
  reviewer: "Reviewer",
  curator: "Curator",
}

const ROLE_BADGE: Record<PodMemberRole, string> = {
  lead: "L",
  builder: "B",
  reviewer: "R",
  curator: "C",
}

const POD_STATUS_LABEL: Record<PodStatus, string> = {
  active: "活跃",
  idle: "空闲",
  paused: "已暂停",
  archived: "已归档",
}

const MEMBER_STATUS_LABEL: Record<PodMemberStatus, string> = {
  available: "待命",
  working: "工作中",
  waiting: "等待",
  sleeping: "休眠",
  retired: "退役",
}

const TASK_STATUS_LABEL: Record<PodTaskStatus, string> = {
  pending: "待办",
  in_progress: "进行中",
  blocked: "阻塞",
  review: "待审",
  done: "完成",
  failed: "失败",
  reopened: "重开",
}

const GOAL_STATUS_LABEL: Record<PodGoalStatus, string> = {
  queued: "排队",
  active: "执行中",
  done: "完成",
  aborted: "中止",
}

export function groupPodTasks(tasks: PodTask[]): Array<{ id: PodTaskLane; label: string; tasks: PodTask[] }> {
  return POD_TASK_LANES.map((lane) => ({
    id: lane.id,
    label: lane.label,
    tasks: tasks
      .filter((task) => lane.statuses.includes(task.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
  }))
}

export function podEventPodId(event: unknown): string | null {
  const raw = event as any
  const id = raw?.properties?.podId ?? raw?.data?.properties?.podId ?? raw?.podId
  return typeof id === "string" && id ? id : null
}

export function podEventAction(input: {
  currentPodId: string | null
  projectDir: string | null
  event: unknown
}): "refresh" | "lookup" | "ignore" {
  if ((input.event as any)?.type !== "pod.updated") return "ignore"
  const podId = podEventPodId(input.event)
  if (!podId) return "ignore"
  if (input.currentPodId) return input.currentPodId === podId ? "refresh" : "ignore"
  return input.projectDir ? "lookup" : "ignore"
}

export function podHttpStatus(err: unknown): number | null {
  const message = String((err as any)?.message ?? err)
  const match = message.match(/HTTP (\d{3})/)
  return match ? Number(match[1]) : null
}

export function podIsUnsupported(err: unknown): boolean {
  const message = String((err as any)?.message ?? err)
  if (/project is not registered/i.test(message)) return false
  if (/older than the SDK|Received HTML instead of JSON/i.test(message)) return true
  return podHttpStatus(err) === 404
}

export function terminalGoalsNewestFirst(goals: PodGoal[]): PodGoal[] {
  return goals
    .filter((goal) => goal.status !== "active" && goal.status !== "queued")
    .sort(
      (a, b) =>
        (b.endedAt ?? b.enqueuedAt).localeCompare(a.endedAt ?? a.enqueuedAt) ||
        b.enqueuedAt.localeCompare(a.enqueuedAt),
    )
}

export function shouldCloseTranscript(openPodId: string | null, currentPodId: string | null): boolean {
  return !!openPodId && openPodId !== currentPodId
}

function memberSessions(detail: PodDetail, memberId: string): PodSession[] {
  return detail.sessions.filter((session) => session.memberId === memberId)
}

export function memberOpenTarget(
  detail: PodDetail,
  memberId: string,
): { kind: "session" | "transcript"; sessionId: string } | null {
  const sessions = memberSessions(detail, memberId)
  const live = sessions
    .filter((session) => !session.endedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (live) return { kind: "session", sessionId: live.sessionId }
  const ended = sessions
    .filter((session) => !!session.endedAt && !!session.transcriptRef)
    .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? "") || b.createdAt.localeCompare(a.createdAt))[0]
  return ended ? { kind: "transcript", sessionId: ended.sessionId } : null
}

export function podRoleForSession(detail: PodDetail | null, sessionID: string): PodMemberRole | null {
  if (!detail) return null
  const session = detail.sessions.find((item) => item.sessionId === sessionID)
  if (!session) return null
  return detail.members.find((member) => member.id === session.memberId)?.role ?? null
}

export function podMemberName(detail: { members: PodMember[] }, memberId: string | null): string {
  if (!memberId) return "系统"
  return detail.members.find((member) => member.id === memberId)?.displayName ?? memberId
}

export function podRoleBadge(role: PodMemberRole): string {
  return ROLE_BADGE[role] ?? "?"
}

export function podRoleLabel(role: PodMemberRole): string {
  return ROLE_LABEL[role] ?? role
}

export function podStatusLabel(status: string): string {
  return POD_STATUS_LABEL[status as PodStatus] ?? status
}

export function podMemberStatusLabel(status: string): string {
  return MEMBER_STATUS_LABEL[status as PodMemberStatus] ?? status
}

export function podTaskStatusLabel(status: PodTaskStatus): string {
  return TASK_STATUS_LABEL[status] ?? status
}

export function podGoalStatusLabel(status: string): string {
  return GOAL_STATUS_LABEL[status as PodGoalStatus] ?? status
}

export function formatPodCost(cost: { spentUsd: number; limitUsd: number } | null): string {
  if (!cost) return "—"
  const spent = `$${cost.spentUsd.toFixed(2)}`
  return cost.limitUsd > 0 ? `${spent} / $${cost.limitUsd.toFixed(2)}` : `${spent} / 不限`
}

export function podShortTime(iso: string | null, nowMs: number): string {
  if (!iso) return ""
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ""
  const diff = Math.max(0, nowMs - at)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return "刚刚"
  if (diff < hour) return `${Math.floor(diff / minute)}m`
  if (diff < day) return `${Math.floor(diff / hour)}h`
  return `${Math.floor(diff / day)}d`
}

export function podTaskArtifacts(task: PodTask): string[] {
  if (!task.artifactRefsJson) return []
  try {
    const parsed = JSON.parse(task.artifactRefsJson)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}
