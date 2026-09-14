import { Markdown, truncateToWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import type { ChatPart } from '../store/chat-store.ts'
import { markdownTheme, colorDiffLine } from './message-blocks.ts'
import { theme } from '../theme.ts'

/**
 * 消息块组件树（P3 阅读回路重构）：一个 turn 渲染为多个可独立交互的块——
 * 用户文本 / assistant Markdown / reasoning / tool（可折叠）。
 * tool 块支持 click 展开/折叠（Claude click-to-expand）与全局 verbose/focus 模式。
 */

export interface DisplaySettings {
  /** /focus 静视图：隐藏 tool/reasoning，只留对话文本（display-only） */
  focus: boolean
  /** /verbose：'all' = tool 输出默认展开；'off' = 默认折叠（单击仍可展开） */
  toolVerbosity: 'all' | 'off'
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

/** 可被流式快照替换更新的块。 */
export interface UpdatableBlock extends Component {
  update(part: ChatPart): void
}

export class UserTextBlock implements UpdatableBlock {
  private part: ChatPart
  private queued: boolean
  private cachedWidth?: number
  private cached?: string[]
  constructor(part: ChatPart, queued = false) {
    this.part = part
    this.queued = queued
  }
  update(part: ChatPart): void { this.part = part; this.cachedWidth = undefined }
  invalidate(): void { this.cachedWidth = undefined }
  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    const lines: string[] = []
    const body = stripAnsi(this.part.text).split('\n').flatMap((l) => wrapTextWithAnsi(l, Math.max(4, width - 4)))
    for (let i = 0; i < body.length; i++) {
      if (this.queued) {
        lines.push(truncateToWidth(theme.dim(`${i === 0 ? '⏳ ' : '  '}${body[i]}`), width))
        continue
      }
      const prefix = i === 0 ? `${theme.accent('>')} ` : '  '
      lines.push(truncateToWidth(`${prefix}${body[i]}`, width))
    }
    this.cached = lines
    this.cachedWidth = width
    return lines
  }
}

export class AssistantMarkdownBlock implements UpdatableBlock {
  private part: ChatPart
  private cachedWidth?: number
  private cached?: string[]
  constructor(part: ChatPart) { this.part = part }
  update(part: ChatPart): void { this.part = part; this.cachedWidth = undefined }
  invalidate(): void { this.cachedWidth = undefined }
  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    const md = new Markdown(this.part.text, 1, 0, markdownTheme)
    const lines = md.render(Math.max(8, width - 2)).map((l) => truncateToWidth(` ${l}`, width))
    this.cached = lines
    this.cachedWidth = width
    return lines
  }
}

export class ReasoningBlock implements UpdatableBlock {
  private part: ChatPart
  private cachedWidth?: number
  private cached?: string[]
  constructor(part: ChatPart) { this.part = part }
  update(part: ChatPart): void { this.part = part; this.cachedWidth = undefined }
  invalidate(): void { this.cachedWidth = undefined }
  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    const lines: string[] = []
    for (const raw of stripAnsi(this.part.text).split('\n')) {
      for (const w of wrapTextWithAnsi(raw, Math.max(4, width - 4))) {
        lines.push(truncateToWidth(theme.dim(`  ⠿ ${w}`), width))
      }
    }
    this.cached = lines
    this.cachedWidth = width
    return lines
  }
}

/** tool 调用块：默认按全局 verbosity，单击切换展开/折叠；focus 模式渲染单行隐藏标记。 */
export class ToolBlock implements UpdatableBlock {
  private part: ChatPart
  private settings: DisplaySettings
  private requestRender: () => void
  private userExpanded: boolean | null = null // null = 跟随全局
  private cachedWidth?: number
  private cachedKey?: string
  private cached?: string[]
  constructor(part: ChatPart, settings: DisplaySettings, requestRender: () => void) {
    this.part = part
    this.settings = settings
    this.requestRender = requestRender
  }
  update(part: ChatPart): void { this.part = part; this.cachedKey = undefined }
  invalidate(): void { this.cachedKey = undefined }

  handleMouseClick(_col: number, _row: number): boolean {
    this.userExpanded = !this.expanded
    this.cachedKey = undefined
    this.requestRender()
    return true
  }

  private get expanded(): boolean {
    return this.userExpanded ?? this.settings.toolVerbosity === 'all'
  }

  render(width: number): string[] {
    const key = `${width}|${this.expanded}|${this.settings.focus}|${this.part.state}|${this.part.text}`
    if (this.cached && this.cachedKey === key) return this.cached
    const lines = this.renderInner(width)
    this.cached = lines
    this.cachedKey = key
    return lines
  }

  private renderInner(width: number): string[] {
    if (this.settings.focus) {
      return [truncateToWidth(theme.dim(`  ⋯ ${this.part.toolName ?? 'tool'} 输出隐藏（/focus off 显示）`), width)]
    }
    const icon = this.part.state === 'completed' ? theme.ok('✓')
      : this.part.state === 'error' ? theme.err('✗') : theme.warn('…')
    const firstLine = stripAnsi(this.part.text).split('\n')[0] ?? ''
    const summary = truncateToWidth(
      `${theme.dim('▸ ')}${theme.accent(this.part.toolName ?? 'tool')} ${icon} ${theme.dim(firstLine)}`,
      width,
    )
    if (!this.expanded || this.part.state === 'running') return [summary]
    const lines = [summary]
    for (const l of stripAnsi(this.part.text).split('\n').slice(1)) {
      if (!l) continue
      for (const w of wrapTextWithAnsi(l, Math.max(4, width - 4))) {
        lines.push(truncateToWidth(`  ${colorDiffLine(w)}`, width))
      }
    }
    return lines
  }
}

/** 流式 pending 省略行。 */
export class PendingBlock implements Component {
  invalidate(): void { /* 无缓存 */ }
  render(_width: number): string[] { return [theme.dim('  …')] }
}

/** 按 part 类型构建对应块。 */
export function buildBlock(part: ChatPart, turn: { role: 'user' | 'assistant'; queued?: boolean }, settings: DisplaySettings, requestRender: () => void): Component {
  if (part.type === 'tool') return new ToolBlock(part, settings, requestRender)
  if (part.type === 'reasoning') return new ReasoningBlock(part)
  if (turn.role === 'assistant') return new AssistantMarkdownBlock(part)
  return new UserTextBlock(part, turn.queued === true)
}
