// Pure provenance helpers for annotation drafts. They answer whether a draft
// can be delegated and whether its captured anchor still exists in a file;
// they never choose a recipient or Goal.
import type { Annotation } from "../../shared/annotation-types"

/** Fast deterministic fingerprint (`djb2:length`) for clean editor buffers. */
export function textFingerprint(content: string): string {
  let hash = 5381
  for (let index = 0; index < content.length; index++) {
    hash = ((hash << 5) + hash + content.charCodeAt(index)) | 0
  }
  return `${(hash >>> 0).toString(16)}:${content.length}`
}

export function annotationSourceProblem(annotation: Annotation): string | null {
  if (!annotation.source) return "批注缺少来源作用域，请重新在文件中添加"
  if (annotation.capturedDirty) return "批注创建于未保存内容；请先保存文件并重新添加批注"
  return null
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n")
}

/** True only when the captured quote/code occurs exactly once in the target file. */
export function anchorOccursIn(content: string, annotation: Annotation): boolean {
  const fromAnchor = annotation.anchor?.kind === "quote" ? annotation.anchor.quote : ""
  const needle = normalizeText(String(fromAnchor || annotation.code || "").trim())
  if (!needle) return false
  const haystack = normalizeText(content)
  const first = haystack.indexOf(needle)
  if (first < 0) return false
  return haystack.indexOf(needle, first + 1) < 0
}
