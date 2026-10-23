import type { SidHandler } from "../dispatcher"

/**
 * Batch 0：2.1 的 session.inbox.* 映射为 canonical queue.updated。
 * 这里只消费并留 trace，避免 dispatcher 尾部报 unhandled；队列 UI 在 Batch 5。
 */
export const handleQueueEvent: SidHandler = (event, _sid, deps) => {
  if (event.type !== "queue.updated") return false
  deps.core.trace(event, "chat:queue")
  return true
}
