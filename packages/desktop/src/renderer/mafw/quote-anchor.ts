// 渲染预览划选 → quote 锚（spec 2026-10-27 预览批注 A1）：纯文本逻辑与 DOM 胶水分离。
import type { AnnotationAnchor } from "../../shared/annotation-types"

const MAX_QUOTE = 500
const CONTEXT = 60

/** 跨行/多空白折叠为单空格（引用可读）。 */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/**
 * @param containerText 预览容器纯文本（selection 所在容器）
 * @param selected 用户选中文本
 */
export function buildQuoteAnchor(containerText: string, selected: string): (AnnotationAnchor & { kind: "quote" }) | null {
  const quote = collapse(selected)
  if (!quote) return null
  const trimmed = quote.length > MAX_QUOTE ? quote.slice(0, MAX_QUOTE) : quote
  const idx = containerText.indexOf(trimmed)
  if (idx < 0) return { kind: "quote", quote: trimmed }
  const context = containerText.slice(Math.max(0, idx - CONTEXT), idx + trimmed.length + CONTEXT)
  return { kind: "quote", quote: trimmed, context }
}
