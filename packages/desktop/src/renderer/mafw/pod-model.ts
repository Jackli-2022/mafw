import type {
  PodDetail,
  PodGoal,
  PodGoalRevision,
  PodGoalRevisionStatus,
  PodGoalStage,
  PodGoalStatus,
  PodGoalVerdict,
  PodMember,
  PodMemberRole,
  PodMemberStatus,
  PodSession,
  PodStatus,
  PodTask,
  PodTaskStatus,
} from "@mafw/sdk"
import { podResultBadge, resultViewedKey } from "./pod-rail-badge"
import { goalSessionTabTitle } from "./goal-session-title"
import { isGeneratedSessionTitle } from "./session-tab-identity"

export type PodTaskLane = "todo" | "in_progress" | "review" | "done" | "skipped" | "failed"

export const POD_TASK_LANES: readonly {
  id: PodTaskLane
  label: string
  statuses: readonly PodTaskStatus[]
}[] = [
  { id: "todo", label: "待办", statuses: ["pending", "reopened"] },
  { id: "in_progress", label: "进行中", statuses: ["in_progress", "blocked"] },
  { id: "review", label: "待审", statuses: ["review"] },
  { id: "done", label: "完成", statuses: ["done"] },
  { id: "skipped", label: "已跳过", statuses: ["skipped"] },
  { id: "failed", label: "失败", statuses: ["failed"] },
]

const ROLE_LABEL: Record<PodMemberRole, string> = {
  lead: "Lead",
  tech_lead: "Tech Lead",
  builder: "Builder",
  reviewer: "Reviewer",
}

const ROLE_BADGE: Record<PodMemberRole, string> = {
  lead: "L",
  tech_lead: "T",
  builder: "B",
  reviewer: "R",
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
  skipped: "已跳过",
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
  if (podRouteMissing(err)) return true
  return podHttpStatus(err) === 404
}

/** 路由缺失（旧 gateway / HTML 回退页），与「这个项目还没有 Pod」的 404 不同。 */
export function podRouteMissing(err: unknown): boolean {
  const message = String((err as any)?.message ?? err)
  return /older than the SDK|Received HTML instead of JSON/i.test(message)
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

/** The only current Lead session the desktop may use: live coordination row. */
export function leadSessionIdFromPod(detail: PodDetail | null): string | null {
  if (!detail) return null
  const lead = detail.members.find((member) => member.role === "lead")
  if (!lead) return null
  const session = detail.sessions
    .filter((row) => row.memberId === lead.id && row.node === "coordination" && !row.endedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return session?.sessionId ?? null
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
  // Lead is an identity, not a fixed runtime id: an empty id asks the shell to
  // call lead/ensure and open the resulting coordination session.
  const member = detail.members.find((item) => item.id === memberId)
  if (member?.role === "lead") return { kind: "session", sessionId: "" }
  const ended = sessions
    .filter((session) => !!session.endedAt && !!session.transcriptRef)
    .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? "") || b.createdAt.localeCompare(a.createdAt))[0]
  return ended ? { kind: "transcript", sessionId: ended.sessionId } : null
}

/** 班底焦点行的节点词表（spec 2026-11-04-techlead-goal-entry §3.3）。 */
const POD_NODE_LABELS: Record<string, string> = {
  discussion: "讨论",
  plan: "规划",
  execute: "实施",
  review: "评审",
  probe: "探针",
  coordination: "协调",
}

export type MemberFocusTarget =
  | { kind: "session" | "transcript"; sessionId: string }
  | { kind: "techlead"; goalId: string }
  | null

/**
 * 班底焦点行：行 = 目录 + 当前焦点。
 *
 * Tech Lead 恒走 `techlead` 通路（shell 的 openTechLead → ensureSession 打开该 Goal
 * 的讨论 tab，可发送且标题正确；节点会话不占入口）。其余成员维持 memberOpenTarget：
 * 最新 live 会话，或已结束且带快照的 transcript。焦点文字只描述「在哪个 Goal 的哪一步」，
 * 绝不包含 runtime session id。
 */
