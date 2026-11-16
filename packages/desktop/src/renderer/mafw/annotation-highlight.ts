// 源码编辑器行高亮（ADE 三态里的 pending / held）：预览锚点不参与，只用行号锚。
import type { Annotation } from "../../shared/annotation-types"

export type AnnotationLineStatus = "pending" | "held"

export type AnnotationLineHighlight = {
  startLine: number
  endLine: number
  status: AnnotationLineStatus
}

export function lineHighlightsFor(items: readonly Annotation[]): AnnotationLineHighlight[] {
  return items
    .filter((a) => !a.anchor)
    .map((a) => ({
      startLine: Math.max(1, a.startLine),
      endLine: Math.max(Math.max(1, a.startLine), a.endLine),
      status: a.held ? "held" : "pending",
    }))
}
