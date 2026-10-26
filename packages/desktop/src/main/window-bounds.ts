/** 主窗口尺寸下限：46 rail + 520 ChatView + 520 右工作台 + 边框。 */
export const MAIN_WINDOW_MIN_WIDTH = 1088
export const MAIN_WINDOW_MIN_HEIGHT = 720
export const MAIN_WINDOW_DEFAULT_WIDTH = 1600
export const MAIN_WINDOW_DEFAULT_HEIGHT = 1000
export const MAIN_WINDOW_WORKAREA_MARGIN = 80

/** 首次启动的默认窗口：目标 1600×1000，按主屏工作区收缩；不小于最小尺寸。 */
export function fitDefaultWindowSize(workArea: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.max(
      MAIN_WINDOW_MIN_WIDTH,
      Math.min(MAIN_WINDOW_DEFAULT_WIDTH, workArea.width - MAIN_WINDOW_WORKAREA_MARGIN),
    ),
    height: Math.max(
      MAIN_WINDOW_MIN_HEIGHT,
      Math.min(MAIN_WINDOW_DEFAULT_HEIGHT, workArea.height - MAIN_WINDOW_WORKAREA_MARGIN),
    ),
  }
}

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
