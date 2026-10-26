import type { SidHandler } from "../dispatcher"

/**
 * Batch 0：2.1 的 session.inbox.* 映射为 canonical queue.updated。
 * Batch 5：交给 queue-store 渲染；这里只做分发 + trace。
 */
export const handleQueueEvent: SidHandler = (event, sid, deps) => {
  if (event.type !== "queue.updated") return false
  deps.queue.onEvent(sid, event)
  deps.core.trace(event, "chat:queue")
  return true
}
