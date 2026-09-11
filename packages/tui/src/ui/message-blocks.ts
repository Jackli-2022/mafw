import { truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'
import type { ChatTurn } from '../store/chat-store.ts'

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

/**
 * 把一个 ChatTurn 渲染为 ANSI 行（每行 ≤ width）。
 * Tool part: running 只渲染一行摘要；terminal state 附加输出行（mem_yw2lqt 教训）。
 */
export function turnToLines(turn: ChatTurn, width: number): string[] {
  const lines: string[] = []
  for (const part of turn.parts) {
    if (part.type === 'tool') {
      const icon = part.state === 'completed' ? theme.ok('✓')
        : part.state === 'error' ? theme.err('✗') : theme.warn('…')
      const firstLine = stripAnsi(part.text).split('\n')[0] ?? ''
      lines.push(truncateToWidth(
        `${theme.dim('▸ ')}${theme.accent(part.toolName ?? 'tool')} ${icon} ${theme.dim(firstLine)}`,
        width,
      ))
      if (part.state !== 'running') {
        for (const l of stripAnsi(part.text).split('\n').slice(1)) {
          if (!l) continue
          for (const w of wrapTextWithAnsi(l, Math.max(4, width - 4))) {
            lines.push(truncateToWidth(`  ${theme.dim(w)}`, width))
          }
        }
      }
    } else if (part.type === 'reasoning') {
      for (const raw of stripAnsi(part.text).split('\n')) {
        for (const w of wrapTextWithAnsi(raw, Math.max(4, width - 4))) {
          lines.push(truncateToWidth(theme.dim(`  ⠿ ${w}`), width))
        }
      }
    } else {
      const isUser = turn.role === 'user'
      const body = stripAnsi(part.text).split('\n').flatMap((l) => wrapTextWithAnsi(l, Math.max(4, width - 2)))
      for (let i = 0; i < body.length; i++) {
        // 只给首行加前缀；续行缩进对齐
        const prefix = isUser ? (i === 0 ? `${theme.accent('>')} ` : '  ') : '  '
        lines.push(truncateToWidth(`${prefix}${body[i]}`, width))
      }
    }
  }
  if (turn.role === 'assistant' && !turn.done) lines.push(theme.dim('  …'))
  return lines
}
