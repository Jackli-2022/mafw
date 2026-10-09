import type { Component, TUI } from '@earendil-works/pi-tui'

const ANSI_RE = /\x1b\[[0-9;]*m/g
const BORDER_CHARS = new Set(['─', '↑', '↓', ' ', 'm', 'o', 'r', 'e'])

/** 判断一行是否为 pi-tui Editor 的边框行（含滚动指示 `↑ N more`）——非文本内容。 */
export function isBorderLine(line: string): boolean {
  const s = line.replace(ANSI_RE, '').trim()
  if (!s || !s.includes('─')) return false
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') continue
    if (!BORDER_CHARS.has(ch)) return false
  }
  return true
}

/**
 * 包住 pi-tui Editor：矮窗口下 VStack 会用 `slice(0, allocated)` 硬切，
 * 导致底边框消失（开口箱）或补全被静默裁掉。本组件把渲染产出的总行数钳到
 * 终端可给的高度预算内，并保证顶/底边框保留（闭合），优先保留已输入内容行，
 * 其次保留补全项。
 *
 * 预算 = max(3, rows - 3)：留出 TabStrip(1) + StatusBar(1) + 内容区滚动兜底(1)。
 */
export class EditorFrame implements Component {
  private inner: Component
  private tui: TUI
  constructor(inner: Component, tui: TUI) {
    this.inner = inner
    this.tui = tui
  }

  invalidate(): void { this.inner.invalidate?.() }

  private budget(): number {
    const rows = this.tui.terminal?.rows ?? 24
    return Math.max(3, rows - 3)
  }

  render(width: number): string[] {
    const raw = this.inner.render(width)
    const budget = this.budget()
    if (raw.length <= budget) return raw

    let bottomIdx = -1
    for (let i = raw.length - 1; i >= 0; i--) {
      if (isBorderLine(raw[i])) { bottomIdx = i; break }
    }
    if (bottomIdx <= 0) return raw.slice(0, budget)

    const top = raw[0]
    const bottom = raw[bottomIdx]
    const content = raw.slice(1, bottomIdx)
    const autocomplete = raw.slice(bottomIdx + 1)

    const room = Math.max(0, budget - 2)
    const keepContent = content.slice(content.length - Math.min(content.length, Math.max(1, room)))
    const keepAc = autocomplete.slice(0, Math.max(0, room - keepContent.length))
    return [top, ...keepContent, bottom, ...keepAc]
  }
}
