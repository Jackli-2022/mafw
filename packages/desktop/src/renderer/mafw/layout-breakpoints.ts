/** 窄视口断点：RightDock/tasks 转 overlay、Rail 自动折叠共用同一阈值。 */
export const NARROW_BREAKPOINT = 1200

export function isNarrowViewport(width: number): boolean {
  return width < NARROW_BREAKPOINT
}
