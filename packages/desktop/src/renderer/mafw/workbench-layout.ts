// Workbench 布局纯函数（spec 2026-10-26-workbench-merge-design）。
// 三列：左推挤栏 | 对话列（绝对 px 档位）| 工作台（吃剩余）；工作台关闭/窄屏 overlay 时两列。
import { migrateLegacyChatWidth, type WorkbenchDetent } from "./workbench-detents"

/** grid-template-columns：split=三列，否则对话满宽 + 0 宽 dock 列。 */
export function workbenchColumns(input: { leftPx: number; chatPx: number; split: boolean }): string {
  const left = `${input.leftPx}px`
  return input.split ? `${left} ${input.chatPx}px minmax(0, 1fr)` : `${left} minmax(0, 1fr) 0px`
}

/** 旧 `mafw-chat-width`（自由 px）→ 绝对档位；供首次迁移使用。 */
export function detentFromLegacy(storedChatWidth: string | null, availableWidth: number): WorkbenchDetent {
  const px = storedChatWidth === null || storedChatWidth === "" ? Number.NaN : Number(storedChatWidth)
  return migrateLegacyChatWidth(Number.isFinite(px) ? px : null, availableWidth)
}
