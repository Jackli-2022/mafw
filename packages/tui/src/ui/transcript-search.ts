import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import type { ChatTurn } from '../store/chat-store.ts'
import { theme } from '../theme.ts'

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

export interface TranscriptSearchDeps {
  getTurns(): ChatTurn[]
  onJump(turnIndex: number): void
  onClose(): void
  requestRender(): void
}

interface Match {
  turnIndex: number
  role: 'user' | 'assistant'
  snippet: string
}

const MAX_RESULTS = 8
const SNIPPET_WIDTH = 56

/**
 * 会话内搜索 overlay（Claude transcript 搜索的轻量版）：
 * 输入即过滤（大小写不敏感），↑/↓ 选择，Enter 跳转到该 turn（滚动主 transcript），Esc 关闭。
 */
export class TranscriptSearchOverlay implements Component {
  private query = ''
  private selected = 0
  private deps: TranscriptSearchDeps
  constructor(deps: TranscriptSearchDeps) { this.deps = deps }

  invalidate() { /* 状态即渲染源 */ }

  private matches(): Match[] {
    const q = this.query.trim().toLowerCase()
    if (!q) return []
    const out: Match[] = []
    const turns = this.deps.getTurns()
    for (let i = 0; i < turns.length && out.length < MAX_RESULTS; i++) {
      const t = turns[i]
      for (const p of t.parts) {
        if (p.type === 'tool') continue
        const text = stripAnsi(p.text)
        const at = text.toLowerCase().indexOf(q)
        if (at < 0) continue
        const start = Math.max(0, at - 12)
        const snippet = `${start > 0 ? '…' : ''}${text.slice(start, start + SNIPPET_WIDTH).replace(/\n/g, ' ')}`
        out.push({ turnIndex: i, role: t.role, snippet })
        break
      }
    }
    return out
  }

  render(width: number): string[] {
    const lines: string[] = []
    lines.push(truncateToWidth(`${theme.accent('搜索: ')}${this.query}${theme.dim('▏')}`, width))
    const ms = this.matches()
    if (this.query.trim() === '') {
      lines.push(theme.dim('  输入关键词过滤会话内容'))
    } else if (ms.length === 0) {
      lines.push(theme.dim('  无匹配'))
    } else {
      ms.forEach((m, i) => {
        const mark = i === this.selected ? theme.accent('› ') : '  '
        const role = m.role === 'user' ? theme.accent('你') : theme.dim('AI')
        lines.push(truncateToWidth(`${mark}${role} ${theme.dim(m.snippet)}`, width))
      })
    }
    lines.push(theme.dim('  ↑/↓ 选择 · Enter 跳转 · Esc 关闭'))
    return lines
  }

  handleInput(data: string): void {
    if (data === '\x1b' || data === '\x03') {
      this.deps.onClose()
      return
    }
    if (data === '\r' || data === '\n') {
      const ms = this.matches()
      const m = ms[this.selected]
      if (m) this.deps.onJump(m.turnIndex)
      this.deps.onClose()
      return
    }
    if (data === '\x1b[A' || data === 'k') {
      this.selected = Math.max(0, this.selected - 1)
      this.deps.requestRender()
      return
    }
    if (data === '\x1b[B' || data === 'j') {
      this.selected = Math.min(this.matches().length - 1, this.selected + 1)
      this.deps.requestRender()
      return
    }
    if (data === '\x7f' || data === '\b') {
      this.query = this.query.slice(0, -1)
      this.selected = 0
      this.deps.requestRender()
      return
    }
    // 单个可打印字符（排除带修饰键的转义序列）
    if (data.length === 1 && data >= ' ') {
      this.query += data
      this.selected = 0
      this.deps.requestRender()
      return
    }
  }
}
