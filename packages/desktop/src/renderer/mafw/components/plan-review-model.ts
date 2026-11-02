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
  /** Task 13/20：Goal Eval 与版本绑定（缺省 = 旧 gateway，只渲染 waves）。 */
  goalEval?: unknown
  planHash?: string | null
  evalHash?: string | null
  revision?: number | null
  /** 批准后计划内容被改写：旧批准已失效。 */
  stale?: boolean
  terminal?: boolean
}

export interface PlanReviewViewModel {
  status: "pending" | "approved" | "rejected" | "auto"
  showActions: boolean
  badge: string
  empty: boolean
  stale: boolean
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
  const waves = info.waves
  const hasWaves = !!waves
    && typeof waves === "object"
    && ("waves" in (waves as object) || "ambiguities" in (waves as object))
  // Task 20：Goal Eval 是一等产物——只有 eval、还没 waves 时不能算空计划。
  const hasEval = !!info.goalEval && typeof info.goalEval === "object"
  const empty = !hasWaves && !hasEval
  return { status, showActions, badge, empty, stale: info.stale === true }
}

// ── W1 Task 4：批注草稿（引文 + 意见）→ 驳回反馈打包 ──────────────────────

export interface PlanAnnotationDraft {
  quote: string
  comment: string
}

/** 引文截断（引文是给人看的锚点，不是全文引用）。 */
const QUOTE_CAP = 200

/**
 * 驳回反馈组装：批注草稿在前（逐条 `> 引文` + 意见）、freeText 在后。
 * 全空 → ''（调用方以此禁用驳回按钮）。
 */
export function buildRejectFeedback(drafts: PlanAnnotationDraft[], freeText: string): string {
  const parts: string[] = []
  for (const d of drafts) {
    const quote = d.quote.trim().slice(0, QUOTE_CAP)
    const comment = d.comment.trim()
    if (!quote && !comment) continue
    const lines: string[] = []
    if (quote) for (const l of quote.split("\n")) lines.push(`> ${l}`)
    if (comment) lines.push(`意见：${comment}`)
    parts.push(lines.join("\n"))
  }
  const tail = freeText.trim()
  if (tail) parts.push(tail)
  return parts.join("\n\n")
}
