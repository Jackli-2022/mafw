// 纯 reducer：chat store（message/part 两桶）突变收敛，无 Solid 依赖，bun 可测。
// 逐字迁移自 MafwShell.tsx onmessage 内 setStore updater（commit 13ad8348）。
// 约定：返回 null = 无变化（调用方跳过 patchStore，保持 Solid 引用语义）。
import { mergeAssistantMessage } from "../message-model"
import { isLocalMessageId } from "../chat/local-id"
import { normalizeToolPart } from "../tool-part"

export type ChatStoreState = {
  message: Record<string, any[]>
  part: Record<string, any[]>
}

/** message.updated user 分支：乐观 user 消息（id `user-...`）替换为真实 id。 */
export function applyUserMessageArrival(
  state: ChatStoreState,
  sid: string,
  info: { id: string; role: string; time?: { created?: number }; [k: string]: any },
): { message: Record<string, any[]>; part: Record<string, any[]> } | null {
  const msgs = { ...state.message }
  const sessionMsgs = [...(msgs[sid] || [])]
  const msgId = info.id
  if (sessionMsgs.find(m => m.id === msgId)) return null
  const optIdx = sessionMsgs.findIndex(m => m.role === "user" && isLocalMessageId(m.id))
  if (optIdx >= 0) {
    const opt = sessionMsgs[optIdx]
    sessionMsgs[optIdx] = {
      ...info,
      id: msgId,
      sessionID: sid,
      time: info.time || opt.time || { created: Date.now() },
      // Preserve voice UI fields from optimistic message
      voiceStatus: opt.voiceStatus,
      voiceDuration: opt.voiceDuration,
    }
    for (const m of sessionMsgs) {
      if (m.parentID === opt.id) m.parentID = msgId
    }
    msgs[sid] = sessionMsgs
    const parts = { ...state.part }
    if (parts[opt.id]) {
      parts[msgId] = (parts[msgId] || []).concat(parts[opt.id].map(p => ({ ...p, sessionID: sid, messageID: msgId })))
      delete parts[opt.id]
    }
    return { message: msgs, part: parts }
  }
  sessionMsgs.push({ ...info, id: msgId, sessionID: sid, time: info.time || { created: Date.now() }, parts: [] })
  msgs[sid] = sessionMsgs
  return { message: msgs, part: state.part }
}

/** message.updated assistant 分支：委托 mergeAssistantMessage（无变化返回原数组引用 → null）。 */
export function applyAssistantMessage(
  state: ChatStoreState,
  sid: string,
  info: any,
  parentFallback: string | null,
): { message: Record<string, any[]> } | null {
  const msgs = { ...state.message }
  const sessionMsgs = mergeAssistantMessage(
    msgs[sid] || [],
    info,
    { sid, parentFallback },
  )
  // 无变化时保持引用（mergeAssistantMessage 返回原数组）
  if (sessionMsgs === (msgs[sid] || [])) return null
  msgs[sid] = sessionMsgs
  return { message: msgs }
}

/** message.part.delta：assistant 文本增量累积（opencode ≥1.18 流式主链）。 */
export function applyPartDelta(
  state: ChatStoreState,
  sid: string,
  msgId: string,
  partID: string,
  delta: string,
  partType: "text" | "reasoning" = "text",
): { part: Record<string, any[]> } | null {
  const parts = { ...state.part }
  const existing = parts[msgId] || []
  // Type is part of the identity: some runtimes (opencode 2.x text/reasoning
  // streams) reuse the same wire part id for both kinds. Matching by id alone
  // appends the answer into the reasoning part, which renders collapsed and is
  // invisible until the step's final snapshot.
  let idx = existing.findIndex(p => p.id === partID && p.type === partType)
  if (idx < 0) {
    // legacy parts without a type default to text
    idx = existing.findIndex(p => p.id === partID && p.type === undefined && partType === "text")
  }
  if (idx >= 0) {
    const cur = existing[idx]
    if (typeof cur.text !== "string") return null
    const text = cur.text + delta
    if (text === cur.text) return null
    parts[msgId] = existing.map((p, i) => (i === idx ? { ...p, text } : p))
    return { part: parts }
  }
  parts[msgId] = [...existing, { id: partID, type: partType, text: delta, sessionID: sid, messageID: msgId }]
  return { part: parts }
}

