import type { TurnEntry, ProcessStep } from './turn-transcript'

export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes} 分 ${String(rest).padStart(2, '0')} 秒`
}

/** Only the last segment may use the whole-turn fallback; earlier segments
 * would repeat the same duration and mislead. */
export function segmentFallbackDuration(isLast: boolean, turnDurationMs: number | undefined): number | undefined {
  return isLast ? turnDurationMs : undefined
}

/** Only the active segment opens by default while the turn is running. */
export function defaultSegmentOpen(working: boolean, isLast: boolean): boolean {
  return Boolean(working) && Boolean(isLast)
}

export function processSummary(segment: Extract<TurnEntry, { type: 'segment' }>): {
  tools: number
  thinking: number
  durationMs: number | null
} {
  let tools = 0
  let thinking = 0
  let start: number | null = null
  let end: number | null = null

  const noteTime = (time?: { start?: number; end?: number; created?: number; completed?: number }) => {
    const startAt = typeof time?.start === 'number' ? time.start : time?.created
    const endAt = typeof time?.end === 'number' ? time.end : time?.completed
    if (typeof startAt === 'number') start = start === null ? startAt : Math.min(start, startAt)
    if (typeof endAt === 'number') end = end === null ? endAt : Math.max(end, endAt)
  }

  for (const step of segment.process) {
    if (step.type === 'thinking') {
      thinking += step.parts.length
      for (const part of step.parts) noteTime(part.time)
    } else {
      tools += 1
      noteTime(step.part.state?.time)
    }
  }

  return {
    tools,
    thinking,
    durationMs: start !== null && end !== null && end >= start ? end - start : null,
  }
}

export function stepKey(step: ProcessStep): string {
  return step.type === 'thinking' ? step.key : step.key
}
