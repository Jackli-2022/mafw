import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

export interface QueueOverlayDeps {
  getItems(): string[]
  onTakeBack(index: number): void
  onDrop(index: number): void
  onClose(): void
  requestRender(): void
}

/**
 * /queue 排队消息管理 overlay（Hermes /queue list/rm 语义 + Claude take-back）：
 * j/k 或 ↑/↓ 移动选择，Enter 收回该条进编辑框，d 丢弃，Esc 关闭。
 */
export class QueueOverlay implements Component {
  private selected = 0
  private deps: QueueOverlayDeps
  constructor(deps: QueueOverlayDeps) { this.deps = deps }

  invalidate() { /* 状态即渲染源 */ }

  render(width: number): string[] {
    const items = this.deps.getItems()
    const lines = [theme.accent('排队消息'), '']
    if (items.length === 0) {
      lines.push(theme.dim('  （队列为空——busy 期间发送的消息会排队）'))
      lines.push('')
      lines.push(theme.dim('  Esc 关闭'))
      return lines
    }
    items.forEach((text, i) => {
      const mark = i === this.selected ? theme.accent('› ') : '  '
      const preview = text.length > 60 ? `${text.slice(0, 57)}...` : text
      lines.push(truncateToWidth(`${mark}${i + 1}. ${preview}`, width))
    })
    lines.push('')
    lines.push(theme.dim('  Enter 收回编辑 · d 丢弃 · Esc 关闭'))
    return lines
  }

  handleInput(data: string): void {
    const items = this.deps.getItems()
    if (items.length === 0) {
      this.deps.onClose()
      return
    }
    if (data === 'j' || data === '\x1b[B') {
      this.selected = Math.min(items.length - 1, this.selected + 1)
      this.deps.requestRender()
      return
    }
    if (data === 'k' || data === '\x1b[A') {
      this.selected = Math.max(0, this.selected - 1)
      this.deps.requestRender()
      return
    }
    if (data === '\r' || data === '\n') {
      this.deps.onTakeBack(this.selected)
      this.deps.onClose() // 收回即完成
      return
    }
    if (data === 'd') {
      this.deps.onDrop(this.selected)
      this.selected = Math.min(this.selected, Math.max(0, this.deps.getItems().length - 1))
      return
    }
    if (data === '\x1b' || data === '\x03') {
      this.deps.onClose()
      return
    }
  }
}
