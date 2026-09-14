import { truncateToWidth } from '@earendil-works/pi-tui'
import type { ChatTurn } from '../store/chat-store.ts'
import { theme } from '../theme.ts'

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

export interface SessionRecap {
  userTurns: number
  assistantTurns: number
  toolCalls: number
  topTools: [string, number][]
  lastUserPrompt: string | null
  lastAssistantText: string | null
}

/** 本地会话回顾（Hermes /status 语义：纯本地计算，零 LLM、零 prompt-cache 影响）。 */
export function computeRecap(turns: ChatTurn[]): SessionRecap {
  let userTurns = 0
  let assistantTurns = 0
  let toolCalls = 0
  const toolCounts = new Map<string, number>()
  let lastUserPrompt: string | null = null
  let lastAssistantText: string | null = null
  for (const t of turns) {
    if (t.queued) continue
    if (t.role === 'user') {
      userTurns++
      const text = t.parts.find((p) => p.type === 'text')?.text
      if (text) lastUserPrompt = stripAnsi(text)
    } else {
      assistantTurns++
      const text = t.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim()
      if (text) lastAssistantText = stripAnsi(text)
      for (const p of t.parts) {
        if (p.type !== 'tool') continue
        toolCalls++
        const name = p.toolName ?? 'tool'
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1)
      }
    }
  }
  const topTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return { userTurns, assistantTurns, toolCalls, topTools, lastUserPrompt, lastAssistantText }
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** /status overlay 渲染行。 */
export function recapLines(recap: SessionRecap, sessionID: string, project: string): string[] {
  const lines: string[] = []
  lines.push(theme.accent('会话状态'))
  lines.push(theme.dim(`  ${project} · ${sessionID.slice(0, 16)}`))
  lines.push('')
  lines.push('轮次')
  lines.push(theme.dim(`  user ${recap.userTurns} · assistant ${recap.assistantTurns} · 工具调用 ${recap.toolCalls}`))
  if (recap.topTools.length > 0) {
    lines.push(theme.dim(`  top: ${recap.topTools.map(([n, c]) => `${n}×${c}`).join(' ')}`))
  }
  lines.push('')
  lines.push('最近交互')
  lines.push(truncateToWidth(theme.dim(`  你: ${recap.lastUserPrompt ?? '（无）'}`), 78))
  lines.push(truncateToWidth(theme.dim(`  AI: ${recap.lastAssistantText ? trunc(recap.lastAssistantText, 100) : '（无）'}`), 78))
  return lines
}
