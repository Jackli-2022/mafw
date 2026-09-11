import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
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
  setActive(id: TabId) { this.active = id }
  setConnected(ok: boolean) { this.connected = ok }
  invalidate() { /* 状态即渲染源，无缓存 */ }
  render(width: number): string[] {
    const tabs = TABS.map((t, i) => {
      const label = `${i + 1}:${t.label}`
      return t.id === this.active ? theme.active(label) : theme.inactive(label)
    }).join(theme.dim('│'))
    const conn = this.connected ? theme.ok('●') : theme.err('●')
    return [truncateToWidth(`${tabs} ${theme.dim('gateway:')}${conn}`, width)]
  }
}
