// Workbench 布局纯函数（spec 2026-10-26-workbench-merge-design）。
// 三列：左推挤栏 | 对话列（绝对 px 档位）| 工作台（吃剩余）；工作台关闭/窄屏 overlay 时两列。
import { migrateLegacyChatWidth, normalizeDetent, type WorkbenchDetent } from "./workbench-detents"

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

/** 非 chat 视图隐藏整个 dock 壳（窄屏 overlay 不得盖住 Dashboard/Config 等页）。 */
export function workbenchShellHidden(chatActive: boolean): boolean {
  return !chatActive
}

export type MigratedWorkbench = {
  detent: WorkbenchDetent
  workbenchTab: "editor" | "browser"
  terminalOpen: boolean
}

/** 一次性迁移旧键：新档位键优先；旧 tab 映射到工作台 tab；删除旧宽度键。 */
export function migrateDockKeys(
  read: (key: string) => string | null,
  remove: (key: string) => void,
  availableWidth: number,
): MigratedWorkbench {
  const storedDetent = read("mafw-workbench-detent")
  const detent = storedDetent !== null
    ? normalizeDetent(storedDetent)
    : detentFromLegacy(read("mafw-chat-width"), availableWidth)

  const legacyTab = read("mafw-right-dock-tab")
  const workbenchTab: "editor" | "browser" = legacyTab === "browser" ? "browser" : "editor"
  const terminalOpen = legacyTab === "terminal"

  for (const key of ["mafw-chat-width", "mafw-right-dock-width", "mafw-right-dock-widths"]) {
    remove(key)
  }
  return { detent, workbenchTab, terminalOpen }
}