export function memberFocus(
  detail: PodDetail | null,
  memberId: string,
): { focusText: string | null; target: MemberFocusTarget } {
  if (!detail) return { focusText: null, target: null }
  const member = detail.members.find((item) => item.id === memberId)
  if (!member) return { focusText: null, target: null }
  const sessions = memberSessions(detail, memberId)
  const live = sessions
    .filter((session) => !session.endedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const goalOf = (goalId: string | null | undefined) =>
    goalId ? (detail.goals ?? []).find((goal) => goal.goalId === goalId) : undefined
  const focusOf = (session: PodSession | undefined): string | null => {
    if (!session) return null
    const label = POD_NODE_LABELS[session.node ?? ""] ?? "工作"
    const title = goalOf(session.goalId)?.title || "未命名目标"
    return `${label}「${title}」`
  }

  if (member.role === "tech_lead") {
    // 最新 live 会话所在 Goal 优先；没有 live 会话时指向第一个非终态 Goal（打开即 ensure）。
    const activeGoal = goalOf(live?.goalId) ?? (detail.goals ?? []).find((goal) => !goal.endedAt)
    if (activeGoal) {
      return {
        focusText: focusOf(live) ?? `讨论「${activeGoal.title || "未命名目标"}」`,
        target: { kind: "techlead", goalId: activeGoal.goalId },
      }
    }
    return { focusText: focusOf(live), target: memberOpenTarget(detail, memberId) }
  }

  if (member.role === "lead") {
    return { focusText: live ? focusOf(live) : "协调中", target: memberOpenTarget(detail, memberId) }
  }

  return { focusText: focusOf(live), target: memberOpenTarget(detail, memberId) }
}

export function podRoleForSession(detail: PodDetail | null, sessionID: string): PodMemberRole | null {
  if (!detail) return null
  const session = detail.sessions.find((item) => item.sessionId === sessionID)
  if (!session) return null
  return detail.members.find((member) => member.id === session.memberId)?.role ?? null
}

/** Pod 会话的归属（Tab 推理用）：谁、哪个 Goal、什么作用域。 */
export interface PodSessionRoute {
  role: PodMemberRole | null
  goalId: string | null
  node: string | null
  scopeKind: string | null
  /** Tech Lead 讨论会话（唯一允许经 sendTechLeadMessage 复用的作用域）。 */
  isDiscussion: boolean
}

/** 会话 → Pod 归属（旧 gateway 可能没有 sessions/scopeKind，返回 null 而不是猜）。 */
export function podSessionRoute(detail: PodDetail | null, sessionID: string): PodSessionRoute | null {
  if (!detail || !sessionID) return null
  const session = (detail.sessions ?? []).find((item) => item.sessionId === sessionID)
  if (!session) return null
  const role = detail.members.find((member) => member.id === session.memberId)?.role ?? null
  const scopeKind = (session as PodSession & { scopeKind?: string | null }).scopeKind ?? null
  const isDiscussion = scopeKind === "discussion" || session.node === "discussion"
  return { role, goalId: session.goalId ?? null, node: session.node ?? null, scopeKind, isDiscussion }
}

/** Task 14：Goal 会话的唯一身份（标题/角色/归属/是否已结束）。 */
export interface GoalSessionIdentity {
  role: PodMemberRole | null
  goalId: string | null
  revision: number | null
  title: string
  ended: boolean
  /** 已结束且存在快照：只能打开 transcript，绝不走 live session。 */
  transcript: boolean
}

export function goalSessionIdentity(
  detail: PodDetail | null,
  sessionID: string,
): GoalSessionIdentity | null {
  if (!detail || !sessionID) return null
  const session = (detail.sessions ?? []).find((item) => item.sessionId === sessionID)
  if (!session) return null
  const route = podSessionRoute(detail, sessionID)
  const goal = session.goalId
    ? (detail.goals ?? []).find((item) => item.goalId === session.goalId)
    : null
  const revision = typeof goal?.activeRevision === "number"
    ? goal.activeRevision
    : (typeof goal?.revision === "number" ? goal.revision : null)
  const goalTitle = goal?.title ?? ""
  const role = route?.role ?? null
  let title: string
  if (role === "tech_lead" || role === "builder" || role === "reviewer") {
    title = goalSessionTabTitle({ goalTitle, revision: revision ?? 1, role })
  } else if (role === "lead") {
    title = goalTitle ? `Lead · ${goalTitle}` : "Lead"
  } else {
    title = goalTitle || "Pod 会话"
  }
  const ended = !!session.endedAt
  return {
    role,
    goalId: session.goalId ?? null,
    revision,
    title,
    ended,
    transcript: ended && !!session.transcriptRef,
  }
}

/** 把已打开（含从布局恢复）的 Pod 会话 tab 升级为同一种 Goal 身份。 */
export function reconcileGoalSessionTabs<T extends {
  id: string
  title?: string
  metadata?: { mafw?: { role?: string } } | null
}>(
  tabs: T[],
  detail: PodDetail | null,
): T[] {
  if (!detail) return tabs
  let changed = false
  const next = tabs.map((tab) => {
    const identity = goalSessionIdentity(detail, tab.id)
    if (!identity || identity.role === "lead") return tab
    const role = identity.role
    const nextTitle = isGeneratedSessionTitle(tab.title) ? identity.title : tab.title
    if (tab.title === nextTitle && tab.metadata?.mafw?.role === role) return tab
    changed = true
    return {
      ...tab,
      title: nextTitle,
      metadata: { ...(tab.metadata ?? {}), mafw: { role } },
    }
  })
  return changed ? next : tabs
}

/**
 * Tech Lead 讨论 tab 的发送目标（Task 20 review）：不从 tab metadata 猜，而是用
 * Pod 成员/会话归属反推——PodDock / ProjectResources / Goal 详情等所有入口都能命中。
 */
export function techLeadRouteForSession(
  detail: PodDetail | null,
  sessionID: string,
): { podId: string; goalId: string } | null {
  if (!detail) return null
  const route = podSessionRoute(detail, sessionID)
  if (!route || route.role !== "tech_lead" || !route.goalId || !route.isDiscussion) return null
  return { podId: detail.pod.id, goalId: route.goalId }
}

/**
 * 非讨论的 Tech Lead 会话（plan/节点会话）禁止在 tab 里直接发送：普通 prompt 会绕过
 * 身份/ContextManifest，而改投讨论会话又会让用户的消息出现在另一个会话里。给出明确
 * 指引而不是静默走错通道。
 */
export function techLeadSendBlockedReason(detail: PodDetail | null, sessionID: string): string | null {
  const route = podSessionRoute(detail, sessionID)
  if (!route || route.role !== "tech_lead" || !route.goalId || route.isDiscussion) return null
  return "这是 Tech Lead 的节点会话；请打开该 Goal 的「Tech Lead 讨论」后再发送。"
}

/** Pod 解析不出来时的 fail-closed 指引（绝不降级成普通 session prompt）。 */
export const TECH_LEAD_UNRESOLVED_GUIDANCE =
  "无法确认该 Tech Lead 会话所属 Goal（Pod 未加载或不可用）；请从 Goal 的「Tech Lead 讨论」入口打开后再发送。"

/**
 * Tech Lead 发送策略（纯函数）：目标 / 拦截二选一。优先本次打开时记录的 Goal 映射
 * （仍要校验 Pod 拥有该 Goal），其次从 Pod 成员+作用域推断；Pod 解析失败时，只要
 * tab 是 Tech Lead 或带着映射 Goal，就 fail-closed 返回指引。
 */
export function techLeadSendGate(input: {
  detail: PodDetail | null
  sessionID: string
  mappedGoalId?: string | null
  role?: string | null
}): { target: { podId: string; goalId: string } | null; blocked: string | null } {
  const detail = input.detail
  const mappedGoal = (input.mappedGoalId ?? "").trim()
  if (detail) {
    if (mappedGoal && detail.goals?.some((goal) => goal.goalId === mappedGoal)) {
      return { target: { podId: detail.pod.id, goalId: mappedGoal }, blocked: null }
    }
    const inferred = techLeadRouteForSession(detail, input.sessionID)
    if (inferred) return { target: inferred, blocked: null }
    const reason = techLeadSendBlockedReason(detail, input.sessionID)
    if (reason) return { target: null, blocked: reason }
  }
  // Pod 不可解析（或会话已不在 Pod 记录里）：Tech Lead 语义下必须 fail-closed。
  if (input.role === "tech_lead" || mappedGoal) {
    return { target: null, blocked: TECH_LEAD_UNRESOLVED_GUIDANCE }
  }
  return { target: null, blocked: null }
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

const STAGE_LABEL: Record<string, string> = {
  plan_approval: "等待你批准计划",
  direction_review: "等待你裁定方向",
  question: "等待你回答",
  blocked: "需要处理",
  queued: "排队中",
  discussing: "Tech Lead 讨论中",
  planning: "Tech Lead 规划中",
  probing: "Spike 验证中",
  implementing: "Builder 实施中",
  reviewing: "Reviewer 验收中",
  result_notified: "结果已通知",
  working: "团队工作中",
  waiting: "等待触发",
  ended: "已结束",
}

export function podStageLabel(stage: Pick<PodGoalStage, "owner" | "kind"> & { queueReason?: PodGoalStage["queueReason"] }): string {
  if (stage.owner === "team" && stage.kind === "working") return "团队工作中"
  if (stage.owner === "team" && stage.kind === "queued") {
    if (stage.queueReason === "paused") return "已暂停，等待恢复"
    if (stage.queueReason === "archived") return "已归档，等待恢复"
    if (stage.queueReason === "budget") return "等待预算"
    if (stage.queueReason === "state_error") return "状态异常，需要处理"
    return "排队中"
  }
  return STAGE_LABEL[stage.kind] ?? stage.kind
}

export function podStageTone(stage: Pick<PodGoalStage, "owner">): "person" | "team" | "system" {
  return stage.owner
}

const GOAL_VERDICT_LABEL: Record<PodGoalVerdict, string> = {
  PASS: "已完成",
  FAIL: "未通过",
  MAX_RETRIES: "达到轮次上限",
  ERROR: "技术失败",
  CANCELLED: "已取消",
}

export function podGoalResultLabel(verdict: PodGoalVerdict | null): string {
  return verdict ? GOAL_VERDICT_LABEL[verdict] ?? verdict : "已结束"
}

export function goalQueueRow(goal: Pick<PodGoal, "title" | "verdict" | "stage">): string {
  const status = goal.stage.kind === "ended" && goal.verdict
    ? podGoalResultLabel(goal.verdict)
    : podStageLabel(goal.stage)
  return `${goal.title} · ${status}`
}

export function attentionCount(detail: Pick<PodDetail, "attention">): number {
  return detail.attention.length
}

export function planTaskOnly(tasks: PodTask[]): PodTask[] {
  return tasks.filter((task) => task.kind === "plan")
}

export function noteTasksOnly(tasks: PodTask[]): PodTask[] {
  return tasks.filter((task) => task.kind === "note")
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

/**
 * 任务板编辑只对「计划投影任务」开放：手工任务没有 goalId/externalTaskId，改不了计划。
 */
export function canEditPlanTask(task: Pick<PodTask, "goalId" | "externalTaskId">): boolean {
  return !!task.goalId && !!task.externalTaskId
}

/** 当前可编辑计划的 goal：Pod 同时只有一个 active。 */
export function podActiveGoalId(goals: PodGoal[]): string | null {
  return goals.find((goal) => goal.status === "active")?.goalId ?? null
}

/** acceptanceJson → string[]（坏数据 fail-open 为空）。 */
export function podTaskAcceptance(task: Pick<PodTask, "acceptanceJson">): string[] {
  if (!task.acceptanceJson) return []
  try {
    const parsed = JSON.parse(task.acceptanceJson)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
      : []
  } catch {
    return []
  }
}

const MAX_ACCEPTANCE_ITEMS = 20
const MAX_ACCEPTANCE_CHARS = 500

/** textarea → acceptance[]：一行一条、去空、去重、上限与服务端一致。 */
export function parseAcceptanceLines(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const value = raw.trim().slice(0, MAX_ACCEPTANCE_CHARS)
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= MAX_ACCEPTANCE_ITEMS) break
  }
  return out
}

export function formatAcceptanceLines(lines: string[]): string {
  return lines.join("\n")
}

export function podMessageProtocolLabel(message: { protocol?: string | null }): "A2A" | "REST" | null {
  if (message.protocol === "a2a") return "A2A"
  if (message.protocol === "rest") return "REST"
  return null
}

export function podMessageDeliveryLabel(message: { deliveredAt?: string | null }): "已投递" | "待投递" | null {
  if (message.deliveredAt === undefined) return null
  return message.deliveredAt ? "已投递" : "待投递"
}

/**
 * 出站消息的送达徽标：只有「我发的」才需要知道对方收没收到。
 * 注意我们只有「已送达」（进入对方会话上下文），没有「已读」——agent 不作已读回执。
 */
export function podOutgoingDelivery(
  message: { fromMemberId: string; toMemberId?: string | null; deliveredAt?: string | null },
  selfMemberId: string | null,
): "已送达" | "待送达" | null {
  if (!selfMemberId || message.fromMemberId !== selfMemberId) return null
  // Broadcasts now have per-recipient delivery rows; a single delivered_at no
  // longer means the whole audience received it.
  if (message.toMemberId === null) return null
  if (message.deliveredAt === undefined) return null
  return message.deliveredAt ? "已送达" : "待送达"
}

// ── Task 21：结果通知 / 打回 / revision 历史 ─────────────────────────────────

const REVISION_STATUS_LABEL: Record<PodGoalRevisionStatus, string> = {
  discussing: "讨论中",
  direction_review: "方向待裁定",
  planning: "规划中",
  plan_review: "计划待批准",
  queued: "排队中",
  implementing: "实施中",
  reviewing: "验收中",
  completed: "已完成",
  aborted: "已中止",
  discarded: "已丢弃",
}

export function revisionStatusLabel(status: string | null | undefined): string {
  if (!status) return ""
  return REVISION_STATUS_LABEL[status as PodGoalRevisionStatus] ?? status
}

/** 结果标题：带 revision 前缀，旧版结果不会冒充当前版。 */
export function resultStatus(input: {
  verdict?: PodGoalVerdict | null
  revision?: number | null
  assessment?: "reviewed" | "unreviewed" | null
  reviewed?: boolean
}): string {
  const label = podResultVerdictLabel(input.verdict ?? null)
  const shown = !input.verdict && (input.assessment === "unreviewed" || input.reviewed === false)
    ? "已完成（未独立评审）"
    : label
  const revision = input.revision
  return typeof revision === "number" && Number.isFinite(revision) && revision > 0
    ? `revision ${Math.floor(revision)} · ${shown}`
    : shown
}

/** 快速完成没有独立 Reviewer：显式说明，绝不把「已执行」读成「已验收」。 */
export function podResultAssessmentLabel(input: {
  verdict?: PodGoalVerdict | null
  assessment?: "reviewed" | "unreviewed" | null
  reviewed?: boolean
}): string | null {
  if (input.assessment === "unreviewed") return "未独立评审"
  if (input.reviewed === false) return "未独立评审"
  return null
}

/** 结果 verdict 文案（与 Goal 卡片的「已完成」不同：结果讲通过/未通过）。 */
const RESULT_VERDICT_LABEL: Record<PodGoalVerdict, string> = {
  PASS: "已通过",
  FAIL: "未通过",
  MAX_RETRIES: "达到轮次上限",
  ERROR: "技术失败",
  CANCELLED: "已取消",
}

export function podResultVerdictLabel(verdict: PodGoalVerdict | null): string {
  return verdict ? RESULT_VERDICT_LABEL[verdict] ?? verdict : "已结束"
}

/** 只有已收尾的 revision 可以打回（正在规划/实施/验收时打回会抢跑并发状态）。 */
const REJECTABLE_REVISION_STATUSES = new Set<string>(["completed", "aborted"])

export function rejectButtonLabel(input: { status: string | null | undefined }): string | null {
  return input.status && REJECTABLE_REVISION_STATUSES.has(input.status)
    ? "打回并继续讨论"
    : null
}

/** 打回失败的可读原因（HTTP 状态 → 文案；未知一律通用文案）。 */
export function rejectErrorMessage(status: number | null): string {
  if (status === 400) return "请填写打回原因（会作为下一版讨论的输入）"
  if (status === 409) return "这一版结果已收尾或正在处理，无法打回；请刷新后再试"
  if (status === 404) return "结果不存在或已被清理"
  if (status === 503) return "当前 gateway 不支持打回，请升级"
  return "打回失败，请稍后重试"
}

// ── Task 13：统一 Goal 详情与人工行动 ───────────────────────────────────────

export type GoalDetailFocus = "timeline" | "plan" | "question" | "direction" | "result"

/**
 * attention.action.type → 详情里应该展开/滚动到的区域。
 * 不按类型分流时，计划批准/提问/方向裁定都会落到「无动作的执行时间线」。
 */
export function attentionTarget(action: { type?: string | null } | null | undefined): GoalDetailFocus {
  switch (action?.type) {
    case "open_plan_review": return "plan"
    case "open_question": return "question"
    case "open_direction_review": return "direction"
    case "open_result": return "result"
    default: return "timeline"
  }
}

export type PlanEditGate = { editable: boolean; reason: string | null }

/**
 * 与服务端 `PodTaskService.loadEditablePlan` 对齐：节点在跑（任何团队工作阶段）
 * 或 Goal 已终态时，计划编辑必然 409，UI 不应显示一个注定失败的按钮。
 */
export function planEditGate(input: {
  terminal: boolean
  stage?: Pick<PodGoalStage, "kind"> | null
}): PlanEditGate {
  if (input.terminal) return { editable: false, reason: "Goal 已结束，计划不再可编辑" }
  const kind = input.stage?.kind
  if (kind === "plan_approval") return { editable: true, reason: null }
  if (kind === "question") return { editable: true, reason: null }
  if (kind === "discussing" || kind === "direction_review") {
    return { editable: false, reason: "还没有可编辑的执行计划" }
  }
  if (
    kind === "planning" || kind === "probing" || kind === "implementing"
    || kind === "reviewing" || kind === "working" || kind === "waiting"
  ) {
    return { editable: false, reason: "节点正在运行，结束后才能编辑计划" }
  }
  return { editable: false, reason: "当前阶段不能编辑计划" }
}

export type PodRevisionHistoryRow = {
  revision: number
  status: PodGoalRevisionStatus | string
  statusLabel: string
  verdictLabel: string | null
  feedback: string | null
  current: boolean
  enqueuedAt: string
  endedAt: string | null
}

/**
 * 版本历史（新→旧）：旧 revision 的 verdict/feedback 永不丢。
 * `activeRevision` 缺省时以最大 revision 为当前版（与 gateway 指针一致）。
 */
export function revisionHistory(
  revisions: Array<Pick<PodGoalRevision, "revision" | "status" | "verdict" | "feedback" | "enqueuedAt" | "endedAt">> | null | undefined,
  activeRevision: number | null,
): PodRevisionHistoryRow[] {
  const list = Array.isArray(revisions) ? revisions : []
  const active = activeRevision
    ?? (list.length > 0 ? Math.max(...list.map((item) => item.revision)) : null)
  return [...list]
    .sort((a, b) => b.revision - a.revision)
    .map((item) => ({
      revision: item.revision,
      status: item.status,
      statusLabel: revisionStatusLabel(item.status),
      verdictLabel: item.verdict ? podResultVerdictLabel(item.verdict) : null,
      feedback: item.feedback?.trim() || null,
      current: active != null && item.revision === active,
      enqueuedAt: item.enqueuedAt,
      endedAt: item.endedAt,
    }))
}

/** Goal 当前 revision（gateway 运行时字段；旧 gateway 缺省 → null）。 */
export function goalRevisionOf(goal: object | null | undefined): number | null {
  const revision = (goal as { revision?: unknown } | null | undefined)?.revision
  return typeof revision === "number" && Number.isFinite(revision) && revision > 0
    ? Math.floor(revision)
    : null
}

/**
 * 最新的未查看结果（通知/结果点用）：
 * 只看 resultReady，不把未读消息或仍在跑的 Goal 算进来。
 */
export function latestUnviewedResult<T extends {
  goalId: string
  resultReady?: boolean | null
  revision?: number | null
  endedAt?: string | null
  enqueuedAt?: string
}>(
  goals: T[],
  opts: { podId: string; viewed: (key: string) => boolean },
): T | null {
  const ready = goals
    .filter((goal) => !!goal.resultReady)
    .filter((goal) => {
      const revision = goalRevisionOf(goal) ?? 1
      return podResultBadge({
        resultReady: true,
        viewed: opts.viewed(resultViewedKey(opts.podId, goal.goalId, revision)),
      }) === "result"
    })
    .sort((a, b) => (b.endedAt ?? b.enqueuedAt ?? "").localeCompare(a.endedAt ?? a.enqueuedAt ?? ""))
  return ready[0] ?? null
}

/** `pod.updated` 的结果通知事件（kind=result；goalId 可选）。 */
export function podResultEvent(event: unknown): { podId: string; goalId: string | null } | null {
  const raw = event as any
  if (raw?.type !== "pod.updated") return null
  const props = raw.properties
  if (!props || props.kind !== "result") return null
  const podId = typeof props.podId === "string" ? props.podId : ""
  if (!podId) return null
  const goalId = typeof props.goalId === "string" && props.goalId ? props.goalId : null
  return { podId, goalId }
}

/** OS 通知文案（标题固定，正文含 Goal + revision + 结果；标题截断防溢出）。 */
export function podResultNotice(input: {
  title?: string | null
  verdict?: PodGoalVerdict | null
  revision?: number | null
}): { title: string; body: string } {
  const title = (input.title ?? "").trim().slice(0, 80) || "未命名目标"
  return {
    title: "MAFW：鲸群结果",
    body: `${title} · ${resultStatus({ verdict: input.verdict ?? null, revision: input.revision ?? null })}`,
  }
}
