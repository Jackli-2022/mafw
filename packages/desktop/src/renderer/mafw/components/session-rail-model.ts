// SessionRail 纯模型：七项图标轨 + badge 归属（测试与组件共用，避免 JSX 依赖）。
import { type IconProps } from "@mafw/ui/icon"
import { type DockTab } from "./dock-tab"

export const RAIL_ITEMS: { id: DockTab; label: string; icon: IconProps["name"] }[] = [
  { id: "tasks", label: "任务", icon: "checklist" },
  { id: "trajectory", label: "轨迹", icon: "dot-grid" },
  { id: "usage", label: "用量", icon: "chart" },
  { id: "notes", label: "便签", icon: "pencil-line" },
  { id: "changes", label: "改动", icon: "review" },
  { id: "subagents", label: "子代理", icon: "subagent" },
  { id: "background", label: "后台", icon: "console" },
]

/** 只有 subagents / background 有 badge；其余 0（修复 badge 错挂六图标）。 */
export function railBadgeFor(tab: DockTab, subagentBadge = 0, backgroundBadge = 0): number {
  if (tab === "subagents") return subagentBadge
  if (tab === "background") return backgroundBadge
  return 0
}
