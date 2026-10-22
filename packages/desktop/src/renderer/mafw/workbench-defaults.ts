// 工作台布局默认值（spec 2026-10-22-workbench-layout + C 案比例）：
// 工作台默认打开（用户显式关闭过则尊重）；默认 tab = files；
// chat 默认 = 38.2% 可用宽（黄金分割）clamp 360-520；可拖范围 320-560。
export const CHAT_WIDTH = { min: 320, max: 560 } as const

const CHAT_DEFAULT_RATIO = 0.382
const CHAT_DEFAULT_MIN = 360
const CHAT_DEFAULT_MAX = 520

export function defaultDockOpen(stored: string | null): boolean {
  return stored === null ? true : stored === "1"
}

export function defaultDockTab(stored: string | null): string {
  return stored ?? "files"
}

export function defaultChatWidth(availableWidth: number): number {
  return Math.min(CHAT_DEFAULT_MAX, Math.max(CHAT_DEFAULT_MIN, Math.round(availableWidth * CHAT_DEFAULT_RATIO)))
}

export function clampChatWidth(w: number): number {
  return Math.min(CHAT_WIDTH.max, Math.max(CHAT_WIDTH.min, w))
}
