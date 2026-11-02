// 消息模型归属：只读 MAFW 规范 `model`（摄取层已把 opencode 顶层
// modelID/providerID 与 pi 的原生形状折叠成 { providerID, modelID }）。
// 渲染/标题栏/上下文用量共用同一取法，缺省返回 null。
export function messageModel(info: any): { providerID: string; modelID: string } | null {
  const model = info?.model
  const providerID = model?.providerID
  const modelID = model?.modelID
  if (typeof providerID !== "string" || typeof modelID !== "string" || !providerID || !modelID) return null
  return { providerID, modelID }
}

// SSE message.updated assistant 分支的合并策略：消息完成时 opencode 会重发
// 带 time.completed 的更新——已存在必须合并回填（此前"存在即跳过"导致 live
// turn 的 ThinkingBlock 永远停在"思考中"）。无新信息时返回原数组引用。
export function mergeAssistantMessage(
  sessionMsgs: any[],
  info: any,
  opts: { sid: string; parentFallback: string | null },
): any[] {
  const msgId = info.id
  const idx = sessionMsgs.findIndex(m => m.id === msgId)
  if (idx >= 0) {
    const cur = sessionMsgs[idx]
    const next: any = { ...cur, ...info, id: msgId, sessionID: opts.sid }
    const timePatch = info.time || {}
    const hasNewTime = Object.keys(timePatch).some(k => (cur.time as any)?.[k] !== timePatch[k])
    next.time = hasNewTime ? { ...cur.time, ...timePatch } : cur.time
    const changed = Object.keys(next).some(k => (cur as any)[k] !== next[k])
    if (!changed) return sessionMsgs
    const msgs = [...sessionMsgs]
    msgs[idx] = next
    return msgs
  }
  const pm = info.parentID || opts.parentFallback
  return [...sessionMsgs, { ...info, id: msgId, sessionID: opts.sid, parentID: pm, time: info.time || { created: Date.now() } }]
}
