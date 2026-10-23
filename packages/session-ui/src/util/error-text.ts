/**
 * 错误值 → 可展示文本。
 *
 * 各 runtime 的 tool/message error 形状不一致：opencode v1 是字符串，
 * opencode 2.1 是 {type, message} 对象，pi 可能是 {message} 或任意值。
 * 渲染层统一经此归一，避免 `error().replace is not a function`。
 */
export function errorText(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  if (typeof value === "object") {
    const v = value as { message?: unknown; data?: { message?: unknown }; type?: unknown }
    const msg = v.message ?? v.data?.message
    if (typeof msg === "string") return msg
    if (msg !== undefined && msg !== null) return String(msg)
    if (typeof v.type === "string") return v.type
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
