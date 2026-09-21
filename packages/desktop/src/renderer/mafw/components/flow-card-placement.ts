// Flow card 内联锚点判定（纯函数，bun 可测）。
//
// 权限卡/问题卡要内联挂到发起它的工具调用卡后面，锚点是 ToolPart.callID。
// 但只有当锚 part 在 session-ui AssistantParts 里渲染为「顶层 part 条目」时，
// renderAfterPart 钩子才会触发——顶层条目判定规则来自
// @mafw/session-ui/parts-rules（单一真相源，禁止本地镜像）。

import { isTopLevelToolEntry } from "@mafw/session-ui/parts-rules"

export interface FlowCardLink {
  messageID?: string
  callID?: string
}

export interface ToolPartLike {
  type: string
  callID?: string
  tool?: string
  state?: { status?: string }
}

export { isTopLevelToolEntry }

/**
 * 卡片初始展开状态：pending 展开（它是操作点），已处理（answered/allowed/denied/
 * expired/cancelled）默认收起为一行摘要，点击展开。挂载后 pending→resolved 迁移
 * 由卡片组件自动收起（一行摘要保留在原地）。
 */
export function flowCardInitialExpanded(status: string): boolean {
  return status === "pending"
}

/**
 * 卡片可内联时返回锚点 { messageID, callID }，否则 null（调用方走回合底部兜底）。
 * partsOf：按 assistant messageID 取 part 列表（store.part[messageID]，可缺）。
 */
export function inlineAnchor(
  card: FlowCardLink,
  partsOf: (messageID: string) => ToolPartLike[],
): { messageID: string; callID: string } | null {
  const mid = card.messageID
  const cid = card.callID
  if (!mid || !cid) return null
  const hit = (partsOf(mid) || []).find((p) => p.type === "tool" && p.callID === cid)
  if (!hit || !isTopLevelToolEntry(hit)) return null
  return { messageID: mid, callID: cid }
}

/**
 * asked 事件反查 tool 链接：permission.asked 的 properties.tool 是可选字段
 * （pi runtime 恒缺），卡片缺 messageID/callID 时永远内联不了，堆在回合底部。
 * 审批串行（同一时刻只有一个待审请求）+ 工具名匹配 → 扫 store 中 pending 的
 * 同名 ToolPart 恢复锚点，高置信。excludeCallIDs 排除已被其他卡片占用的 callID。
 */
export function findPendingToolPart(
  toolName: string,
  partsOf: (messageID: string) => ToolPartLike[],
  messageIDs: string[],
  excludeCallIDs: string[] = [],
): { messageID: string; callID: string } | null {
  if (!toolName) return null
  const excluded = new Set(excludeCallIDs)
  let hit: { messageID: string; callID: string } | null = null
  for (const mid of messageIDs) {
    for (const p of partsOf(mid) || []) {
      if (p.type !== "tool" || p.tool !== toolName) continue
      if (!p.callID || excluded.has(p.callID)) continue
      if (p.state?.status !== "pending") continue
      hit = { messageID: mid, callID: p.callID } // 按回合时间序，后者覆盖 → 最新命中
    }
  }
  return hit
}
