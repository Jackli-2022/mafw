import { Box, type Component, type TUI } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

/**
 * 弹层不透明浮面（OverlaySurface + showModal）。
 *
 * 根因：pi-tui 的 compositeOverlays 把 overlay 文本逐行直叠到底层屏幕上
 * （compositeTuiLine 以裸空格补位、未覆盖处保留底层内容），overlay 组件
 * 若只渲染文本行，弹窗就是"透明"的——transcript 从 confirm / picker /
 * 帮助等所有弹层后面透出来。
 *
 * 修复：统一经 showModal 挂载——内容包进 Box（padX/padY 内边距 + theme.floatBg
 * 整行背景填充），弹窗区域每一格都由不透明背景覆盖。
 *
 * 转发面（pi-tui 侧按组件对象路由，包装必须透明）：
 * - render/invalidate → Box
 * - handleInput / wantsKeyRelease → inner（focusedComponent = 包装对象）
 * - handleMouseClick(col,row) → inner，坐标扣除内边距（clickable-tui 命中契约）
 */
export class OverlaySurface implements Component {
  private readonly box: Box
  private readonly padX: number
  private readonly padY: number
  /** 被包装的内容组件（测试/调试可检视）。 */
  readonly inner: Component

  constructor(inner: Component, padX = 1, padY = 1) {
    this.inner = inner
    this.padX = padX
    this.padY = padY
    this.box = new Box(padX, padY, (s: string) => theme.floatBg(s))
    this.box.addChild(inner)
  }

  render(width: number): string[] {
    return this.box.render(width)
  }

  invalidate(): void {
    // Box.invalidate 会级联到 children（含 inner），不要直调以免重复
    this.box.invalidate()
  }

  handleInput(data: string): void {
    const anyInner = this.inner as { handleInput?: (data: string) => void }
    anyInner.handleInput?.(data)
  }

  get wantsKeyRelease(): boolean {
    return (this.inner as { wantsKeyRelease?: boolean })?.wantsKeyRelease === true
  }

  handleMouseClick(col: number, row: number): boolean {
    const anyInner = this.inner as { handleMouseClick?: (col: number, row: number) => boolean | void }
    if (typeof anyInner.handleMouseClick !== 'function') return false
    return anyInner.handleMouseClick(col - this.padX, row - this.padY) === true
  }
}

export type ShowModalOptions = Parameters<TUI['showOverlay']>[1]

/** 全部弹层的统一挂载入口：包上不透明浮面再 showOverlay。 */
export function showModal(tui: TUI, component: Component, options?: ShowModalOptions) {
  return tui.showOverlay(new OverlaySurface(component), options)
}
