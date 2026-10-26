// dock 宽度策略（纯函数，单测钉扎）：普通 tab 窄栏 480 上限；
// workbench tab（files/editor/browser）上限 = 窗口 50%（不低于 min），只增不减。
import type { DockTab } from "./components/dock-tab"

export const DOCK_MIN_WIDTH = 240
export const DOCK_STANDARD_MAX = 480
const WORKBENCH_WIDEN_TARGET = 560

const WORKBENCH_TABS = new Set<DockTab>(["files", "editor", "browser", "terminal"])

export function dockMaxWidth(tab: DockTab, innerWidth: number): number {
  if (WORKBENCH_TABS.has(tab)) {
    return Math.max(DOCK_MIN_WIDTH, Math.floor(innerWidth / 2))
  }
  return DOCK_STANDARD_MAX
}

export function clampDockWidth(tab: DockTab, width: number, innerWidth: number): number {
  const max = dockMaxWidth(tab, innerWidth)
  return Math.max(DOCK_MIN_WIDTH, Math.min(Math.round(width), max))
}

/** 切到 workbench tab 时的建议宽度：取 min(560, 半窗)，且绝不压缩当前宽度。 */
export function suggestDockWidth(tab: DockTab, width: number, innerWidth: number): number {
  if (!WORKBENCH_TABS.has(tab)) return width
  const target = Math.min(WORKBENCH_WIDEN_TARGET, Math.floor(innerWidth / 2))
  return Math.max(width, clampDockWidth(tab, target, innerWidth))
}
