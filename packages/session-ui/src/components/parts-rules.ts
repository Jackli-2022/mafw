// 会话 part 渲染规则单一真相源：AssistantParts 渲染与 desktop flow-card 内联锚定共用。
// 禁止在其他包再镜像这些常量与判定（原 desktop flow-card-placement.ts 的镜像已收编至此）。

export interface PartLike {
  type: string
  tool?: string
  callID?: string
  text?: string
  state?: { status?: string }
}

export const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
export const HIDDEN_TOOLS = new Set(["todowrite"])

export function renderable(part: PartLike, showReasoningSummaries = true): boolean {
  if (part.type === "tool") {
    if (!part.tool) return false
    if (HIDDEN_TOOLS.has(part.tool)) return false
    if (part.tool === "question") return part.state?.status !== "pending" && part.state?.status !== "running"
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!part.text?.trim()
  return false
}

/** 该 part 是否会作为 AssistantParts 的顶层「part」条目渲染（renderAfterPart 会触发）。 */
export function isTopLevelToolEntry(part: PartLike): boolean {
  if (part.type !== "tool" || !part.tool) return false
  if (HIDDEN_TOOLS.has(part.tool)) return false
  if (CONTEXT_GROUP_TOOLS.has(part.tool)) return false
  if (part.tool === "question") {
    const s = part.state?.status
    if (s === "pending" || s === "running") return false
  }
  return true
}
