// 工作台布局默认值（spec 2026-10-22-workbench-layout 已决项）：
// 工作台默认打开（用户显式关闭过则尊重）；默认 tab = files；chat 定宽 340(280-480)。
export const CHAT_WIDTH = { default: 340, min: 280, max: 480 } as const

export function defaultDockOpen(stored: string | null): boolean {
  return stored === null ? true : stored === "1"
}

export function defaultDockTab(stored: string | null): string {
  return stored ?? "files"
}

export function clampChatWidth(w: number): number {
  return Math.min(CHAT_WIDTH.max, Math.max(CHAT_WIDTH.min, w))
}
