import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

export interface UsageState {
  model?: string
  tokens?: number
  costUsd?: number | null
  durationMs?: number
  /** 本回合耗时（Hermes ⏱ 语义：流式中实时跳动，idle 冻结） */
  promptMs?: number
}

export interface StatusState {
  project?: string
  session?: string
  conn: 'ok' | 'reconnecting' | 'down'
  hint?: string
  usage?: UsageState
  /** agent 流式中（交互状态机 busy 态） */
  busy?: boolean
  /** busy 期间排队的消息数 */
  queued?: number
  /** prompt stash 深度（📌 徽标） */
  stashed?: number
  /** /focus 静视图开启（◉ 徽标） */
  focus?: boolean
  /** 审批模式 auto（gateway policy 🛡 徽标；三档化后由 permLabel 替代） */
  permAuto?: boolean
  /** 审批模式徽标文案（切片 1 三档：'🛡 auto' / '🛡 全开'；read-only 不显示） */
  permLabel?: string
}

/** token 数紧凑化：1234 → 1.2K、1250000 → 1.3M。 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** 时长格式化：42s / 15m 30s / 60m。 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export class StatusBar implements Component {
  private state: StatusState = { conn: 'down' }
  setState(s: StatusState) { this.state = s }
  invalidate() { /* 状态即渲染源，无缓存 */ }
  render(width: number): string[] {
    const s = this.state
    const conn = s.conn === 'ok' ? theme.ok('connected')
      : s.conn === 'reconnecting' ? theme.warn('reconnecting') : theme.err('disconnected')
    const parts: string[] = [s.project ?? '-', s.session ? s.session.slice(0, 12) : '-', conn]
    if (s.busy) parts.push(theme.warn('busy'))
    if (s.permLabel) parts.push(theme.warn(s.permLabel))
    else if (s.permAuto) parts.push(theme.warn('🛡 auto'))
    if (typeof s.queued === 'number' && s.queued > 0) parts.push(theme.warn(`queued ${s.queued}`))
    if (typeof s.stashed === 'number' && s.stashed > 0) parts.push(theme.dim(`📌${s.stashed}`))
    if (s.focus) parts.push(theme.accent('◉ focus'))
    const u = s.usage
    if (u) {
      const usageBits: string[] = []
      if (u.model) usageBits.push(u.model)
      if (typeof u.tokens === 'number') usageBits.push(`${formatTokens(u.tokens)} tok`)
      if (typeof u.costUsd === 'number' && u.costUsd > 0) usageBits.push(`$${u.costUsd < 0.01 ? u.costUsd.toFixed(3) : u.costUsd.toFixed(2)}`)
      if (typeof u.promptMs === 'number') usageBits.push(theme.accent(`⏱ ${formatDuration(u.promptMs)}`))
      if (typeof u.durationMs === 'number') usageBits.push(formatDuration(u.durationMs))
      if (usageBits.length > 0) parts.push(usageBits.join(' '))
    }
    parts.push(s.hint ?? '1-4:tab q:quit ?:help')
    return [truncateToWidth(theme.dim(parts.join('  ·  ')), width)]
  }
}
