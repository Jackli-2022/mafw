import type { TriageItem, TriageLlmSuggestion } from '@mafw/sdk'

// E10j-J1: mirror the desktop `triage-model.ts`. Render the real disk record
// (`~/.mafw/triage/*.json`); the retired phantom fields `goalId` / `reason` /
// `severity` / `createdAt` have no writer and must never be shown.
export type TriageTone = 'neutral' | 'warn' | 'danger'

export interface TriageView {
  title: string
  meta: string
  badge: { label: string; tone: TriageTone }
}

const STATE_BADGE: Record<TriageItem['state'], { label: string; tone: TriageTone }> = {
  PENDING_CONFIRMATION: { label: '待确认', tone: 'warn' },
  CONFIRMED: { label: '已确认', tone: 'neutral' },
  REJECTED: { label: '已拒绝', tone: 'danger' },
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function titleOf(item: TriageItem): string {
  return text(item.proposedGoal?.title) ?? text(item.summary?.title) ?? item.id
}

/** Localized timestamp, or null when absent/invalid (never prints "Invalid Date"). */
function localized(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return null
  return at.toLocaleString()
}

function highestSuggestion(suggestions: TriageItem['llmSuggestions']): TriageLlmSuggestion | null {
  if (!suggestions?.length) return null
  const rank = (priority: string) => (priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0)
  return suggestions.reduce((best, current) => (rank(current.priority) > rank(best.priority) ? current : best))
}

function badgeOf(item: TriageItem): TriageView['badge'] {
  const base = STATE_BADGE[item.state] ?? { label: String(item.state), tone: 'neutral' as TriageTone }
  const suggestion = highestSuggestion(item.llmSuggestions)
  if (!suggestion) return { label: base.label, tone: base.tone }
  const action = suggestion.action === 'confirm' ? '建议确认' : '建议拒绝'
  return { label: `${base.label} · ${action} ${suggestion.priority}`, tone: base.tone }
}

function metaOf(item: TriageItem): string {
  const parts: string[] = []
  const source = text(item.source)
  if (source) parts.push(source)
  const discovered = localized(item.discoveredAt)
  if (discovered) parts.push(discovered)
  const deadline = localized(item.deadline)
  if (deadline) parts.push(`截止 ${deadline}`)
  return parts.join(' · ')
}

export function triageView(item: TriageItem): TriageView {
  return {
    title: titleOf(item),
    meta: metaOf(item),
    badge: badgeOf(item),
  }
}
