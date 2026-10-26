// 右 dock 的会话数据面板（图标轨浮层，2026-10-26 工作台合并后）。
// files/editor/browser/terminal 四件套已合并为 Workbench，不再是 dock tab。
export type DockTab = "tasks" | "trajectory" | "usage" | "notes" | "changes" | "subagents" | "background"
export const DOCK_TABS: DockTab[] = ["tasks", "trajectory", "usage", "notes", "changes", "subagents", "background"]

/** 持久化 tab 值归一化：旧 quota → usage；旧工作台四 tab（files/editor/browser/terminal）→ fallback。 */
export function normalizeDockTab(v: string | null | undefined, fallback: DockTab = "tasks"): DockTab {
  if (v === "quota") return "usage"
  return (DOCK_TABS as string[]).includes(v || "") ? (v as DockTab) : fallback
}

/** overlay（<1200px）下工作台浮层默认宽度。 */
export const DOCK_DEFAULT_WIDTH = 520
