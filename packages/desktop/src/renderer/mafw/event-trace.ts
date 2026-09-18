/**
 * SSE 事件 trace 环 —— dev 事件检查器（EventInspector）的数据源。
 * MafwShell onmessage 每个分支调用 traceEvent 标记"谁消费了它"；
 * 尾部 miss 分支标记未被任何分支消费的未知事件。
 * 开销可忽略（单数组 unshift + 截断），生产环境默认隐藏入口。
 */

export interface TraceEntry {
  at: number
  type: string
  sessionID?: string
  branch: string
}

const CAP = 100
const ring: TraceEntry[] = []

export function traceEvent(event: { type?: string; sessionID?: string } | null, branch: string): void {
  ring.unshift({
    at: Date.now(),
    type: event?.type || "(unknown)",
    sessionID: event?.sessionID,
    branch,
  })
  if (ring.length > CAP) ring.length = CAP
}

export function getTrace(): TraceEntry[] {
  return [...ring]
}

export function clearTrace(): void {
  ring.length = 0
}
