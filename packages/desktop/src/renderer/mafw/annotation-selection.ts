// 选区浮动 toolbar 定位（ADE 模式）：优先选区上方，空间不足落下方，水平居中并 clamp。
import type { BoxRect, BoxSize } from "./annotation-placement"

export function placeSelectionToolbar(
  anchor: BoxRect,
  toolbar: BoxSize,
  container: BoxSize,
  gap = 6,
  margin = 8,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, container.w - toolbar.w - margin)
  const left = Math.max(margin, Math.min(anchor.left + anchor.width / 2 - toolbar.w / 2, maxLeft))
  const above = anchor.top - gap - toolbar.h
  const below = anchor.top + anchor.height + gap
  const maxTop = Math.max(margin, container.h - toolbar.h - margin)
  const top = above >= margin ? above : below <= maxTop ? below : Math.max(margin, Math.min(below, maxTop))
  return { left, top }
}
