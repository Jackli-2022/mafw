import {
  Container, Input, Text, matchesKey, Key,
  type Component, type Focusable, type TUI,
} from '@earendil-works/pi-tui'
import type { MafwClient } from '@mafw/sdk'
import { MemoryStore } from '../store/memory-store.ts'
import { theme } from '../theme.ts'

function memoryLine(item: { id: string; type: string; primary_abstraction: string; energy: number }, selected: boolean): string {
  const mark = selected ? '› ' : '  '
  return `${mark}[${item.type}] ${item.primary_abstraction} ${theme.dim(`E:${item.energy.toFixed(1)}`)} ${theme.dim(item.id.slice(-6))}`
}

/** Memory 面板：Input 搜索框 + 结果列表 + 便签板区块（refresh() 由 store.onChange 驱动）。 */
export class MemoryTab extends Container implements Focusable {
  private searchInput = new Input()
  private list = new Container()
  private selected = 0
  private deps: {
    tui: TUI
    store: MemoryStore
    client: MafwClient
    setStatus: (patch: { hint?: string }) => void
    setEditing: (v: boolean) => void
  }
  private _focused = false

  get focused() { return this._focused }
  set focused(v: boolean) { this._focused = v; this.searchInput.focused = v } // IME 传播

  get inputFocused() { return this._focused }

  constructor(deps: MemoryTab['deps']) {
    super()
    this.deps = deps
    this.searchInput.onSubmit = (text) => {
      const q = text.trim()
      if (q) void this.deps.store.search(q)
    }
    this.addChild(this.searchInput)
    this.addChild(this.list)
    void this.deps.store.refreshSticky()
    this.refresh()
  }

  invalidate() { this.refresh() }

  private get resultCount() { return this.deps.store.results.length }
  private get stickyCount() { return this.deps.store.sticky.length }
  private get totalSelectable() { return this.resultCount + this.stickyCount }

  /** 由 store.onChange / invalidate 触发：重建列表文本块。 */
  refresh(): void {
    const { store } = this.deps
    const lines: string[] = []
    const budget = store.budget ? `📝 ${store.sticky.length}/${store.budget.max}` : ''
    lines.push(theme.accent('搜索: ') + (this._focused ? theme.dim('输入后 Enter 检索 · Esc 到列表') : theme.dim('i 聚焦输入框')) + theme.dim(`  ·  ${budget}`))
    lines.push(theme.accent(`检索结果 (${store.results.length})`))
    if (store.results.length === 0) lines.push(theme.dim('  （空——在上方输入关键词）'))
    store.results.forEach((u, i) => lines.push(memoryLine(u, i === this.selected)))
    if (store.sticky.length > 0) {
      lines.push('')
      lines.push(theme.warn(`📝 便签板 (${store.sticky.length}) · u 下架`))
      store.sticky.forEach((n, i) => {
        const idx = this.resultCount + i
        lines.push(memoryLine(n, idx === this.selected))
      })
    }
    this.list.clear()
    this.list.addChild(new Text(lines.join('\n'), 0, 0))
    this.deps.tui.requestRender()
  }

  /** 鼠标点击行选中（Enter 仍负责看全文 / u 下架；行映射与 refresh() 同构）。 */
  handleMouseClick(_col: number, row: number): boolean {
    const rc = this.resultCount
    if (rc > 0 && row >= 2 && row < 2 + rc) { // 提示行 + 结果 header 之后
      this.selected = row - 2
      this.refresh()
      return true
    }
    const sc = this.stickyCount
    if (sc > 0) {
      const stickyStart = 2 + Math.max(rc, 1) + 2 // (结果区|占位) + 空行 + 便签头
      if (row >= stickyStart && row < stickyStart + sc) {
        this.selected = rc + (row - stickyStart)
        this.refresh()
        return true
      }
    }
    return false
  }

  /** 列表态按键（Input 聚焦时返回 false 让输入框处理）。 */
  handleTabKey(data: string): boolean {
    if (this._focused) return false
    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1)
      this.refresh()
      return true
    }
    if (matchesKey(data, Key.down)) {
      this.selected = Math.min(this.totalSelectable - 1, this.selected + 1)
      this.refresh()
      return true
    }
    if (matchesKey(data, Key.enter)) {
      const r = this.selected
      const s = this.deps.store
      if (r < s.results.length) this.showFull(s.results[r])
      else if (r - s.results.length < s.sticky.length) this.showFull(s.sticky[r - s.results.length])
      return true
    }
    if (data === 'u' && this.selected >= this.resultCount && this.selected - this.resultCount < this.stickyCount) {
      const note = this.deps.store.sticky[this.selected - this.resultCount]
      if (note) {
        void this.deps.store.unstick(note.id)
          .then(() => this.deps.setStatus({ hint: theme.ok('已下架便签') }))
        return true
      }
    }
    if (data === 'i' || data === '/') {
      this.setSearchFocus(true)
      return true
    }
    return false
  }

  /** 聚焦/失焦搜索框。 */
  setSearchFocus(on: boolean): void {
    this._focused = on
    this.searchInput.focused = on
    this.deps.setEditing(on)
    this.deps.tui.setFocus(on ? this.searchInput : null)
    this.refresh()
  }

  blurSearch(): void {
    if (this._focused) this.setSearchFocus(false)
  }

  private showFull(item: { id: string; type: string; primary_abstraction: string; memory_value: string; energy: number }): void {
    const body = [
      `${theme.dim('id:')} ${item.id}  ${theme.dim('type:')} ${item.type}  ${theme.dim('E:')} ${item.energy.toFixed(2)}`,
      '',
      item.primary_abstraction,
      '',
      item.memory_value || theme.dim('(空)'),
    ].join('\n')
    const overlay = this.deps.tui.showOverlay(new Text(body, 1, 1), { width: '80%', maxHeight: '70%', anchor: 'center' })
    const close = () => { off(); overlay.hide() }
    const off = this.deps.tui.addInputListener((data) => {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
        close()
        return { consume: true }
      }
      return undefined
    })
  }
}
