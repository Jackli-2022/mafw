// Explicit annotation -> Goal delegation. One action = one review-item batch
// against one Goal. Discussion is deliberately not this path.
import type { PodGoal, PodReviewItem, PodReviewItemInput } from "@mafw/sdk"
import type { Annotation } from "../../shared/annotation-types"
import { annotationSourceProblem } from "./annotation-source"
import { reviewInputsFromAnnotations, reviewItemPromptBlock } from "./review-item-input"

export type DelegationFollowUp =
  | { kind: "notify" }
  | { kind: "replan"; goalId: string }
  | { kind: "record-only" }
  | { kind: "rework"; goalId: string }
  | { kind: "blocked"; reason: string }

export interface DelegationResult {
  goalId: string | null
  revision: number | null
  items: PodReviewItem[]
  followUp: DelegationFollowUp | null
  error: string | null
}

function norm(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

/** User-facing outcome copy; record-only must not promise this result round. */
export function delegationToastLabel(followUp: DelegationFollowUp | null): string {
  switch (followUp?.kind) {
    case "rework":
      return "已写入评审项并请求按批注修改"
    case "replan":
      return "已写入评审项，当前计划将重新生成"
    case "record-only":
      return "已记录评审项，将在下一次计划/修改中处理"
    default:
      return "已交给 Tech Lead 处理"
  }
}

export function delegationFollowUp(
  goal: Pick<PodGoal, "goalId" | "status" | "stage" | "resultReady" | "accepted">,
): DelegationFollowUp {
  if (goal.accepted || goal.status === "done" || goal.status === "aborted") {
    return { kind: "blocked", reason: goal.accepted ? "Goal 已验收" : "Goal 已结束" }
  }
  if (goal.resultReady && goal.stage.kind !== "ended") {
    return { kind: "rework", goalId: goal.goalId }
  }
  switch (goal.stage.kind) {
    case "discussing":
      return { kind: "notify" }
    case "plan_approval":
      return { kind: "replan", goalId: goal.goalId }
    case "result_notified":
      return { kind: "rework", goalId: goal.goalId }
    case "queued":
      return { kind: "blocked", reason: "Goal 尚未开始，暂不能接收新意见" }
    case "ended":
      return { kind: "blocked", reason: "Goal 已结束" }
    case "direction_review":
    case "question":
    case "blocked":
    case "planning":
    case "probing":
    case "implementing":
    case "reviewing":
    case "working":
    case "waiting":
      return { kind: "record-only" }
    default:
      return { kind: "record-only" }
  }
}

export function validateDelegationTarget(input: {
  annotations: readonly Annotation[]
  projectDir: string
  target: { goalId: string; revision?: number; accepted?: boolean; ended?: boolean }
}): string | null {
  if (input.target.accepted) return "Goal 已验收，不能追加评审项"
  if (input.target.ended) return "Goal 已结束，不能追加评审项"
  for (const annotation of input.annotations) {
    const sourceProblem = annotationSourceProblem(annotation)
    if (sourceProblem) return sourceProblem
    const source = annotation.source!
    if (norm(source.projectDir) !== norm(input.projectDir)) {
      return "批注来源与目标项目不一致"
    }
    if (source.kind === "goal") {
      if (source.goalId !== input.target.goalId) {
        return `Goal ${source.goalId} 的批注只能交给所属 Goal，不能写入 Goal ${input.target.goalId}`
      }
      if (input.target.revision != null && source.revision !== input.target.revision) {
        return `批注来自 Goal revision ${source.revision}，不能直接写入 revision ${input.target.revision}；请先创建后续工作`
      }
    }
  }
  return null
}

export function canCreateNewGoal(annotations: readonly Annotation[]): boolean {
  return annotations.every((annotation) =>
    annotation.source?.kind === "project" && !annotationSourceProblem(annotation))
}

export function validateNewGoalSources(
  annotations: readonly Annotation[],
  projectDir: string,
): string | null {
  for (const annotation of annotations) {
    const problem = annotationSourceProblem(annotation)
    if (problem) return problem
    const source = annotation.source!
    if (source.kind === "goal") {
      return `Goal ${source.goalId} 的批注不能直接新建 Goal；请交给所属 Goal 或经 Lead 建立后续工作`
    }
    if (norm(source.projectDir) !== norm(projectDir)) {
      return "批注来源与目标项目不一致"
    }
  }
  return null
}

export function eligibleDelegationGoals(
  goals: readonly PodGoal[],
  annotations: readonly Annotation[],
): PodGoal[] {
  const sourceGoalIds = new Set(annotations.flatMap((annotation) =>
    annotation.source?.kind === "goal" ? [annotation.source.goalId] : []))
  return goals.filter((goal) => {
    if (goal.accepted || goal.status === "done" || goal.status === "aborted") return false
    if (goal.stage.kind === "ended") return false
    if (sourceGoalIds.size === 0) return true
    return sourceGoalIds.size === 1 && sourceGoalIds.has(goal.goalId)
  })
}

export function buildNewGoalDraft(annotations: readonly Annotation[]): {
  title: string
  objective: string
  acceptance: string[]
} {
  const lines = annotations.map((annotation) => {
    const where = annotation.startLine
      ? `${annotation.rel}:L${annotation.startLine}${annotation.endLine && annotation.endLine !== annotation.startLine ? `-${annotation.endLine}` : ""}`
      : annotation.rel
    return `- ${where}：${annotation.comment}`
  })
  return {
    title: `处理 ${annotations.length} 条批注`,
    objective: ["按以下批注完成修改并逐条回应：", ...lines].join("\n"),
    acceptance: [
      "每条批注对应的评审项均已回应",
      "未解决意见已由人确认解决，或明确接受剩余风险",
    ],
  }
}

export function reviewInputsForDelegation(annotations: readonly Annotation[]): PodReviewItemInput[] {
  return reviewInputsFromAnnotations(annotations)
}

export function targetVersionProblem(input: {
  sourceHash: string | null
  targetHash: string | null
  textAnchorAvailable: boolean
}): string | null {
  if (!input.sourceHash || !input.targetHash) return "来源或目标版本无法校验，请重新确认锚点"
  if (input.sourceHash === input.targetHash) return null
  if (input.textAnchorAvailable) return null
  return "目标 revision 的文件版本已变化，且无法用原文重新定位"
}

export async function delegateAnnotationBatch(input: {
  annotations: readonly Annotation[]
  projectDir: string
  target: { podId: string; goalId?: string; revision?: number; newGoal?: boolean }
  goal?: PodGoal | null
  followUpOverride?: DelegationFollowUp
  newGoalDraft?: {
    title: string
    objective: string
    acceptance: string[]
    boundaries?: string[]
    planReview?: "auto" | "manual"
  }
}, deps: {
  createGoal(input: {
    title: string
    objective: string
    acceptance: string[]
    boundaries?: string[]
    planReview?: "auto" | "manual"
  }): Promise<{ goalId: string; revision: number }>
  createReviewItems(target: { podId: string; goalId: string; revision: number }, body: {
    revision: number
    items: PodReviewItemInput[]
  }): Promise<{ items: PodReviewItem[] }>
  getPlan(goalId: string): Promise<{ planApproval?: { id?: string } }>
  rejectPlan(goalId: string, approvalId: string | undefined, feedback: string): Promise<unknown>
  sendTechLead(input: { podId: string; goalId: string; text: string }): Promise<unknown>
  rejectResult(podId: string, goalId: string, feedback: string): Promise<{ revision?: number }>
  verifyTarget?(target: { podId: string; goalId: string; revision: number }): Promise<string | null>
  markDelegated(pairs: ReadonlyArray<{ annotationID: string; reviewItemID: string }>): void
}): Promise<DelegationResult> {
  const target = { ...input.target }
  const annotations = input.annotations.filter((annotation) => !annotation.delegatedAt)
  if (annotations.length === 0) {
    return { goalId: target.goalId ?? null, revision: target.revision ?? null, items: [], followUp: null, error: "没有可委托的批注" }
  }
  let goalId = target.goalId ?? null
  let revision = target.revision ?? null
  let followUp: DelegationFollowUp | null = null

  if (target.newGoal) {
    const sourceProblem = validateNewGoalSources(annotations, input.projectDir)
    if (sourceProblem) {
      return { goalId: null, revision: null, items: [], followUp: null, error: sourceProblem }
    }
    try {
      const created = await deps.createGoal(input.newGoalDraft ?? buildNewGoalDraft(annotations))
      goalId = created.goalId
      revision = created.revision
      followUp = { kind: "notify" }
    } catch (err: any) {
      return { goalId: null, revision: null, items: [], followUp: null, error: String(err?.message ?? err) }
    }
  } else {
    if (!goalId || !revision) {
      return { goalId, revision, items: [], followUp: null, error: "请选择目标 Goal" }
    }
    if (input.goal) {
      const invalid = validateDelegationTarget({
        annotations,
        projectDir: input.projectDir,
        target: {
          goalId,
          revision,
          accepted: input.goal.accepted,
          ended: input.goal.stage.kind === "ended",
        },
      })
      if (invalid) return { goalId, revision, items: [], followUp: null, error: invalid }
      followUp = delegationFollowUp(input.goal)
      if (followUp.kind === "blocked") {
        return { goalId, revision, items: [], followUp, error: followUp.reason }
      }
    } else {
      followUp = input.followUpOverride ?? { kind: "notify" }
    }
  }

  const reviewTarget = { podId: target.podId, goalId: goalId!, revision: revision! }
  if (deps.verifyTarget) {
    const problem = await deps.verifyTarget(reviewTarget)
    if (problem) return { goalId, revision, items: [], followUp, error: problem }
  }
  let items: PodReviewItem[]
  try {
    const created = await deps.createReviewItems(reviewTarget, {
      revision: revision!,
      items: reviewInputsForDelegation(annotations),
    })
    items = created.items
  } catch (err: any) {
    return { goalId, revision, items: [], followUp, error: String(err?.message ?? err) }
  }

  try {
    if (followUp?.kind === "notify") {
      await deps.sendTechLead({
        podId: reviewTarget.podId,
        goalId: reviewTarget.goalId,
        text: reviewItemPromptBlock(items),
      })
    } else if (followUp?.kind === "replan") {
      const plan = await deps.getPlan(reviewTarget.goalId)
      await deps.rejectPlan(
        reviewTarget.goalId,
        plan?.planApproval?.id,
        `用户提交了 ${items.length} 条评审意见，请纳入本轮计划并逐条处理。`,
      )
    } else if (followUp?.kind === "rework") {
      await deps.rejectResult(
        reviewTarget.podId,
        reviewTarget.goalId,
        `用户提交了 ${items.length} 条评审意见，请按批注修改并逐条回应。`,
      )
    }
    // Map by the stable clientRef, never by position: the server may return
    // reused or reordered rows for a retried batch.
    const itemByRef = new Map<string, string>()
    for (const item of items) {
      if (item.clientRef) itemByRef.set(item.clientRef, item.id)
    }
    deps.markDelegated(annotations.flatMap((annotation, index) => {
      const reviewItemID = itemByRef.get(annotation.id) ?? items[index]?.id
      return reviewItemID ? [{ annotationID: annotation.id, reviewItemID }] : []
    }))
    return { goalId, revision, items, followUp, error: null }
  } catch (err: any) {
    return { goalId, revision, items, followUp, error: String(err?.message ?? err) }
  }
}
