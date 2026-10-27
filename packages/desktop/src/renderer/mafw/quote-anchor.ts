// 渲染预览划选 → quote 锚（spec 2026-10-27 预览批注 A1）：纯文本逻辑与 DOM 胶水分离。
import type { AnnotationAnchor } from "../../shared/annotation-types"

const MAX_QUOTE = 500

/** 跨行/多空白折叠为单空格（引用可读）。 */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/** 只保留引文本身（M3：context 无人消费，不再计算/存储）。 */
export function buildQuoteAnchor(selected: string): (AnnotationAnchor & { kind: "quote" }) | null {
  const quote = collapse(selected)
  if (!quote) return null
  return { kind: "quote", quote: quote.length > MAX_QUOTE ? quote.slice(0, MAX_QUOTE) : quote }
}
