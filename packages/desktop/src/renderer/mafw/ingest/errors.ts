// 摄取层：wire 错误形状 → MAFW 规范错误（{kind,message}）。
//
// 为什么在 desktop 而不是 session-ui：渲染层只读规范形（Task 9 已把
// session-ui 的 error 守卫收敛到 `{kind,message}`），各客户端（desktop/TUI/
// mobile）在摄取自己的 wire 历史/SSE 时完成映射。gateway 的 flat 出口已经产出
// 规范 error；这里兜住旧 wire（`{name,data:{message}}` / `{type,message}` /
// 字符串）与 pi 的原生错误文本，保证「绝不渲染空错误卡」。
import type { MafwMessageError } from "@mafw/sdk"

export type CanonicalMessageError = MafwMessageError

function classify(text: string): string {
  const t = text.toLowerCase()
  if (t.includes("abort") || t.includes("interrupt") || t.includes("cancel")) return "abort"
  if ((t.includes("rate") && t.includes("limit")) || t.includes("429")) return "rate-limit"
  if (
    t.includes("auth") ||
    t.includes("api key") ||
    t.includes("apikey") ||
    t.includes("provider") ||
    t.includes("unauthor") ||
    t.includes("forbidden") ||
    t.includes("403")
  ) {
    return "provider"
  }
  return "unknown"
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** 任意 wire/规范错误 → 规范错误；无有效内容时 undefined（不造空卡）。 */
export function canonicalMessageError(value: unknown): MafwMessageError | undefined {
  if (!value) return undefined
  if (typeof value === "string") {
    const message = value.trim()
    return message ? { kind: classify(message), message } : undefined
  }
  if (typeof value !== "object") return undefined
  const raw = value as Record<string, any>
  const message =
    textOf(raw.message) ||
    textOf(raw.data?.message) ||
    textOf(raw.data?.error) ||
    textOf(raw.error?.message) ||
    textOf(raw.text)
  // 已是规范形状：kind 是唯一判别字段；缺失 message 时回退 kind（恒非空）。
  if (typeof raw.kind === "string" && raw.kind) {
    return { kind: raw.kind, message: message || raw.kind }
  }
  const name = textOf(raw.name) || textOf(raw.type)
  if (!name && !message) return undefined
  const kind = classify(`${name} ${message}`)
  return { kind, message: message || name || kind }
}

/** 中止判定（规范形）：错误卡/分隔条只认 kind === 'abort'。 */
export function isAbortError(value: unknown): boolean {
  return canonicalMessageError(value)?.kind === "abort"
}
