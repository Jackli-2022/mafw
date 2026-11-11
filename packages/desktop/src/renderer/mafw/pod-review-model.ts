// User-facing review-item projection (Plan C). Server state is the truth; these
// helpers only order/label it and gate the human actions shown in the result view.
import type { PodReviewItem, PodReviewItemStatus } from "@mafw/sdk"

const STATUS_LABELS: Record<PodReviewItemStatus, string> = {
  pending: "待处理",
  responded: "已回应",
  resolved: "已解决",
}

export function reviewStatusLabel(status: PodReviewItemStatus): string {
  return STATUS_LABELS[status] ?? status
}

export function reviewCounts(items: readonly PodReviewItem[]): { unresolved: number; resolved: number } {
  let unresolved = 0
  let resolved = 0
  for (const item of items) {
    if (item.status === "resolved") resolved += 1
    else unresolved += 1
  }
  return { unresolved, resolved }
}

/** Unresolved first in their original order, resolved last; stable within each group. */
export function orderReviewItems(items: readonly PodReviewItem[]): PodReviewItem[] {
  const unresolved = items.filter((item) => item.status !== "resolved")
  const resolved = items.filter((item) => item.status === "resolved")
  return [...unresolved, ...resolved]
}

export function canResolveReviewItem(item: PodReviewItem): boolean {
  return item.status === "pending" || item.status === "responded"
}

export function canReopenReviewItem(item: PodReviewItem): boolean {
  return item.status === "responded" || item.status === "resolved"
}

export function reviewAcceptAction(input: {
  actionable: boolean
  unresolved: number
}):
  | { kind: "accept"; label: "验收并合并到主分支" }
  | { kind: "handle"; label: "先处理意见" } {
  if (input.unresolved > 0) return { kind: "handle", label: "先处理意见" }
  return { kind: "accept", label: "验收并合并到主分支" }
}

/** The forced path needs a real unresolved set and an explicit acknowledgement. */
export function forcedAcceptReady(input: { acknowledged: boolean; unresolved: number }): boolean {
  return input.acknowledged && input.unresolved > 0
}
