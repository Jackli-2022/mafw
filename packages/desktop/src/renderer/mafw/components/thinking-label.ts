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
