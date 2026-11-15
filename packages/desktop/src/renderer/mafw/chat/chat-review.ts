import type { PodReviewItem } from "@mafw/sdk"

/** The transcript only needs the actionable head of the review queue. */
export function visibleChatReviewItems(
  items: readonly PodReviewItem[],
  limit = 3,
): PodReviewItem[] {
  return items.filter((item) => item.status !== "resolved").slice(0, limit)
}

export function unresolvedReviewCount(items: readonly PodReviewItem[]): number {
  return items.reduce((count, item) => count + (item.status === "resolved" ? 0 : 1), 0)
}
