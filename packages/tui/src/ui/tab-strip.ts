import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

export type TabId = 'chat' | 'goals' | 'memory' | 'triage'
export const TABS: { id: TabId; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'goals', label: 'Goals' },
  { id: 'memory', label: 'Memory' },
  { id: 'triage', label: 'Triage' },
]

export class TabStrip implements Component {
  private active: TabId = 'chat'
  private connected = false
  /** 点击 tab 切换（app 注入；与键盘 1-4 同路径）。 */
  onTabClick?: (id: TabId) => void
  setActive(id: TabId) { this.active = id }
  setConnected(ok: boolean) { this.connected = ok }
  invalidate() { /* 状态即渲染源，无缓存 */ }
  private segment(i: number): string {
    const t = TABS[i]
    const label = `${i + 1}:${t.label}`
    return t.id === this.active ? theme.active(label) : theme.inactive(label)
  }
  /** 列位置 → tab（分隔符与 gateway 指示区不可点）。 */
  clickAt(col: number): TabId | null {
    let x = 0
    for (let i = 0; i < TABS.length; i++) {
      const w = visibleWidth(this.segment(i))
      if (col >= x && col < x + w) return TABS[i].id
      x += w + 1 // │ 分隔符宽 1
    }
    return null
  }
  handleMouseClick(col: number, _row: number): boolean {
    const id = this.clickAt(col)
    if (!id) return false
    this.onTabClick?.(id)
    return true
  }
  render(width: number): string[] {
    const tabs = TABS.map((_, i) => this.segment(i)).join(theme.dim('│'))
    const conn = this.connected ? theme.ok('●') : theme.err('●')
    return [truncateToWidth(`${tabs} ${theme.dim('gateway:')}${conn}`, width)]
  }
}
