// Annotation drafts -> persistent Goal review items.
// Preserve immutable source provenance + the stable client ref used for
// idempotent retries; image payloads stay local to the annotation draft.
import type { PodReviewItem, PodReviewItemInput, PodReviewAnchor, PodReviewSource } from "@mafw/sdk"
import type { Annotation } from "../../shared/annotation-types"

export function annotationReviewSource(item: Annotation): PodReviewSource | undefined {
  if (!item.source) return undefined
  const root = String(item.root ?? "").trim()
  if (!root) return undefined
  const contentVersion = item.contentVersion ?? null
  if (item.source.kind === "project") {
    return { kind: "project", projectDir: item.source.projectDir, root, contentVersion }
  }
  return {
    kind: "goal",
    projectDir: item.source.projectDir,
    root,
    contentVersion,
    goalId: item.source.goalId,
    revision: item.source.revision,
  }
}

export function reviewInputsFromAnnotations(items: readonly Annotation[]): PodReviewItemInput[] {
  const inputs: PodReviewItemInput[] = []
  for (const item of items) {
    const comment = String(item?.comment ?? "").trim()
    const rel = String(item?.rel ?? "").trim()
    if (!comment || !rel) continue
    const source = annotationReviewSource(item)
    inputs.push({
      rel,
      startLine: item.startLine ?? null,
      endLine: item.endLine ?? null,
      code: item.code ?? "",
      comment,
      ...(item.anchor ? { anchor: item.anchor as PodReviewAnchor } : {}),
      ...(source ? { source } : {}),
      clientRef: item.id,
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
