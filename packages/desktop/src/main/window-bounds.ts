/** 主窗口尺寸下限：低于此值布局会压坏（自定义 titlebar 38 + chat header 38 + composer ~98 + 边距）。 */
export const MAIN_WINDOW_MIN_WIDTH = 720
export const MAIN_WINDOW_MIN_HEIGHT = 480

export interface RestoredWindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface MainWindowOptions {
  x?: number
  y?: number
  width: number
  height: number
  minWidth: number
  minHeight: number
}

/**
 * 由 electron-window-state 恢复的尺寸构造 BrowserWindow 尺寸选项：
 * 强制下限、把恢复到的过小尺寸抬到下限、缺省坐标不下发（避免 NaN）。
 */
export function mainWindowOptions(state: RestoredWindowBounds): MainWindowOptions {
  const opts: MainWindowOptions = {
    width: Math.max(MAIN_WINDOW_MIN_WIDTH, Math.floor(state.width)),
    height: Math.max(MAIN_WINDOW_MIN_HEIGHT, Math.floor(state.height)),
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
  }
  if (typeof state.x === "number" && Number.isFinite(state.x)) opts.x = state.x
  if (typeof state.y === "number" && Number.isFinite(state.y)) opts.y = state.y
  return opts
}
