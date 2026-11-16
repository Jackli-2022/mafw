import type { PodGoal, PodGoalStageActionType, PodWorkBucket } from "@mafw/sdk"
import type { PodEventItem } from "./pod-events"

export type WorkFilter = "all" | "active" | "results" | "history"

const FAILED_VERDICTS = new Set(["FAIL", "ERROR", "MAX_RETRIES"])

function isFailedVerdict(verdict: string | null | undefined): boolean {
  return !!verdict && FAILED_VERDICTS.has(verdict)
}

const GOAL_MODE_LABELS: Record<string, string> = {
  quick: "Quick",
  standard: "Standard",
  standing: "Standing",
}

/** Goal execution shape label; unknown values pass through so new modes stay visible. */
export function goalModeLabel(mode?: string | null): string | null {
  return mode ? (GOAL_MODE_LABELS[mode] ?? mode) : null
}

export const WORK_FILTERS: ReadonlyArray<{ id: WorkFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "active", label: "进行中" },
  { id: "results", label: "结果" },
  { id: "history", label: "历史" },
]

export type WorkPriorityItem =
  | { kind: "attention"; key: string; goal: PodGoal; actionType: PodGoalStageActionType | null; label: string }
  | { kind: "result"; key: string; goal: PodGoal; createdAt: string | null }

const FILTER_OF_BUCKET: Record<PodWorkBucket, Exclude<WorkFilter, "all">> = {
  needs_you: "active",
  queued: "active",
  in_progress: "active",
  result_ready: "results",
  ended: "history",
}

/**
 * Do not rely on the optional bucket alone: old gateways predate the canonical
 * projection, so status/resultReady provide a deterministic fallback.
 */
export function workFilterOf(goal: PodGoal): Exclude<WorkFilter, "all"> {
  if (goal.bucket && FILTER_OF_BUCKET[goal.bucket]) return FILTER_OF_BUCKET[goal.bucket]
  if (goal.resultReady) return "results"
  if (goal.status === "done" || goal.status === "aborted") return "history"
  return "active"
}

export function filterWorkGoals(goals: readonly PodGoal[], filter: WorkFilter): PodGoal[] {
  if (filter === "all") return goals.slice()
  return goals.filter((goal) => workFilterOf(goal) === filter)
}

export function workFilterCounts(goals: readonly PodGoal[]): Record<WorkFilter, number> {
  const counts: Record<WorkFilter, number> = {
    all: goals.length,
    active: 0,
    results: 0,
    history: 0,
  }
  for (const goal of goals) counts[workFilterOf(goal)] += 1
  return counts
}

function currentRevisionOf(goal: PodGoal): number {
  return goal.revision ?? goal.activeRevision ?? 1
}

function attentionLabel(actionType: PodGoalStageActionType | null): string {
  switch (actionType) {
    case "open_plan_review":
      return "审阅计划"
    case "open_question":
      return "回答问题"
    case "open_direction_review":
      return "裁定方向"
    case "open_result":
      return "查看结果"
    default:
      return "打开工作"
  }
}

function resultEventAt(input: {
  events: readonly PodEventItem[]
  goalId: string
  revision: number
}): string | null {
  let latest: string | null = null
  for (const event of input.events) {
    if (event.goalId !== input.goalId || event.revision !== input.revision) continue
    if (event.kind !== "goal.result") continue
    if (latest === null || event.createdAt.localeCompare(latest) > 0) latest = event.createdAt
  }
  return latest
}

/**
 * The human-facing priority area. Attention is deliberately broader than the
 * bucket: a person-owned stage remains actionable even if the work projection
 * happens to place it elsewhere. Results are current-revision only.
 */
