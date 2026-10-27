// 批注浮层纵向定位（M6）：下方空间不足时翻到锚点上方；锚点行高按 24px 估算。
export function popoverTop(preferredTop: number, popHeight: number, containerHeight: number, gap = 8): number {
  const top = Math.max(gap, preferredTop)
  if (containerHeight <= 0) return top
  if (top + popHeight <= containerHeight - gap) return top
  return Math.max(gap, top - popHeight - 24)
}
