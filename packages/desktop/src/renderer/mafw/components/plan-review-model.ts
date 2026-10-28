// packages/desktop/src/renderer/mafw/components/plan-review-model.ts
// W1 计划审阅视图模型（纯函数）：GET /api/goals/:id/plan 响应 → 徽标/动作条/空态。
export interface PlanApproval {
  status: "pending" | "approved" | "rejected"
  feedback?: string
  decidedAt?: string
  round: number
}

export interface PlanReviewInfo {
  planReview?: "auto" | "manual"
  planApproval?: PlanApproval | null
  waves?: unknown
  terminal?: boolean
}

export interface PlanReviewViewModel {
  status: "pending" | "approved" | "rejected" | "auto"
  showActions: boolean
  badge: string
  empty: boolean
}

export function planReviewViewModel(info: PlanReviewInfo): PlanReviewViewModel {
  const mode = info.planReview ?? "auto"
  const approval = info.planApproval ?? null
  const status: PlanReviewViewModel["status"] =
    mode === "manual" && approval ? approval.status : "auto"
  // 动作条只在 manual+pending+非终态出现（终态防线：已取消 goal 不给批准入口）。
  const showActions = mode === "manual" && approval?.status === "pending" && info.terminal !== true
  const badge =
    status === "pending" ? "待批准"
    : status === "approved" ? "已批准"
    : status === "rejected" ? "已驳回"
    : "自动模式"
  const empty = !info.waves || (typeof info.waves === "object" && !("waves" in (info.waves as object)) && !("ambiguities" in (info.waves as object)))
  return { status, showActions, badge, empty }
}
