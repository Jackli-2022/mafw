// Flow card 归位纯函数模块（逐字迁移自 ChatPane.tsx 1633-1719，闭包改显式参数）。
// 三条归位路径：内联（renderAfterPart）→ 回合底部（cardsForTurn）→ 兜底（unplacedCards）。
// 顶层条目资格判定来自 @mafw/session-ui/parts-rules（经 flow-card-placement 转出）。
import { inlineAnchor, type FlowCardLink, type ToolPartLike } from "../components/flow-card-placement"
import { isTopLevelToolEntry } from "@mafw/session-ui/parts-rules"

/** ChatPane 的 FlowCardRecord（联合类型，此处结构化最小面） */
export type FlowCardRecordLike = {
  kind: string
  data: FlowCardLink & { id: string; createdAt: number; [k: string]: any }
}

type StoreLike = { message: Record<string, any[]>; part: Record<string, any[]> }
type PartsOf = (messageID: string) => ToolPartLike[]

export function hasInlineAnchor(c: FlowCardRecordLike, partsOf: PartsOf): boolean {
  return !!inlineAnchor(c.data, (mid) => (partsOf(mid) as any[]) || [])
}

export function inlineCardsForPart(
  cards: FlowCardRecordLike[],
  messageID: string,
  callID: string,
  partsOf: PartsOf,
): FlowCardRecordLike[] {
  return cards.filter((c) => c.data.messageID === messageID && c.data.callID === callID && hasInlineAnchor(c, partsOf))
}

export function turnOfMessage(messageID: string, store: StoreLike, sid: string): string | null {
  const msgs = store.message[sid] || []
  const msg = msgs.find((m: any) => m.id === messageID)
  if (!msg) return null
  if (msg.role === "user") return msg.id
  if (msg.parentID) return msg.parentID
  const sorted = [...msgs].sort((a: any, b: any) => (a.time?.created || 0) - (b.time?.created || 0))
  const idx = sorted.findIndex((m: any) => m.id === messageID)
  if (idx > 0) {
    for (let i = idx - 1; i >= 0; i--) {
      if (sorted[i].role === "user") return sorted[i].id
    }
  }
  return null
}

/**
 * Cards belonging to the user turn `userMsgId` (direct or via the assistant
 * message's parentID), in creation order. userMessages 调用方传入（已按时间排序）。
 */
export function cardsForTurn(
  cards: FlowCardRecordLike[],
  userMsgId: string,
  store: StoreLike,
  sid: string,
  partsOf: PartsOf,
  userMessages: any[],
): FlowCardRecordLike[] {
  const isLast = userMessages.length > 0 && userMessages[userMessages.length - 1].id === userMsgId
  return cards
    .filter((c) => {
      // 内联挂载的卡不参与回合底部归位
      if (hasInlineAnchor(c, partsOf)) return false
      // Card explicitly belongs to this turn
      if (c.data.messageID && turnOfMessage(c.data.messageID, store, sid) === userMsgId) return true
      // Unplaced cards (no messageID or can't resolve) attach to the last turn
      if (isLast && !turnOfMessage(c.data.messageID || "", store, sid)) return true
      return false
    })
    .sort((a, b) => a.data.createdAt - b.data.createdAt)
}

/**
 * Cards that could not be placed into any turn (no/unknown message link).
 * These are attached to the last user turn via cardsForTurn, so this
 * returns empty when there are user messages.
 */
export function unplacedCards(
  cards: FlowCardRecordLike[],
  store: StoreLike,
  sid: string,
  partsOf: PartsOf,
  userMessages: any[],
): FlowCardRecordLike[] {
  if (userMessages.length > 0) return []
  return cards
    .filter((c) => !hasInlineAnchor(c, partsOf) && (!c.data.messageID || !turnOfMessage(c.data.messageID, store, sid)))
    .sort((a, b) => a.data.createdAt - b.data.createdAt)
}

// re-export 供 ChatPane 既有调用点继续使用
export { isTopLevelToolEntry }