export function buildWorkPriority(input: {
  goals: readonly PodGoal[]
  events: readonly PodEventItem[]
  isResultViewed: (goal: PodGoal) => boolean
}): WorkPriorityItem[] {
  const attention: WorkPriorityItem[] = []
  const results: WorkPriorityItem[] = []
  const claimed = new Set<string>()

  for (const goal of input.goals) {
    const revision = currentRevisionOf(goal)
    const identity = `${goal.goalId}:r${revision}`
    if (goal.endedAt && isFailedVerdict(goal.verdict)) {
      attention.push({
        kind: "attention",
        key: `${identity}:attention`,
        goal,
        actionType: "open_result",
        label: "查看失败原因",
      })
      claimed.add(identity)
      continue
    }
    if (goal.stage?.owner === "person" || goal.bucket === "needs_you") {
      const actionType = goal.stage?.action?.type ?? null
      attention.push({
        kind: "attention",
        key: `${identity}:attention`,
        goal,
        actionType,
        label: attentionLabel(actionType),
      })
      claimed.add(identity)
      continue
    }
    if (goal.bucket !== "result_ready" || input.isResultViewed(goal)) continue
    results.push({
      kind: "result",
      key: `${identity}:result`,
      goal,
      createdAt: resultEventAt({ events: input.events, goalId: goal.goalId, revision }),
    })
  }

  results.sort((a, b) => {
    const left = a.kind === "result" ? a.createdAt : null
    const right = b.kind === "result" ? b.createdAt : null
    if (left === right) return a.goal.goalId.localeCompare(b.goal.goalId)
    if (left === null) return 1
    if (right === null) return -1
    return right.localeCompare(left)
  })

  return [...attention, ...results.filter((item) => !claimed.has(`${item.goal.goalId}:r${currentRevisionOf(item.goal)}`))]
}

export type AttentionListKind =
  | "answer" | "plan_approval" | "direction_review" | "review" | "blocked" | "failed"

export interface AttentionListItem {
  key: string
  goal: PodGoal
  kind: AttentionListKind
  label: string
  actionType: PodGoalStageActionType | null
}

const ATTENTION_LABELS: Record<AttentionListKind, string> = {
  answer: "回答问题",
  plan_approval: "批准计划",
  direction_review: "裁定方向",
  review: "查看结果",
  blocked: "处理阻塞",
  failed: "查看失败原因",
}

const ATTENTION_PRIORITY: Record<AttentionListKind, number> = {
  plan_approval: 100,
  direction_review: 90,
  failed: 85,
  answer: 80,
  review: 70,
  blocked: 50,
}

/**
 * Person-first attention list for the workbench. Healthy goals and unread
 * results are excluded here; they stay in the complete Goal list.
 */
export function buildAttentionList(input: {
  goals: readonly PodGoal[]
  attention: readonly unknown[]
  isResultViewed: (goal: PodGoal) => boolean
}): AttentionListItem[] {
  const byGoal = new Map<string, AttentionListItem & { person: boolean }>()
  for (const goal of input.goals) {
    if (goal.endedAt) {
      if (isFailedVerdict(goal.verdict)) {
        byGoal.set(goal.goalId, {
          key: `${goal.goalId}:${currentRevisionOf(goal)}:failed`,
          goal,
          kind: "failed",
          label: ATTENTION_LABELS.failed,
          actionType: "open_result",
          person: true,
        })
      }
      continue
    }
    const stage = goal.stage
    let kind: AttentionListKind | null = null
    let person = false
    if (stage?.owner === "person") {
      person = true
      switch (stage.kind) {
        case "plan_approval": kind = "plan_approval"; break
        case "direction_review": kind = "direction_review"; break
        case "question": kind = "answer"; break
        case "blocked": kind = goal.lastError ? "failed" : "blocked"; break
        case "reviewing":
        case "result_notified": kind = goal.resultReady ? "review" : null; break
        default: kind = null
      }
    } else if (goal.bucket === "result_ready" && !input.isResultViewed(goal)) {
      kind = "review"
    }
    if (!kind || byGoal.has(goal.goalId)) continue
    byGoal.set(goal.goalId, {
      key: `${goal.goalId}:${currentRevisionOf(goal)}:${kind}`,
      goal,
      kind,
      label: ATTENTION_LABELS[kind],
      actionType: stage?.action?.type ?? null,
      person,
    })
  }

  return [...byGoal.values()]
    .sort((a, b) =>
      Number(b.person) - Number(a.person)
      || ATTENTION_PRIORITY[b.kind] - ATTENTION_PRIORITY[a.kind]
      || a.goal.goalId.localeCompare(b.goal.goalId))
    .map(({ person: _person, ...item }) => item)
}

function progressRoleLabel(goal: PodGoal): string {
  const role = goal.currentAssignment?.role ?? goal.stage?.role
  if (role === "builder") return "Builder"
  if (role === "reviewer") return "Reviewer"
  return "任务"
}

export function goalProgressText(goal: PodGoal): string | null {
  const progress = goal.progress
  if (!progress || progress.total <= 0) return null
  return `${progressRoleLabel(goal)} ${progress.done}/${progress.total}`
}

export function goalProgressPercent(goal: PodGoal): number | null {
  const progress = goal.progress
  if (!progress || progress.total <= 0) return null
  return Math.round((progress.done / progress.total) * 100)
}
