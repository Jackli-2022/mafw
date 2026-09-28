export type DockTab = "tasks" | "trajectory" | "usage" | "notes" | "changes"
export const DOCK_TABS: DockTab[] = ["tasks", "trajectory", "usage", "notes", "changes"]

/** 持久化 tab 值归一化：v4.13 五栏并四栏，quota 迁移到 usage */
export function normalizeDockTab(v: string | null | undefined, fallback: DockTab = "usage"): DockTab {
  if (v === "quota") return "usage"
  return (DOCK_TABS as string[]).includes(v || "") ? (v as DockTab) : fallback
}

/** dock 宽度（v6 W4）：changes 需要更宽的 diff 视图，其余默认 320。 */
export const DOCK_DEFAULT_WIDTH = 320
export const DOCK_WIDE_TABS: DockTab[] = ["changes"]
export function dockTabWidth(tab: DockTab, stored: Record<string, number>): number {
  return stored[tab] ?? (DOCK_WIDE_TABS.includes(tab) ? 480 : DOCK_DEFAULT_WIDTH)
}
