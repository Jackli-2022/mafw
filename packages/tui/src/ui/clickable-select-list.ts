import { SelectList, type Component, type SelectItem } from '@earendil-works/pi-tui'

/**
 * SelectList 鼠标包装：点击可见行 = 选中并触发 onSelect（opencode "click accepts" 语义）。
 * filteredItems / selectedIndex / maxVisible 为 pi-tui TS-private（运行时公有），
 * 版本锁定 ^0.84.1。
 */
export class ClickableSelectList implements Component {
  /** 被包装的 SelectList（公开只读：调用方挂 onSelect/onCancel 用）。 */
  readonly list: SelectList
  constructor(list: SelectList) { this.list = list }

  render(width: number): string[] { return this.list.render(width) }
  invalidate(): void { this.list.invalidate() }
  handleInput(data: string): void { this.list.handleInput(data) }

  handleMouseClick(_col: number, row: number): boolean {
    const items = (this.list as any).filteredItems as SelectItem[]
    if (!Array.isArray(items) || items.length === 0) return false
    const selectedIndex = (this.list as any).selectedIndex as number
    const maxVisible = (this.list as any).maxVisible as number
    // 与 SelectList.render 相同的可见窗口计算（含滚动指示行的存在性判断）
    const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), items.length - maxVisible))
    const visible = Math.min(maxVisible, items.length - start)
    if (row < 0 || row >= visible) return false
    const item = items[start + row]
    if (!item) return false
    this.list.setSelectedIndex(start + row)
    this.list.onSelect?.(item)
    return true
  }
}

/** 带 header 的点击 overlay：header 行点击无效，列表行点击激活（header 行数以最近 render 为准）。 */
export class HeaderSelectOverlay implements Component {
  private header: Component
  private wrapper: ClickableSelectList
  private headerLines = 1
  constructor(header: Component, list: SelectList) {
    this.header = header
    this.wrapper = new ClickableSelectList(list)
  }

  render(width: number): string[] {
    const head = this.header.render(width)
    this.headerLines = head.length
    return [...head, ...this.wrapper.render(width)]
  }

  invalidate(): void {
    this.header.invalidate()
    this.wrapper.invalidate()
  }

  handleInput(data: string): void { this.wrapper.handleInput(data) }

  handleMouseClick(col: number, row: number): boolean {
    return this.wrapper.handleMouseClick(col, row - this.headerLines)
  }
}
