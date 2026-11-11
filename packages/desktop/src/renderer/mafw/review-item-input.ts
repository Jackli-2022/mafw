// Annotation drafts -> persistent Goal review items (Plan C).
// Keep only content/anchor fields: session, image payload, and scope metadata
// stay local.
import type { PodReviewItem, PodReviewItemInput, PodReviewAnchor } from "@mafw/sdk"
import type { Annotation } from "../../shared/annotation-types"

export function reviewInputsFromAnnotations(items: readonly Annotation[]): PodReviewItemInput[] {
  const inputs: PodReviewItemInput[] = []
  for (const item of items) {
    const comment = String(item?.comment ?? "").trim()
    const rel = String(item?.rel ?? "").trim()
    if (!comment || !rel) continue
    inputs.push({
      rel,
      startLine: item.startLine ?? null,
      endLine: item.endLine ?? null,
      code: item.code ?? "",
      comment,
      ...(item.anchor ? { anchor: item.anchor as PodReviewAnchor } : {}),
    })
  }
  return inputs
}

export function reviewItemPromptBlock(items: readonly PodReviewItem[]): string {
  if (items.length === 0) return ""
  const lines = items.map((item) => {
    const where = item.startLine == null
      ? item.rel
      : item.endLine == null || item.endLine === item.startLine
        ? `${item.rel}:L${item.startLine}`
        : `${item.rel}:L${item.startLine}-${item.endLine}`
    return `- ${item.id} · ${where} · ${item.comment}`
  })
  return [
    `已登记 ${items.length} 条评审项：`,
    ...lines,
    "请逐条处理后调用 mafw_pod_review_respond 回应；只有用户能把意见标为已解决。",
  ].join("\n")
}
