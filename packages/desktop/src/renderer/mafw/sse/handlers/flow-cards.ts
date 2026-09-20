// SSE flow-card 处理器：native question / permission 请求 → AskCard / PermissionCard。
// 分支语义逐字迁移自 MafwShell.tsx onmessage（commit 13ad8348 行 1371-1431）；
// mapAskCard / answersToRecord 自 MafwShell 局部函数（原 998/1063 行）纯化移入——
// 闭包读取的 agentTitleOf / flowCards 查找改为 deps 注入。
import { mapPermissionCard as mapPermissionCardPure, shouldNotify } from "../../components/permission-card-mapping"
import type { AskCardData } from "../../components/AskCard"
import type { SidHandler, ShellEventDeps } from "../dispatcher"

export interface FlowCardDeps {
  upsertCard(sid: string, card: { kind: "ask" | "permission"; data: unknown }): void
  resolveCard(sid: string, id: string, resolution: { status: string; answers?: Record<string, string[]> }): void
  setPermissionMode(sid: string, mode: "read-only" | "auto" | "full-access"): void
  setCompactionMark(sid: string, mark: { at: number; summary?: string }): void
  notify(title: string, body: string): void
  trace(event: { type?: string }, channel: string): void
  /** auto 决策兜底 5s 后对账（原 setTimeout 语义，注入便于测试）。 */
  scheduleReconcile(delayMs: number): void
  /** 卡片 agent 名（原 agentTitleOf：读打开 tab 的 title 副本）。 */
  agentTitleOf(sid: string): string
  /** question.replied 时按 id 找 ask 卡（原 answersToRecord 的 flowCards 查找）。 */
  getAskCard(sid: string, id: string): AskCardData | undefined
}

export const mapAskCard = (req: any, createdAt: number, agentTitle: string): AskCardData => ({
  id: req.id,
  sessionID: req.sessionID,
  agentName: agentTitle,
  status: "pending",
  createdAt,
  messageID: req.tool?.messageID,
  callID: req.tool?.callID,
  questions: (req.questions || []).map((q: any, i: number) => ({
    id: `${req.id}-q${i}`,
    title: q.question,
    mode: q.multiple ? "multi" : "single",
    options: (q.options || []).map((o: any) => ({ id: o.label, title: o.label, description: o.description })),
    allowCustom: q.custom !== false,
  })),
})

export const answersToRecord = (answers: string[][], card: AskCardData | undefined): Record<string, string[]> => {
  const rec: Record<string, string[]> = {}
  if (!card) return rec
  card.questions.forEach((q, i) => { rec[q.id] = answers[i] || [] })
  return rec
}

export const handleFlowCardEvent: SidHandler = (event, sid, deps) => {
  const d = deps.flowCards
  if (event.type === "question.asked") {
    d.trace(event, "card:ask")
    d.upsertCard(sid, { kind: "ask", data: mapAskCard(event.properties || {}, Date.now(), d.agentTitleOf(sid)) })
    d.notify("MAFW：Agent 提问", String(event.properties?.question || "").slice(0, 80))
    return true
  }
  if (event.type === "permission.asked") {
    d.trace(event, "card:permission")
    const card = mapPermissionCardPure(event.properties || {}, Date.now(), d.agentTitleOf(sid))
    d.upsertCard(sid, { kind: "permission", data: card })
    if (shouldNotify(card)) {
      d.notify("MAFW：需要权限审批", String(event.properties?.permission?.tool || "工具调用").slice(0, 80))
    } else {
      // auto 决策兜底：5s 后对账服务端真值（gateway auto-reply 失败时，卡片被
      // reconcile 重新映射回 pending，用户仍可手动答复）。
      d.scheduleReconcile(5000)
    }
    return true
  }
  if (event.type === "permission_mode") {
    // gateway 审批模式变更（🛡 toggle / 预算回落广播）——三端徽标同步。
    // 未知值（旧广播残留等）回退 read-only，保证卡片映射不落空。
    const pmSid = event.sessionID || event.properties?.sessionID
    const rawMode = event.properties?.mode
    const pmMode = rawMode === "auto" || rawMode === "full-access" ? rawMode : "read-only"
    if (pmSid) d.setPermissionMode(pmSid, pmMode)
    return true
  }
  if (event.type === "session.compacted") {
    d.trace(event, "chat:compacted")
    const summary = event.properties?.summary || event.properties?.part?.text || undefined
    d.setCompactionMark(sid, { at: Date.now(), summary })
    return true
  }
  if (event.type === "question.replied") {
    d.trace(event, "card:ask-resolve")
    const props = event.properties || {}
    const id = props.requestID || props.id
    const answers = props.answers || []
    if (id) d.resolveCard(sid, id, { status: "answered", answers: answersToRecord(answers, d.getAskCard(sid, id)) })
    return true
  }
  if (event.type === "question.rejected") {
    d.trace(event, "card:ask-cancel")
    const props = event.properties || {}
    const id = props.requestID || props.id
    if (id) d.resolveCard(sid, id, { status: "cancelled" })
    return true
  }
  if (event.type === "permission.replied") {
    d.trace(event, "card:permission-resolve")
    const props = event.properties || {}
    const id = props.requestID || props.id
    if (id) {
      const reply = props.reply
      d.resolveCard(sid, id, { status: reply === "always" ? "allowed-always" : reply === "reject" ? "denied" : "allowed-once" })
    }
    return true
  }
  return false
}
