// SSE background 处理器：把既有事件旁路给后台任务 tracker（spec §5）。
//
// 恒不消费（return false）：part.updated/turn.* 本就不被其他 handler 消费；
// message.updated 会被 chat-stream 提前消费（synthetic 消息在它那里被静默
// 丢弃——既有行为），因此本 handler 必须排在 chat-stream 之前先观察。
import type { SidHandler } from "../dispatcher"
import { detectBackgroundPart, detectSyntheticTerminal } from "../../background-detect"

export const handleBackgroundEvent: SidHandler = (event, sid, deps) => {
  if (event.type === "part.updated") {
    const part = event.payload?.part || event.properties?.part
    const ev = part ? detectBackgroundPart(part, sid) : null
    if (ev) deps.background.onEvent(ev)
    return false
  }
  if (event.type === "message.updated") {
    const info = event.properties?.info
    const ev = info ? detectSyntheticTerminal(info, sid) : null
    if (ev) deps.background.onEvent(ev)
    return false
  }
  if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.aborted") {
    deps.background.onEvent({
      kind: "bg-terminal",
      id: sid,
      terminal: event.type === "turn.completed" ? "completed" : event.type === "turn.failed" ? "failed" : "cancelled",
      source: "turn",
    })
  }
  return false
}
