// 批注框锚点旁定位（rev3）：below → above → right → left 逐级翻边并 clamp，尽量不覆盖锚点。
export type BoxRect = { left: number; top: number; width: number; height: number }
export type BoxSize = { w: number; h: number }
export type Placement = "below" | "above" | "right" | "left"

export function placeAnnotationBox(
  anchor: BoxRect,
  box: BoxSize,
  container: BoxSize,
  gap = 8,
  margin = 8,
): { left: number; top: number; placement: Placement } {
  const clampX = (v: number) => Math.max(margin, Math.min(v, container.w - box.w - margin))
  const clampY = (v: number) => Math.max(margin, Math.min(v, container.h - box.h - margin))
  const anchorBottom = anchor.top + anchor.height
  const anchorRight = anchor.left + anchor.width
  const spaceBelow = container.h - anchorBottom - gap - margin
  const spaceAbove = anchor.top - gap - margin
  const spaceRight = container.w - anchorRight - gap - margin
  const spaceLeft = anchor.left - gap - margin

  if (spaceBelow >= box.h) return { left: clampX(anchor.left), top: anchorBottom + gap, placement: "below" }
  if (spaceAbove >= box.h) return { left: clampX(anchor.left), top: anchor.top - box.h - gap, placement: "above" }
  if (spaceRight >= box.w) return { left: anchorRight + gap, top: clampY(anchor.top), placement: "right" }
  if (spaceLeft >= box.w) return { left: anchor.left - box.w - gap, top: clampY(anchor.top), placement: "left" }

  // 四面都不足：取纵向空间较大的一侧，clamp 到容器内（可能压住锚点，但不溢出）。
  if (spaceBelow >= spaceAbove) {
    return { left: clampX(anchor.left), top: clampY(anchorBottom + gap), placement: "below" }
  }
  return { left: clampX(anchor.left), top: clampY(anchor.top - box.h - gap), placement: "above" }
}
