// Flow card 内联锚点判定（纯函数，bun 可测）。
//
// 权限卡/问题卡要内联挂到发起它的工具调用卡后面，锚点是 ToolPart.callID。
// 但只有当锚 part 在 session-ui AssistantParts 里渲染为「顶层 part 条目」时，
// renderAfterPart 钩子才会触发——判定规则必须与 groupParts/renderable 严格一致，
// 否则卡片既不进内联又被排除出兜底 → 不可见（双重渲染防护反过来变成丢失）。
//
// ⚠ 本文件镜像 packages/session-ui/src/components/message-part.tsx 的
// CONTEXT_GROUP_TOOLS / HIDDEN_TOOLS / renderable(question) 规则；
// 修改任一侧必须同步另一侧。

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

// 镜像 message-part.tsx 的 CONTEXT_GROUP_TOOLS（read/glob/grep/list 连续合并为一组，
// 组内 part 不作为顶层条目渲染）。
const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
// 镜像 HIDDEN_TOOLS。
const HIDDEN_TOOLS = new Set(["todowrite"])

/** 该 part 是否会作为 AssistantParts 的顶层「part」条目渲染（renderAfterPart 会触发）。 */
export function isTopLevelToolEntry(part: ToolPartLike): boolean {
  if (part.type !== "tool" || !part.tool) return false
  if (HIDDEN_TOOLS.has(part.tool)) return false
  if (CONTEXT_GROUP_TOOLS.has(part.tool)) return false
  if (part.tool === "question") {
    const s = part.state?.status
    if (s === "pending" || s === "running") return false
  }
  return true
}

/**
 * 卡片初始展开状态：pending 展开（它是操作点），已处理（answered/allowed/denied/
 * expired/cancelled）默认收起为一行摘要，点击展开。只决定**初始**值——挂载后
 * pending→resolved 的迁移不自动收起（避免回答后视图被抽走）。
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
