// SSE dock 处理器：TrajectoryDock 实时事件 / TaskList todos。
// 分支语义逐字迁移自 MafwShell.tsx onmessage（commit 13ad8348 行 1433-1458）；
// trajectory 去重 + 滚动窗口收敛为纯函数 mergeTrajectoryEvent。
import type { SidHandler, ShellEventDeps } from "../dispatcher"

export interface DockDeps {
  trace(event: { type?: string }, channel: string): void
  /** 当前会话已缓存的 live 事件（原 trajectoryLive()[sid] || []）。 */
  getTrajectoryEvents(sid: string): unknown[]
  setTrajectoryEvents(sid: string, events: unknown[]): void
  setTrajectoryTurn(sid: string, turn: unknown): void
  setTodos(sid: string, todos: unknown[]): void
}

/** 重复（turnID/turn_id + seq 字符串化比对）返回 null；否则追加并保持 200 滚动窗口。 */
export function mergeTrajectoryEvent(
  prev: unknown[],
  props: { turnID?: unknown; turn_id?: unknown; seq?: unknown },
): unknown[] | null {
  const dup = prev.some((e: any) =>
    String(e.turnID ?? e.turn_id ?? 0) === String(props.turnID ?? props.turn_id ?? 0)
    && String(e.seq ?? 0) === String(props.seq ?? 0))
  if (dup) return null
  // 滚动窗口：长会话 liveEvents 无限增长会让 displayedEvents 每事件全量 merge+sort
  return [...prev, props].slice(-200)
}

export const handleDockEvent: SidHandler = (event, sid, deps) => {
  const d = deps.dock
  if (event.type === "trajectory.event") {
    d.trace(event, "dock:trajectory")
    const props = event.properties || {}
    const merged = mergeTrajectoryEvent(d.getTrajectoryEvents(sid), props)
    if (merged) d.setTrajectoryEvents(sid, merged)
    return true
  }
  if (event.type === "trajectory.turn") {
    d.trace(event, "dock:trajectory-turn")
    d.setTrajectoryTurn(sid, event.properties || {})
    return true
  }
  if (event.type === "todo.updated") {
    d.trace(event, "dock:todos")
    const list = event.properties?.todos
    if (Array.isArray(list)) d.setTodos(sid, list)
    return true
  }
  return false
}
