export type DockTab = "tasks" | "trajectory" | "usage" | "notes" | "changes"
export const DOCK_TABS: DockTab[] = ["tasks", "trajectory", "usage", "notes", "changes"]

/** 持久化 tab 值归一化：v4.13 五栏并四栏，quota 迁移到 usage */
export function normalizeDockTab(v: string | null | undefined, fallback: DockTab = "usage"): DockTab {
  if (v === "quota") return "usage"
  return (DOCK_TABS as string[]).includes(v || "") ? (v as DockTab) : fallback
}

/** dock 宽度：全局统一默认 320，拖拽一次全 tab 生效（点 tab 不再跳宽）。 */
export const DOCK_DEFAULT_WIDTH = 320
