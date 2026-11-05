import { formatRailTitle } from "./components/rail-display"

/**
 * ChatPane 头部标题。Lead 是角色会话：无论 runtime 把 session title 改成什么
 * （opencode 首轮后会写成「问候」这类摘要），头部都显示角色名。
 */
export function chatPaneTitle(input: { lead: boolean; title?: string | null }): string {
  if (input.lead) return "Lead"
  return formatRailTitle(input.title || "Chat")
}
