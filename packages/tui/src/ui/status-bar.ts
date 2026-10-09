import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { theme } from '../theme.ts'

interface StatusSegment { text: string; prio: number }

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
  /** agent 模式徽标（切片 3：'◇plan' / '◇build'；默认不显示） */
  agentLabel?: string
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
    // 段按语义标注优先级（高=优先保留）：窄列时先丢占位/提示等低价值段，
    // 保住 usage（model/tokens/cost）——不盲目从左到右截断。
    const segs: StatusSegment[] = []
    const project = s.project ?? '-'
    segs.push({ text: theme.dim(project), prio: project && project !== '-' ? 30 : 5 })
    const session = s.session ? s.session.slice(0, 12) : '-'
    segs.push({ text: theme.dim(session), prio: session && session !== '-' ? 40 : 5 })
    segs.push({ text: conn, prio: 90 })
    if (s.busy) segs.push({ text: theme.warn('busy'), prio: 70 })
    if (s.agentLabel) segs.push({ text: theme.accent(s.agentLabel), prio: 70 })
    if (s.permLabel) segs.push({ text: theme.warn(s.permLabel), prio: 75 })
    else if (s.permAuto) segs.push({ text: theme.warn('🛡 auto'), prio: 75 })
    if (typeof s.queued === 'number' && s.queued > 0) segs.push({ text: theme.warn(`queued ${s.queued}`), prio: 60 })
    if (typeof s.stashed === 'number' && s.stashed > 0) segs.push({ text: theme.dim(`📌${s.stashed}`), prio: 55 })
    if (s.focus) segs.push({ text: theme.accent('◉ focus'), prio: 65 })
    const u = s.usage
    if (u) {
      const usageBits: string[] = []
      if (u.model) usageBits.push(u.model)
      if (typeof u.tokens === 'number') usageBits.push(`${formatTokens(u.tokens)} tok`)
      if (typeof u.costUsd === 'number' && u.costUsd > 0) usageBits.push(`$${u.costUsd < 0.01 ? u.costUsd.toFixed(3) : u.costUsd.toFixed(2)}`)
      if (typeof u.promptMs === 'number') usageBits.push(theme.accent(`⏱ ${formatDuration(u.promptMs)}`))
      if (typeof u.durationMs === 'number') usageBits.push(formatDuration(u.durationMs))
      if (usageBits.length > 0) segs.push({ text: usageBits.join(' '), prio: 100 })
    }
    segs.push({ text: theme.dim(s.hint ?? '1-4:tab q:quit ?:help'), prio: 20 })

    const SEP = '  ·  '
    const sepW = visibleWidth(SEP)
    const total = (list: StatusSegment[]) =>
      list.reduce((sum, seg, i) => sum + visibleWidth(seg.text) + (i > 0 ? sepW : 0), 0)
    const active = segs.slice()
    while (active.length > 1 && total(active) > width) {
      let minIdx = 0
      for (let i = 1; i < active.length; i++) {
        if (active[i].prio < active[minIdx].prio) minIdx = i
      }
      active.splice(minIdx, 1)
    }
    const line = active.map((seg) => seg.text).join(theme.dim(SEP))
    return [truncateToWidth(line, width)]
  }
}
