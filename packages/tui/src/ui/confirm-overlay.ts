import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

export type ConfirmAnswer = 'once' | 'always' | 'cancel'

export interface ConfirmOverlayDeps {
  title: string
  description?: string
  onAnswer(mode: ConfirmAnswer): void
  requestRender(): void
}

/**
 * 破坏性命令确认 overlay（Hermes 三选：本次执行 / 本会话总是执行 / 取消）。
 * Enter=once、l=always、d/c/Esc=取消；j/k 移动选择。
 */
export class ConfirmOverlay implements Component {
  private selected = 0
  private deps: ConfirmOverlayDeps
  constructor(deps: ConfirmOverlayDeps) { this.deps = deps }

  invalidate() { /* 状态即渲染源 */ }

  private options(): { key: ConfirmAnswer; label: string }[] {
    return [
      { key: 'once', label: '本次执行' },
      { key: 'always', label: '本会话总是执行' },
      { key: 'cancel', label: '取消' },
    ]
  }

  render(width: number): string[] {
    const lines = [truncateToWidth(theme.warn(this.deps.title), width)]
    if (this.deps.description) lines.push(truncateToWidth(theme.dim(this.deps.description), width))
    lines.push('')
    this.options().forEach((o, i) => {
      const mark = i === this.selected ? theme.accent('› ') : '  '
      lines.push(truncateToWidth(`${mark}${o.label}`, width))
    })
    lines.push('')
    lines.push(theme.dim('  Enter 执行 · l 总是 · d 取消 · j/k 选择'))
    return lines
  }

  handleInput(data: string): void {
    const opts = this.options()
    if (data === '\r' || data === '\n') {
      this.deps.onAnswer(opts[this.selected].key)
      return
    }
    if (data === 'l') { this.deps.onAnswer('always'); return }
    if (data === 'd' || data === 'c' || data === '\x1b' || data === '\x03') { this.deps.onAnswer('cancel'); return }
    if (data === 'j' || data === '\x1b[B') {
      this.selected = Math.min(opts.length - 1, this.selected + 1)
      this.deps.requestRender()
      return
    }
    if (data === 'k' || data === '\x1b[A') {
      this.selected = Math.max(0, this.selected - 1)
      this.deps.requestRender()
    }
  }
}
