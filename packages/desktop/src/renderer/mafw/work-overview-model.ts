import type { PodGoal, PodGoalStageActionType, PodWorkBucket } from "@mafw/sdk"
import type { PodEventItem } from "./pod-events"

export type WorkFilter = "all" | "active" | "results" | "history"

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
    if (goal.stage.owner === "person" || goal.bucket === "needs_you") {
      const actionType = goal.stage.action?.type ?? null
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

function progressRoleLabel(goal: PodGoal): string {
  const role = goal.currentAssignment?.role ?? goal.stage.role
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
