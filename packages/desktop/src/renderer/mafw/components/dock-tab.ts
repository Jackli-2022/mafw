export type DockTab = "tasks" | "trajectory" | "usage" | "notes"
export const DOCK_TABS: DockTab[] = ["tasks", "trajectory", "usage", "notes"]

/** 持久化 tab 值归一化：v4.13 五栏并四栏，quota 迁移到 usage */
export function normalizeDockTab(v: string | null | undefined, fallback: DockTab = "usage"): DockTab {
  if (v === "quota") return "usage"
  return (DOCK_TABS as string[]).includes(v || "") ? (v as DockTab) : fallback
}
