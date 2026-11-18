// Pure projection for the Lead memory receipt. The component renders this;
// no raw pointer ids, energy values, or type enums reach the active UI.

import type { MemoryReceiptDTO } from '@mafw/sdk'

export interface ReceiptMemoryView {
  id: string
  label: string
  text: string
  meta: string
  neighbor: boolean
}

export interface ReceiptT1View {
  traceId: string | null
  excerpt: string
  meta: string
  available: boolean
}

export interface MemoryReceiptView {
  pill: string
  sub: string
  statusCopy: string
  memories: ReceiptMemoryView[]
  t1: ReceiptT1View[]
  filteredLine: string
}

const TYPE_LABELS: Record<string, string> = {
  semantic: '事实',
  procedural: '做法',
  global: '通用',
  episodic: '往事',
}

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? '记忆'
}

export function relativeReceiptTime(iso: string | null | undefined, now: number): string {
  if (!iso) return ''
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return ''
  const diff = Math.max(0, now - parsed)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const date = new Date(parsed)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

function metaFor(date: string | null, now: number, extra: string[] = []): string {
  return [relativeReceiptTime(date, now), ...extra].filter(Boolean).join(' · ')
}

export function buildMemoryReceiptView(receipt: MemoryReceiptDTO, now: number): MemoryReceiptView {
  const memories = Array.isArray(receipt?.memories) ? receipt.memories : []
  const t1 = Array.isArray(receipt?.t1) ? receipt.t1 : []
  const counts = receipt?.counts ?? { memories: 0, t1: 0 }
  const filtered = Math.max(0, receipt?.filteredT1 ?? 0)

  const statusCopy = receipt?.status === 'low-confidence'
    ? '有点印象，但不确定'
    : receipt?.status === 'no-memory'
      ? '没找到相关记忆'
      : ''

  return {
    pill: counts.memories > 0
      ? `想起了 ${counts.memories} 件事`
      : counts.t1 > 0
        ? `找到了 ${counts.t1} 段原话`
        : '没找到相关记忆',
    sub: counts.t1 > 0 ? `${counts.t1} 段摘要` : '',
    statusCopy,
    memories: memories.map((memory) => ({
      id: memory.id,
      label: typeLabel(memory.type),
      text: memory.abstraction,
      meta: metaFor(memory.date, now, [
        ...(memory.pinned ? ['pinned'] : []),
        ...(memory.neighborOf ? ['相关'] : []),
      ]),
      neighbor: Boolean(memory.neighborOf),
    })),
    t1: t1.map((item) => ({
      traceId: item.traceId,
      excerpt: item.excerpt,
      meta: metaFor(receipt.updatedAt, now, [item.sessionId ? '本会话' : '', item.available ? '' : '原文已不可用'].filter(Boolean)),
      available: Boolean(item.available),
    })),
    filteredLine: filtered > 0 ? `已过滤 ${filtered} 段工具 / 子代理输出` : '',
  }
}
