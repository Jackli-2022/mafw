// 评审项的 rail badge / 项目索引计数：只读 attention 投影。
import type { AttentionItem } from "@mafw/sdk"

export function countReviewAttention(
  items: readonly AttentionItem[],
  goalId?: string | null,
): number {
  const seen = new Set<string>()
  let count = 0
  for (const item of items) {
    if (item.kind !== "review_item") continue
    if (goalId && item.goalId !== goalId) continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    count += 1
  }
  return count
}

export function reviewActionsVisible(accepted: boolean): boolean {
  return !accepted
}
