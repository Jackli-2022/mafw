export type ToolPartQueueResult = "queued" | "immediate" | "ignored"

export interface ToolPartScheduler {
  /** Queue a tool part snapshot; running snapshots coalesce by part id. */
  queue(part: any, sessionID?: string): ToolPartQueueResult
  /** Apply every pending snapshot now (turn end / unmount). */
  flush(): void
  hasPending(): boolean
}

/**
 * Keeps only the latest running snapshot per part id and applies the batch in
 * one callback. Terminal snapshots bypass the queue so a completed card never
 * waits for the next frame. Text deltas are intentionally not handled here.
 */
export function createToolPartScheduler(input: {
  schedule: (fn: () => void) => any
  cancel?: (handle: any) => void
  apply: (parts: any[]) => void
}): ToolPartScheduler {
  const pending = new Map<string, any>()
  let scheduled = false
  let handle: any

  const applyParts = (parts: any[]) => {
    if (parts.length > 0) input.apply(parts)
  }

  const flushPending = () => {
    if (pending.size === 0) return
    const parts = [...pending.values()]
    pending.clear()
    applyParts(parts)
  }

  const cancelScheduled = () => {
    if (!scheduled) return
    scheduled = false
    const current = handle
    handle = undefined
    input.cancel?.(current)
  }

  const scheduleFlush = () => {
    if (scheduled) return
    scheduled = true
    let ran = false
    handle = input.schedule(() => {
      ran = true
      scheduled = false
      handle = undefined
      flushPending()
    })
    if (ran) handle = undefined
  }

  return {
    queue(part: any, sessionID?: string) {
      if (!part || part.type !== "tool" || typeof part.id !== "string" || !part.id) return "ignored"
      const target = part.sessionID || !sessionID ? part : { ...part, sessionID }
      if (target.state?.status === "running") {
        pending.set(target.id, target)
        scheduleFlush()
        return "queued"
      }
      pending.delete(target.id)
      if (pending.size === 0) cancelScheduled()
      applyParts([target])
      return "immediate"
    },
    flush() {
      cancelScheduled()
      flushPending()
    },
    hasPending() {
      return pending.size > 0
    },
  }
}
