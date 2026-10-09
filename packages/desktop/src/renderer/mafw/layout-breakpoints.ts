/** 窄视口断点：RightDock/tasks 转 overlay、Rail 自动折叠共用同一阈值。 */
export const NARROW_BREAKPOINT = 1200

export function isNarrowViewport(width: number): boolean {
  return width < NARROW_BREAKPOINT
}

export type RailAutoAction = "collapse" | "expand" | "none"

/**
 * Rail 自动折叠决策（纯函数）：仅在跨越断点时动作，避免 resize 抖动/与用户手动操作拉锯。
 * - wide → narrow：折叠（若尚未自动折叠过）
 * - narrow → wide：仅当是本组件自动折叠的才展开（不覆盖用户手动折叠）
 * - 同侧变化：不动
 */
export function railAutoAction(prevWidth: number, nextWidth: number, autoCollapsed: boolean): RailAutoAction {
  const prevNarrow = isNarrowViewport(prevWidth)
  const nextNarrow = isNarrowViewport(nextWidth)
  if (!autoCollapsed && !prevNarrow && nextNarrow) return "collapse"
  if (autoCollapsed && prevNarrow && !nextNarrow) return "expand"
  return "none"
}
