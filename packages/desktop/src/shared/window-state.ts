// 窗口“已展开”语义（跨平台）：最大化或全屏都算大窗口。
// main 用它计算 window-maximized-changed 载荷；renderer 侧语义一致。
export function windowExpanded(maximized: boolean, fullscreen: boolean): boolean {
  return maximized || fullscreen
}
