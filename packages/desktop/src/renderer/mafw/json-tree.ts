// JSON 树视图纯逻辑（spec 2026-10-27 G8）。
export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string }

export function parseJsonSafe(text: string): JsonParseResult {
  if (!text.trim()) return { ok: false, error: "空内容" }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) }
  }
}

export function isJsonContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return typeof v === "object" && v !== null
}

/** 单行摘要：{n} / [n] / 原始值。 */
export function jsonSummary(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`
  if (v !== null && typeof v === "object") return `{${Object.keys(v as object).length}}`
  if (typeof v === "string") {
    const s = v.length > 40 ? `${v.slice(0, 40)}…` : v
    return JSON.stringify(s)
  }
  return String(v)
}

/** 渲染用条目（对象键序 / 数组索引）；超出 limit 截断并计数（防大对象打爆 DOM）。 */
export function jsonEntries(v: unknown, limit = 500): { items: [string, unknown][]; truncated: number } {
  let pairs: [string, unknown][]
  if (Array.isArray(v)) pairs = v.map((item, i) => [String(i), item])
  else if (v !== null && typeof v === "object") pairs = Object.entries(v as Record<string, unknown>)
  else return { items: [], truncated: 0 }
  return { items: pairs.slice(0, limit), truncated: Math.max(0, pairs.length - limit) }
}
