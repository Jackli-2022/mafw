import type { PodGoalResult, PodGoalResultWorktree } from "@mafw/sdk"

export interface PodResultAcceptanceView {
  actionable: boolean
  label: string
  tone: "success" | "failure" | "neutral"
}

const FAILED_VERDICTS = new Set(["FAIL", "MAX_RETRIES", "ERROR", "CANCELLED"])

function isFailure(result: PodGoalResult): boolean {
  return Boolean(result.failure) || FAILED_VERDICTS.has(String(result.verdict ?? ""))
}

/**
 * 结果页顶部的验收结论（单一来源，组件只负责渲染）：
 * - 失败结果永远不可验收，文案必须自证「失败」而不是含糊的「不可用」；
 * - 只有服务端明确的 `acceptance: "pending"` 且 worktree 仍 active 才给出按钮；
 * - 已合并显示既成事实，不再提供动作。
 */
export function podResultAcceptanceView(result: PodGoalResult): PodResultAcceptanceView {
  const worktree = result.worktree ?? null
  const accepted = result.acceptance === "accepted" || worktree?.status === "merged"
  if (accepted) {
    return { actionable: false, label: "已验收并合并", tone: "success" }
  }
  if (isFailure(result)) {
    return { actionable: false, label: "失败 · 不可验收", tone: "failure" }
  }
  const pending =
    result.acceptance === "pending"
    && result.resultReady
    && worktree?.status === "active"
    && (result.verdict === "PASS" || result.verdict === null)
  if (pending) {
    return { actionable: true, label: "验收并合并到主分支", tone: "success" }
  }
  return { actionable: false, label: "不可验收", tone: "neutral" }
}

export interface PodResultWorktreeRow {
  label: string
  value: string
  tone?: "warning" | "danger"
}

const WORKTREE_STATUS_LABEL: Record<PodGoalResultWorktree["status"], string> = {
  active: "待验收",
  merged: "已合并",
  abandoned: "已放弃",
  missing: "缺失",
}

/**
 * 代码结果卡（分支/目标/状态/提交）。legacy Goal 没有 worktree 时不编造，
 * 直接不渲染这一块。
 */
export function podResultWorktreeRows(result: PodGoalResult): PodResultWorktreeRow[] {
  const worktree = result.worktree ?? null
  if (!worktree) return []
  const activeLabel = podResultAcceptanceView(result).tone === "failure" ? "未合并" : "待验收"
  const rows: PodResultWorktreeRow[] = [
    { label: "分支", value: worktree.branch },
    { label: "合并到", value: worktree.baseBranch || "未知" },
    {
      label: "状态",
      value: worktree.status === "active"
        ? activeLabel
        : worktree.status in WORKTREE_STATUS_LABEL
          ? WORKTREE_STATUS_LABEL[worktree.status]
          : worktree.status,
      ...(worktree.status === "missing"
        ? { tone: "danger" as const }
        : worktree.status === "abandoned"
          ? { tone: "warning" as const }
          : {}),
    },
  ]
  if (worktree.status === "merged" && worktree.mergeCommit) {
    rows.push({ label: "合并提交", value: worktree.mergeCommit.slice(0, 7) })
  }
  return rows
}

export interface PodResultConditionRow {
  id: string
  statement: string
  required: boolean
  result: string
  evidence: string
}

const CONDITION_RESULT_LABEL: Record<string, string> = {
  pass: "通过",
  fail: "失败",
  skipped: "跳过",
}

/**
 * Goal Eval 条件与逐条件结果按 id 配对：
 * - 缺结果的条件是「未判定」，绝不能默认算通过；
 * - 结果里出现 Eval 未声明的 id 也要显形（追加在末尾），不静默吞掉证据；
 * - 同 id 重复结果取第一条（服务端判定是权威，UI 不重新裁决）。
 */
export function podResultConditionRows(result: PodGoalResult): PodResultConditionRow[] {
  const conditions = Array.isArray(result.goalConditions) ? result.goalConditions : []
  const results = Array.isArray(result.goalResults) ? result.goalResults : []
  const byId = new Map<string, { result: string; evidence: string }>()
  for (const item of results) {
    // Gateway shape is `{ conditionId, result, evidence }` (review-rubric.ts);
    // keep `id` as a compatibility alias for older fixtures/clients.
    const conditionId = typeof (item as any)?.conditionId === "string"
      ? (item as any).conditionId
      : (item as any)?.id
    if (typeof conditionId !== "string" || !conditionId || byId.has(conditionId)) continue
    byId.set(conditionId, {
      result: CONDITION_RESULT_LABEL[item.result] ?? "未判定",
      evidence: String(item.evidence ?? ""),
    })
  }
  const rows: PodResultConditionRow[] = conditions.map((condition) => {
    const hit = byId.get(condition.id)
    if (hit) byId.delete(condition.id)
    return {
      id: condition.id,
      statement: condition.statement,
      required: condition.required === true,
      result: hit?.result ?? "未判定",
      evidence: hit?.evidence ?? "",
    }
  })
  for (const [id, hit] of byId) {
    rows.push({
      id,
      statement: "未在 Goal Eval 中声明的条件",
      required: false,
      result: hit.result,
      evidence: hit.evidence,
    })
  }
  return rows
}
