// SSE subagents 处理器：把既有 canonical 事件旁路给子代理 tracker（spec §4.3）。
//
// - session.created/updated/deleted 由 dispatcher 顶层分支经 mapSessionLifecycleEvent
//   转发（这些事件在 sid 分发前被 lifecycle 分支消费）；
// - turn 三元组经本 handler（EXTRA_HANDLERS 链尾）转发——**恒不消费**（return false：
//   chat-stream 已先行处理自己的部分，未知事件检查等尾部语义保持原样）。
//
// 零词汇表改动：全部消费既有事件类型；child 过滤在 reducer（parentID/childID）里做。
import type { SidHandler } from "../dispatcher"
import type { TrackerEvent } from "../../subagent-tracker"

/** 原始 session.* 事件 → TrackerEvent；非子代理相关（或形状不足）返回 null。 */
export function mapSessionLifecycleEvent(raw: any): TrackerEvent | null {
  const info = raw?.properties?.info
  if (raw?.type === "session.created") {
    if (!info?.id || !info.parentID) return null
    return {
      kind: "session-created",
      info: { id: info.id, parentID: info.parentID, title: typeof info.title === "string" ? info.title : undefined },
    }
  }
  if (raw?.type === "session.updated") {
    if (!info || typeof info.title !== "string") return null
    const sessionID = raw.properties?.sessionID || info.id
    if (!sessionID) return null
    return { kind: "session-updated", sessionID, title: info.title }
  }
  if (raw?.type === "session.deleted") {
    const sessionID = raw.sessionID || raw.properties?.sessionID || info?.id
    if (!sessionID) return null
    return { kind: "session-deleted", sessionID }
  }
  return null
}

/** turn.completed/failed/aborted → 子代理终态（sid 即子会话 id；reducer 按 childID 过滤）。 */
export const handleSubagentEvent: SidHandler = (event, sid, deps) => {
  if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.aborted") {
    deps.subagents.onEvent({
      kind: "turn-terminal",
      sessionID: sid,
      terminal: event.type.slice(5) as "completed" | "failed" | "aborted",
    })
  }
  return false
}
