import { TuiAltScreen, type Component } from '@earendil-works/pi-tui'

/**
 * 组件级鼠标点击派发（pi-tui 之上的一层，不改依赖包）。
 *
 * pi-tui 的 TuiAltScreen 已内置：滚轮路由 ScrollView、滚动条拖拽、拖选复制、
 * OSC8 URL 点击——但左键点击全部按"选区锚点"处理，没有组件命中派发。
 * 本模块以实例补丁方式在 handleSelectionMouseEvent 前插入一层：
 * 左键按下（非拖动）→ overlay 模态命中 → 布局树命中（由深到浅）→ 未命中回落选区逻辑。
 *
 * 命中契约：组件实现可选 `handleMouseClick(col, row)`（相对组件自身左上角，0-based），
 * 返回 true 表示已消费（不触发选区）。
 *
 * 注意：resolveOverlayLayout / getTopmostVisibleOverlay / currentLayout 为 pi-tui
 * TS-private（运行时公有）——版本锁定 ^0.84.1，全部 typeof 门控 fail-open。
 */

interface Rect { x: number; y: number; width: number; height: number }
interface LayoutBox {
  component?: Component
  rect?: Rect
  children?: LayoutBox[]
}
export interface MouseClickable {
  handleMouseClick?(col: number, row: number): boolean | void
}

export function enableClickDispatch(tui: TuiAltScreen): void {
  const self = tui as any
  if (typeof self.handleSelectionMouseEvent !== 'function') return
  const original = self.handleSelectionMouseEvent.bind(tui)
  self.handleSelectionMouseEvent = (event: { button: number; x: number; y: number; release: boolean }) => {
    // 左键按下、无拖动位：先走组件点击派发
    if (!event.release && (event.button & 3) === 0 && (event.button & 32) === 0) {
      if (dispatchClick(tui, event.x, event.y)) return
    }
    original(event)
  }
}

function dispatchClick(tui: TuiAltScreen, x: number, y: number): boolean {
  try {
    const self = tui as any
    const top = typeof self.getTopmostVisibleOverlay === 'function'
      ? self.getTopmostVisibleOverlay()
      : undefined
    if (top) return dispatchOverlayClick(tui, top, x, y)
    return dispatchLayoutClick(tui, x, y)
  } catch {
    return false
  }
}

/** overlay 模态：命中 overlay 内 → 派发；overlay 外 → 吞掉（不落底、不触发选区）。 */
function dispatchOverlayClick(tui: TuiAltScreen, entry: any, x: number, y: number): boolean {
  const self = tui as any
  const resolve = self.resolveOverlayLayout
  if (typeof resolve !== 'function') return false
  const termWidth = tui.terminal.columns
  const termHeight = tui.terminal.rows
  const { width, maxHeight } = resolve.call(tui, entry.options, 0, termWidth, termHeight)
  let lines: string[] = entry.component?.render(width) ?? []
  if (maxHeight !== undefined && lines.length > maxHeight) lines = lines.slice(0, maxHeight)
  const { row, col } = resolve.call(tui, entry.options, lines.length, termWidth, termHeight)
  if (x >= col && x < col + width && y >= row && y < row + lines.length) {
    const comp = entry.component as MouseClickable
    if (comp && typeof comp.handleMouseClick === 'function') {
      return comp.handleMouseClick(x - col, y - row) === true
    }
  }
  return true
}

/** 布局树命中：包含点的 box 由深到浅派发，返回 true 即停。 */
function dispatchLayoutClick(tui: TuiAltScreen, x: number, y: number): boolean {
  const root = (tui as any).currentLayout?.root as LayoutBox | undefined
  if (!root) return false
  const hits: { comp: Component; rect: Rect; depth: number }[] = []
  const visit = (box: LayoutBox, depth: number): void => {
    const r = box?.rect
    if (r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height && box.component) {
      hits.push({ comp: box.component, rect: r, depth })
    }
    for (const child of box?.children ?? []) visit(child, depth + 1)
  }
  visit(root, 0)
  hits.sort((a, b) => b.depth - a.depth)
  for (const hit of hits) {
    const comp = hit.comp as MouseClickable
    if (typeof comp.handleMouseClick === 'function') {
      if (comp.handleMouseClick!(x - hit.rect.x, y - hit.rect.y) === true) return true
    }
  }
  return false
}
