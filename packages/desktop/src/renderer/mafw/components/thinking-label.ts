export function thinkingLabel(opts: { streaming: boolean; durationSec: number | null }): string {
  if (opts.streaming) return "思考中…"
  if (opts.durationSec == null) return "已思考"
  return `已思考 ${opts.durationSec}s`
}

export function thinkingDurationSec(
  time: { start?: number; end?: number } | undefined,
  now: number = Date.now(),
): number | null {
  if (!time || typeof time.start !== "number") return null
  const end = typeof time.end === "number" ? time.end : now
  return Math.max(1, Math.round((end - time.start) / 1000))
}

/**
 * reasoning part 的流式判定（防御层）：
 * 1. message 级完成信号（time.completed）优先；
 * 2. message 数据形状缺失该字段时（live SSE 首帧），回退看 part 自身 time.end；
 * 3. 两者皆缺才视为流式中。
 */
export function reasoningStreaming(
  message: { role?: string; time?: { completed?: number } } | undefined,
  partTime: { start?: number; end?: number } | undefined,
): boolean {
  if (!message || message.role !== "assistant") return false
  if (typeof message.time?.completed === "number") return false
  if (partTime && typeof partTime.end === "number") return false
  return true
}
