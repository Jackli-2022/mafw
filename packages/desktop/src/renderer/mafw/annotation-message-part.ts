// A discussion message carries a hidden synthetic part with the annotation IDs.
// The part is stored with history, so the message can later offer "process these
// annotations" without copying text or depending on the originating tab.
export const ANNOTATION_REF_PREFIX = "mafw.annotations.v1:"

export function annotationRefPart(ids: readonly string[]): {
  id: string
  type: "text"
  text: string
  synthetic: true
} {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))]
  const digest = unique.join(",").slice(0, 48).replace(/[^A-Za-z0-9_-]/g, "_")
  return {
    id: `prt_annotations_${digest || "none"}`,
    type: "text",
    text: `${ANNOTATION_REF_PREFIX}${JSON.stringify(unique)}`,
    synthetic: true,
  }
}

export function parseAnnotationRefPart(part: unknown): string[] {
  if (!part || typeof part !== "object") return []
  const value = part as { type?: unknown; text?: unknown }
  if (value.type !== "text" || typeof value.text !== "string") return []
  if (!value.text.startsWith(ANNOTATION_REF_PREFIX)) return []
  try {
    const parsed = JSON.parse(value.text.slice(ANNOTATION_REF_PREFIX.length))
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))]
  } catch {
    return []
  }
}

export function annotationIDsForParts(parts: readonly unknown[]): string[] {
  return [...new Set(parts.flatMap(parseAnnotationRefPart))]
}
