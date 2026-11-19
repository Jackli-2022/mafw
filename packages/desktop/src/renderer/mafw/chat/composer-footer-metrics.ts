// Pure metrics for the composer footer. Kept outside ChatPane so the
// arithmetic (and the "skip skeleton messages" rule) is regression-testable.

export interface FooterMessageLike {
  role?: string
  tokens?: { output?: number } | null
  time?: { created?: number; completed?: number } | null
}

/** A turn shorter than this is a skeleton/tool-only frame, not a generation. */
const MIN_TURN_MS = 50

/** Prompt-cache reads as a share of the whole prompt (input + cache read). */
export function cacheHitPercent(input: number, cacheRead: number): number | null {
  const base = (input || 0) + (cacheRead || 0)
  if (!(base > 0)) return null
  return Math.round(((cacheRead || 0) / base) * 1000) / 10
}

export function tokensPerSecond(output: number, durationMs: number): number | null {
  if (!(output > 0) || !(durationMs >= MIN_TURN_MS)) return null
  return Math.round(output / (durationMs / 1000))
}

/**
 * Output speed of the most recent completed turn. Walks backwards because the
 * live turn's assistant skeleton has no `time.completed` yet.
 */
export function lastTurnTokensPerSecond(
  messages: readonly FooterMessageLike[] | null | undefined,
): number | null {
  if (!messages?.length) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== "assistant" || !m.tokens) continue
    const created = m.time?.created
    const completed = m.time?.completed
    if (typeof created !== "number" || typeof completed !== "number") continue
    const speed = tokensPerSecond(m.tokens.output || 0, completed - created)
    if (speed !== null) return speed
  }
  return null
}
