import { truncateToWidth, wrapTextWithAnsi, Markdown } from '@earendil-works/pi-tui'
import type { MarkdownTheme } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../theme.ts'
import type { ChatTurn } from '../store/chat-store.ts'

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

/** Markdown 主题（对齐 pi coding agent getMarkdownTheme 的简化版，无 cli-highlight 依赖）。 */
export const markdownTheme: MarkdownTheme = {
  heading: (t) => chalk.bold.cyan(t),
  link: (t) => chalk.cyan.underline(t),
  linkUrl: (t) => chalk.gray(t),
  code: (t) => chalk.yellow(t),
  codeBlock: (t) => chalk.white(t),
  codeBlockBorder: (t) => chalk.gray(t),
  quote: (t) => chalk.gray(t),
  quoteBorder: (t) => chalk.gray(t),
  hr: (t) => chalk.gray(t),
  listBullet: (t) => chalk.cyan(t),
  bold: (t) => chalk.bold(t),
  italic: (t) => chalk.italic(t),
  underline: (t) => chalk.underline(t),
  strikethrough: (t) => chalk.strikethrough(t),
}

/** diff 风格行着色：+ 绿、- 红、@@ 青；其余 dim。 */
export function colorDiffLine(l: string): string {
  if (l.startsWith('+++') || l.startsWith('---')) return theme.dim(l)
  if (l.startsWith('+')) return theme.ok(l)
  if (l.startsWith('-')) return theme.err(l)
  if (l.startsWith('@@')) return theme.accent(l)
  return theme.dim(l)
}

/**
 * 把一个 ChatTurn 渲染为 ANSI 行（每行 ≤ width）。
 * Tool part: running 只渲染一行摘要；terminal state 附加输出行（mem_yw2lqt 教训）。
 * Assistant 文本走 Markdown 组件（标题/列表/代码块/表格）。
 */
export function turnToLines(turn: ChatTurn, width: number): string[] {
  const lines: string[] = []
  const queued = turn.role === 'user' && turn.queued
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
            lines.push(truncateToWidth(`  ${colorDiffLine(w)}`, width))
          }
        }
      }
    } else if (part.type === 'reasoning') {
      for (const raw of stripAnsi(part.text).split('\n')) {
        for (const w of wrapTextWithAnsi(raw, Math.max(4, width - 4))) {
          lines.push(truncateToWidth(theme.dim(`  ⠿ ${w}`), width))
        }
      }
    } else if (turn.role === 'assistant') {
      const md = new Markdown(part.text, 1, 0, markdownTheme)
      for (const l of md.render(Math.max(8, width - 2))) {
        lines.push(truncateToWidth(` ${l}`, width))
      }
    } else {
      const isUser = turn.role === 'user'
      const body = stripAnsi(part.text).split('\n').flatMap((l) => wrapTextWithAnsi(l, Math.max(4, width - 4)))
      for (let i = 0; i < body.length; i++) {
        if (queued) {
          lines.push(truncateToWidth(theme.dim(`${i === 0 ? '⏳ ' : '  '}${body[i]}`), width))
          continue
        }
        // 只给首行加前缀；续行缩进对齐
        const prefix = isUser ? (i === 0 ? `${theme.accent('>')} ` : '  ') : '  '
        lines.push(truncateToWidth(`${prefix}${body[i]}`, width))
      }
    }
  }
  if (turn.role === 'assistant' && !turn.done) lines.push(theme.dim('  …'))
  return lines
}