/** message.part.updated：part upsert（吸收 id 相同的乐观 user text part）。 */
export function applyPartUpsert(
  state: ChatStoreState,
  sid: string,
  part: any,
): { part: Record<string, any[]> } {
  const parts = { ...state.part }
  const existing = parts[part.messageID] || []
  // v2.1.0 wire: tool parts carry `name` (e.g. "subagent"), not `tool`.
  const normalized = normalizeToolPart(part)
  const partObj = { ...normalized, id: normalized.id || `${normalized.messageID}-${normalized.type}`, sessionID: sid, messageID: normalized.messageID }
  // text/reasoning are type-scoped: same-id parts of different kinds must not
  // overwrite each other (opencode 2.x reuses one id for both streams).
  const typeScoped = partObj.type === "text" || partObj.type === "reasoning"
  let idx = existing.findIndex(p => p.id === partObj.id && (!typeScoped || p.type === partObj.type))
  if (idx < 0 && normalized.type === "text") {
    // absorb the optimistic user text part (id `user-...-text`) when the
    // real user part with identical text arrives
    idx = existing.findIndex(p => p.type === "text" && isLocalMessageId(p.id) && (p.text || "") === (normalized.text || ""))
  }
  parts[partObj.messageID] = idx >= 0
    ? existing.map((p, i) => (i === idx ? { ...p, ...partObj } : p))
    : [...existing, partObj]
  return { part: parts }
}

/** T2-3：清理某会话的 transient data part（回合终态 / 切会话时）。 */
export function clearTransientDataParts(
  state: ChatStoreState,
  sid: string,
): { part: Record<string, any[]> } | null {
  const parts = { ...state.part }
  let changed = false
  for (const [msgId, list] of Object.entries(parts)) {
    const current = list ?? []
    const filtered = current.filter((p: any) => !(
      p?.sessionID === sid
      && typeof p?.type === "string" && p.type.startsWith("data-")
      && p.transient === true
    ))
    if (filtered.length !== current.length) {
      parts[msgId] = filtered
      changed = true
    }
  }
  return changed ? { part: parts } : null
}

/** session.next.tool.*：确保 assistant 承载消息存在（工具卡的父消息）。 */
export function ensureAssistantMessage(
  state: ChatStoreState,
  sid: string,
  msgId: string,
  parentId: string | null,
): { message: Record<string, any[]> } | null {
  const msgs = { ...state.message }
  const sessionMsgs = [...(msgs[sid] || [])]
  if (sessionMsgs.find(m => m.id === msgId)) return null
  sessionMsgs.push({ id: msgId, sessionID: sid, role: "assistant", parentID: parentId, time: { created: Date.now() }, parts: [] })
  msgs[sid] = sessionMsgs
  return { message: msgs }
}

/** mafw_media_speak 参数提取：input（opencode tool part 标准字段）优先，args 兼容；兜底读 store tool part。 */
export function extractMediaSpeak(
  event: any,
  storeParts: Record<string, any[]>,
): { text: string; voice?: string } | null {
  const propsArgs = event.properties?.input || event.properties?.info?.input || event.properties?.part?.input
    || event.properties?.args || event.properties?.info?.args || event.info?.args
  let text = typeof propsArgs?.text === "string" ? propsArgs.text : ""
  let voice = typeof propsArgs?.voice === "string" ? propsArgs.voice : undefined
  if (!text) {
    // 兜底：从 store 里该 assistant 消息的 tool part 提取（part 结构 { type, tool, input }）
    const msgId = event.assistantMessageID
    const parts = msgId ? (storeParts[msgId] || []) : []
    for (const p of parts) {
      if (p?.type === "tool" && (p.tool === "mafw_media_speak" || p.tool === "mafw_speak")) {
        text = typeof p.input?.text === "string" ? p.input.text : ""
        voice = typeof p.input?.voice === "string" ? p.input.voice : voice
        break
      }
    }
  }
  if (!text) return null
  return { text, voice }
}

/**
 * 回合终态兜底：为该会话所有缺 time.completed 的 assistant 消息盖章。
 * session-ui text part 的流式光标（▌）判定只看 message.time.completed，
 * abort / 终帧缺失的消息会永久闪烁绿色方块——回合结束事件到达时在此统一封口。
 * 返回 null = 无需盖章（调用方跳过 patchStore）。
 */
export function sealUnfinishedAssistantMessages(
  state: ChatStoreState,
  sid: string,
  completedAt: number = Date.now(),
): { message: Record<string, any[]> } | null {
  const msgs = state.message[sid]
  if (!Array.isArray(msgs) || msgs.length === 0) return null
  let touched = false
  const next = msgs.map(m => {
    if (!m || m.role !== "assistant" || typeof m.time?.completed === "number") return m
    touched = true
    return { ...m, time: { ...(m.time || {}), completed: completedAt } }
  })
  return touched ? { message: { ...state.message, [sid]: next } } : null
}
