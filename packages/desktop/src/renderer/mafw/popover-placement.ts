/**
 * Popover 定位纯函数（从 PopoverShell 抽出，便于布局回归测试）。
 *
 * 规则：优先完整放在触发元素上方；上方不够再放下方；两侧都不够时贴较大一侧并
 * clamp 到视口。高度取内容真实高度（受 CSS max-height 限制），因此内容长高
 * （如 Thinking 子菜单展开）重新计算时 popover 会保持贴边而不是长出视口。
 */
export type PopoverAnchor = "tr" | "bl" | "below-center"

export interface PopoverPlacementInput {
  trigger: { top: number; bottom: number; left: number; right: number; width: number }
  viewport: { width: number; height: number }
  anchor: PopoverAnchor
  /** 期望宽度（会 clamp 到视口内）。 */
  width: number
  /** 内容高度（已渲染；未渲染时传 0 使用 320 兜底）。 */
  height: number
  gap?: number
}

export interface PopoverPlacement {
  top: number
  left: number
  width: number
}

export function computePopoverPlacement(input: PopoverPlacementInput): PopoverPlacement {
  const { trigger, viewport, anchor, width, height } = input
  const GAP = input.gap ?? 8
  const vw = viewport.width
  const vh = viewport.height
  const W = Math.min(width, vw - 16)
  // 内容高度受 CSS max-height 约束；未渲染时用 320 兜底。绝不高出视口。
  const h = Math.min(height > 0 ? height : 320, vh - 16)
  const spaceAbove = trigger.top - GAP
  const spaceBelow = vh - trigger.bottom - GAP
  let top: number
  let left: number
  if (anchor === "below-center") {
    if (spaceBelow >= h) {
      top = trigger.bottom + 2
    } else {
      top = Math.max(8, trigger.top - GAP - h)
    }
    left = trigger.left + trigger.width / 2 - W / 2
  } else {
    if (spaceAbove >= h) {
      top = trigger.top - GAP - h
    } else if (spaceBelow >= h) {
      top = trigger.bottom + GAP
    } else if (spaceAbove >= spaceBelow) {
      top = Math.max(8, trigger.top - GAP - h)
    } else {
      top = Math.min(vh - 8 - h, trigger.bottom + GAP)
    }
    left = anchor === "tr" ? trigger.right - W : trigger.left
  }
  if (left < 8) left = 8
  if (left + W > vw - 8) left = vw - 8 - W
  return { top, left, width: W }
}
