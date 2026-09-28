// approval-summary：把一回合内的多张审批卡汇总成一行摘要（v6 追加需求）。
// 只做文案/计数，不改卡片组件与交互逻辑。
export type ApprovalCardLike = { kind?: string; data?: { status?: string } }

export type ApprovalSummary = {
  /** 汇总文案（含 🛡 前缀），如 "🛡 1 项待批准 · 已处理 2" */
  text: string
  pending: number
  approved: number
  denied: number
  total: number
  /** 有 pending 时默认展开（操作点） */
  hasPending: boolean
}

export function summarizeApprovals(cards: ApprovalCardLike[] | null | undefined): ApprovalSummary | null {
  const perms = (cards ?? []).filter(c => c?.kind === "permission")
  if (perms.length === 0) return null
  let pending = 0, approved = 0, denied = 0
  for (const c of perms) {
    const s = c?.data?.status
    if (s === "pending") pending++
    else if (s === "allowed-once" || s === "allowed-always") approved++
    else denied++ // denied / expired / 未知一律计为已处理（拒绝侧）
  }
  const resolved = approved + denied
  const parts: string[] = []
  if (pending > 0) parts.push(`${pending} 项待批准`)
  if (approved > 0) parts.push(`已批准 ×${approved}`)
  if (denied > 0) parts.push(`已拒绝 ×${denied}`)
  const text = `🛡 ${parts.join(" · ")}`
  return { text, pending, approved, denied, total: perms.length, hasPending: pending > 0 }
}
