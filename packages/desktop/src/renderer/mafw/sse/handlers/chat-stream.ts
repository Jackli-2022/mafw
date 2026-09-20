// SSE chat-stream 处理器：消息流主链（message.updated / part.delta /
// part.updated / complete / idle / error / session.next.tool.*）。
// 分支语义逐字迁移自 MafwShell.tsx onmessage（commit 13ad8348 行 1460-1527）。
//
// 消费语义（精确保留原落穿行为）：
// - message.updated / message.part.delta 原分支提前 return → 消费（true），
//   后续 handler（media_speak）不跑；
// - 流式主链与 session.next.tool.* 原本不 return、继续落到 media_speak
//   检查 → 做完副作用后返回 false（未消费），链继续。
import {
  applyUserMessageArrival, applyAssistantMessage, applyPartDelta,
  applyPartUpsert, ensureAssistantMessage, extractMediaSpeak,
} from "../chat-reducers"
import type { SidHandler, ShellEventDeps } from "../dispatcher"

export interface ChatDeps {
  trace(event: { type?: string }, channel: string): void
  /** 读取当前 store（reducer 输入 + media_speak 兜底）。 */
  getStore(): { message: Record<string, any[]>; part: Record<string, any[]>; session_status: Record<string, any> }
  /** reducer 输出写回。 */
  patchStore(patch: { message?: Record<string, any[]>; part?: Record<string, any[]> }): void
  setSessionStatus(sid: string, status: { type: "busy" | "idle" }): void
  markSessionDone(sid: string): void
  setUserMsgId(sid: string, msgId: string): void
  parentFallback(sid: string): string | null
  phase(sid: string, p: "writing"): void
  /** 回合收束：sendingResetters + queueFlushers（+ 可选卡片过期）。 */
  onTurnSettled(sid: string, opts: { expireCards: boolean }): void
  /** session.idle 隐藏页通知（60s 节流 + document.hidden 封装在 shell 侧）。 */
  notifyIdle(sid: string): void
  mediaSpeak(sid: string, text: string, voice?: string): void
}

export const handleChatStreamEvent: SidHandler = (event, sid, deps) => {
  const d = deps.chat
  if (event.type === "message.updated") {
    d.trace(event, "chat:message")
    const info = event.properties?.info
    if (!info?.id || !info?.role) return true
    const msgId = info.id
    if (info.role === "user") {
      // Replace the optimistic user message (id `user-...`) with the real
      // opencode message id so the turn anchor matches assistant parentIDs
      // and part messageIDs.
      const out = applyUserMessageArrival(d.getStore(), sid, info)
      if (out) d.patchStore(out)
      d.setUserMsgId(sid, msgId)
    } else if (info.role === "assistant") {
      const out = applyAssistantMessage(d.getStore(), sid, info, d.parentFallback(sid))
      if (out) d.patchStore(out)
    }
    return true
  }
  // opencode ≥1.18 streams assistant text via message.part.delta
  // ({partID, field: "text", delta}); accumulate it into the part record so
  // the reply renders incrementally (message.part.updated only fires once).
  if (event.type === "message.part.delta") {
    d.trace(event, "chat:delta")
    const props = event.properties || {}
    const msgId = props.messageID
    const partID = props.partID
    if (!msgId || !partID || props.field !== "text") return true
    const delta = props.delta
    if (!delta) return true
    d.phase(sid, "writing")
    const out = applyPartDelta(d.getStore(), sid, msgId, partID, delta)
    if (out) d.patchStore(out)
    return true
  }

  // 流式主链：part 更新 / complete / idle / error 共用一段（不消费，落穿 media_speak）
  const CHAIN_TYPES = new Set(["message.part.updated", "message.complete", "message.part.complete", "session.idle", "session.error", "message.error", "message.aborted"])
  const isNextTool = typeof event.type === "string" && event.type.startsWith("session.next.tool.")
  if (!CHAIN_TYPES.has(event.type) && !isNextTool) return false
  d.trace(event, "chat:stream")

  if (event.type === "message.part.updated") {
    const part = event.payload?.part || event.properties?.part
    if (part && part.messageID) {
      d.phase(sid, "writing")
      d.setSessionStatus(sid, { type: "busy" })
      d.patchStore(applyPartUpsert(d.getStore(), sid, part))
    }
  } else if (event.type === "message.complete") {
    d.setSessionStatus(sid, { type: "idle" })
    d.markSessionDone(sid)
    d.onTurnSettled(sid, { expireCards: true })
  } else if (event.type === "message.part.complete") {
    d.setSessionStatus(sid, { type: "idle" })
    d.markSessionDone(sid)
    d.onTurnSettled(sid, { expireCards: false })
  } else if (event.type === "session.idle") {
    // Defensive fallback: the gateway rewrites session.idle into
    // message.complete before broadcasting (index.ts broadcast facet), so
    // this branch is unreachable in Mode A — it only guards against
    // future/direct senders. Without it the sending flag would never reset.
    d.setSessionStatus(sid, { type: "idle" })
    d.markSessionDone(sid)
    d.onTurnSettled(sid, { expireCards: true })
    d.notifyIdle(sid)
  } else if (event.type === "session.error" || event.type === "message.error" || event.type === "message.aborted") {
    d.setSessionStatus(sid, { type: "idle" })
    d.onTurnSettled(sid, { expireCards: true })
  }

  if (isNextTool && event.assistantMessageID) {
    const out = ensureAssistantMessage(d.getStore(), sid, event.assistantMessageID, d.parentFallback(sid))
    if (out) d.patchStore(out)
  }
  return false
}

/** mafw_media_speak 工具事件 → 流式 TTS 播放。永不消费（只触发副作用，
 *  原语义：所有落到 onmessage 尾部的事件都检查 toolName）。 */
export const handleMediaSpeakEvent: SidHandler = (event, sid, deps) => {
  const d = deps.chat
  const toolName = event.properties?.tool || event.properties?.info?.tool || event.info?.tool || (event.properties?.part as any)?.tool
  if (toolName !== "mafw_media_speak") return false
  const speak = extractMediaSpeak(event, d.getStore().part)
  if (speak) d.mediaSpeak(sid, speak.text, speak.voice)
  return false
}
