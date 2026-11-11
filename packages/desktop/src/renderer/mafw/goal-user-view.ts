// 用户看到的 Goal 只回答三件事：方向、进度、结果；其余内部状态进入技术详情。
import type { PodGoal } from "@mafw/sdk"

export type GoalUserFace = "direction" | "progress" | "result" | "history"

export type GoalUserSummary = {
  goalId: string
  face: GoalUserFace
  statusLabel: string
  ownerLabel: string
  nextActionLabel: string | null
  needsPerson: boolean
  progressText: string | null
  progressPercent: number | null
  revision: number | null
  resultReady: boolean
  ended: boolean
}

export type GoalUserActionIntent =
  | "review_plan"
  | "answer_question"
  | "review_direction"
  | "view_result"
  | "retry"
  | "blocker"
  | null

export function goalUserActionIntent(
  goal: PodGoal,
  context: {
    hasResult: boolean
    hasPendingQuestion: boolean
    hasPendingPlan: boolean
    hasDirectionPending: boolean
    hasRetryTarget: boolean
  },
): GoalUserActionIntent {
  const stage = goal.stage as any
  const actionType = String(stage?.action?.type ?? "")
  const stageKind = String(stage?.kind ?? "")
  if (context.hasPendingPlan || actionType === "open_plan_review" || stageKind === "plan_approval") return "review_plan"
  if (context.hasPendingQuestion || actionType === "open_question" || stageKind === "question") return "answer_question"
  if (context.hasDirectionPending || actionType === "open_direction_review" || stageKind === "direction_review") return "review_direction"
  if (context.hasResult || actionType === "open_result") return "view_result"
  if (goal.lastError) return context.hasRetryTarget ? "retry" : "blocker"
  if (stageKind === "blocked") return context.hasRetryTarget ? "retry" : "blocker"
  if (stage?.owner === "person") return "blocker"
  return null
}

const DIRECTION_STAGE_KINDS = new Set(["discussing", "direction_review", "planning", "plan_approval"])

const ACTION_COPY: Record<string, { status: string; action: string }> = {
  open_direction_review: { status: "方向待裁定", action: "裁定方向" },
  open_plan_review: { status: "计划待确认", action: "审阅计划" },
  open_question: { status: "等待你的回答", action: "回答问题" },
  open_result: { status: "结果待验收", action: "查看结果" },
}

const PERSON_STAGE_STATUS = new Set(["direction_review", "plan_approval", "question", "blocked"])

const STAGE_STATUS: Record<string, string> = {
  discussing: "方向讨论中",
  direction_review: "方向待裁定",
  planning: "正在形成计划",
  plan_approval: "计划待确认",
  question: "等待你的回答",
  blocked: "需要处理阻塞",
  working: "正在推进",
  queued: "排队等待",
  reviewing: "正在评审",
  result_notified: "结果待验收",
  waiting: "等待推进",
}

export function goalUserFace(goal: PodGoal): GoalUserFace {
  if (goal.endedAt) return "history"
  if (goal.resultReady || goal.bucket === "result_ready") return "result"
  const kind = String((goal.stage as any)?.kind ?? "")
  if (DIRECTION_STAGE_KINDS.has(kind)) return "direction"
  return "progress"
}

function progressOf(goal: PodGoal): { text: string | null; percent: number | null } {
  const progress = goal.progress
  if (!progress || !Number.isFinite(progress.total) || progress.total <= 0) {
    return { text: null, percent: null }
  }
  const done = Number.isFinite(progress.done) ? Math.max(0, Math.floor(progress.done)) : 0
  const total = Math.floor(progress.total)
  return {
    text: `${done}/${total} 项任务`,
    percent: Math.max(0, Math.min(100, Math.round((done / total) * 100))),
  }
}

function nextActionOf(input: {
  ended: boolean
  resultReady: boolean
  stageKind: string
  actionType: string
  owner: string
  hasError: boolean
}): string | null {
  if (input.ended) return input.resultReady ? "查看结果" : "查看历史"
  const known = ACTION_COPY[input.actionType]
  if (known) return known.action
  if (input.stageKind === "blocked") return input.hasError ? "重试" : "处理阻塞"
  if (input.resultReady) return "查看结果"
  if (input.owner === "person") return "处理当前事项"
  return null
}

function statusOf(input: {
  ended: boolean
  resultReady: boolean
  stageKind: string
  actionType: string
  owner: string
  hasError: boolean
}): string {
  if (input.ended) return "已结束"
  if (input.stageKind === "blocked" && input.hasError) return "执行失败"
  const known = ACTION_COPY[input.actionType]
  if (known) return known.status
  if (input.resultReady) return "结果待验收"
  if (input.owner === "person") {
    return PERSON_STAGE_STATUS.has(input.stageKind)
      ? (STAGE_STATUS[input.stageKind] ?? "需要你处理")
      : "需要你处理"
  }
  return STAGE_STATUS[input.stageKind] ?? "正在推进"
}

export function summarizeGoalForUser(goal: PodGoal): GoalUserSummary {
  const ended = !!goal.endedAt
  const resultReady = !!goal.resultReady || goal.bucket === "result_ready"
  const stage = goal.stage as any
  const stageKind = String(stage?.kind ?? "")
  const actionType = String(stage?.action?.type ?? "")
  const owner = String(stage?.owner ?? "")
  const hasError = !!goal.lastError
  const progress = progressOf(goal)
  const face = goalUserFace(goal)
  const revision = Number.isFinite(goal.activeRevision) && Number(goal.activeRevision) > 0
    ? Number(goal.activeRevision)
    : Number.isFinite(goal.revision) && Number(goal.revision) > 0
      ? Number(goal.revision)
      : null
  return {
    goalId: goal.goalId,
    face,
    statusLabel: statusOf({ ended, resultReady, stageKind, actionType, owner, hasError }),
    ownerLabel: ended ? "已结束" : "Tech Lead",
    nextActionLabel: nextActionOf({ ended, resultReady, stageKind, actionType, owner, hasError }),
    needsPerson: !ended && (owner === "person" || resultReady || hasError),
    progressText: progress.text,
    progressPercent: progress.percent,
    revision,
    resultReady,
    ended,
  }
}
