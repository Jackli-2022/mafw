// Bottom-right floating notification placement. Pure math: the caller passes
// the target display work area; the window never leaves it.

export interface NotificationRect {
  x: number
  y: number
  width: number
  height: number
}

export interface NotificationPlacementInput {
  workArea: NotificationRect
  count: number
  cardWidth?: number
  cardHeight?: number
  gap?: number
  margin?: number
  maxVisible?: number
}

export const NOTIFICATION_CARD_WIDTH = 360
export const NOTIFICATION_CARD_HEIGHT = 92
// 卡片零间距堆叠：透明窗口尺寸=卡片栈，任何窗口内非卡片像素都会吃掉点击
// （always-on-top + focusable:false），间隙是死区；分隔靠卡片自身边框。
export const NOTIFICATION_GAP = 0
export const NOTIFICATION_MARGIN = 16
export const NOTIFICATION_MAX_VISIBLE = 3

export function notificationWindowBounds(input: NotificationPlacementInput): NotificationRect {
  const margin = input.margin ?? NOTIFICATION_MARGIN
  const cardWidth = input.cardWidth ?? NOTIFICATION_CARD_WIDTH
  const cardHeight = input.cardHeight ?? NOTIFICATION_CARD_HEIGHT
  const gap = input.gap ?? NOTIFICATION_GAP
  const maxVisible = input.maxVisible ?? NOTIFICATION_MAX_VISIBLE
  const count = Number.isFinite(input.count) ? Math.max(0, Math.trunc(input.count)) : 0
  const visible = Math.min(count, maxVisible)

  const width = Math.min(cardWidth, Math.max(0, input.workArea.width - margin * 2))
  const rawHeight = visible === 0 ? 0 : visible * cardHeight + (visible - 1) * gap
  const height = Math.min(rawHeight, Math.max(0, input.workArea.height - margin * 2))

  return {
    x: Math.round(input.workArea.x + input.workArea.width - margin - width),
    y: Math.round(input.workArea.y + input.workArea.height - margin - height),
    width,
    height,
  }
}
