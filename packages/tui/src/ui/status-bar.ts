import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

export interface StatusState {
  project?: string
  session?: string
  conn: 'ok' | 'reconnecting' | 'down'
  hint?: string
}

export class StatusBar implements Component {
  private state: StatusState = { conn: 'down' }
  setState(s: StatusState) { this.state = s }
  invalidate() { /* 状态即渲染源，无缓存 */ }
  render(width: number): string[] {
    const s = this.state
    const conn = s.conn === 'ok' ? theme.ok('connected')
      : s.conn === 'reconnecting' ? theme.warn('reconnecting') : theme.err('disconnected')
    const parts = [s.project ?? '-', s.session ? s.session.slice(0, 12) : '-', conn, s.hint ?? '1-4:tab q:quit ?:help']
    return [truncateToWidth(theme.dim(parts.join('  ·  ')), width)]
  }
}
