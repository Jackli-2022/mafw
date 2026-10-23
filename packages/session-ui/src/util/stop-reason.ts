export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "tool_use"
  | "refusal"
  | "cancelled"
  | "error"
  | "unknown"

const LABELS: Record<StopReason, string> = {
  end_turn: "",
  max_tokens: "达到输出上限",
  tool_use: "",
  refusal: "内容被过滤",
  cancelled: "已停止",
  error: "回合出错",
  unknown: "",
}

/** 原始 finish（stop/length/...）或 canonical 值 → canonical StopReason。 */
export function normalizeStopReason(value?: string | null): StopReason {
  switch (value) {
    case "stop": return "end_turn"
    case "length": return "max_tokens"
    case "tool-calls": return "tool_use"
    case "content-filter": return "refusal"
    case "interrupted": return "cancelled"
    case "end_turn":
    case "max_tokens":
    case "tool_use":
    case "refusal":
    case "cancelled":
    case "error":
    case "unknown":
      return value
    default:
      return "unknown"
  }
}

export function stopReasonLabel(value?: string | null): string {
  return LABELS[normalizeStopReason(value)]
}

/** 只给用户看“非正常结束”的提示；end_turn/tool_use/unknown 静默。 */
export function isAbnormalStop(value?: string | null): boolean {
  const reason = normalizeStopReason(value)
  return reason === "max_tokens" || reason === "refusal" || reason === "cancelled" || reason === "error"
}
