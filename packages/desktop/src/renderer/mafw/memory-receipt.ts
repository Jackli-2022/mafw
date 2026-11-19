// Pure projection for the Lead memory receipt. The component renders this;
// no raw pointer ids, energy values, or type enums reach the active UI.

import type { MemoryReceiptDTO } from '@mafw/sdk'

export interface ReceiptMemoryView {
  id: string
  title: string
  body: string
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
  header: string
  latestLabel: string
  primary: ReceiptMemoryView[]
  neighbors: ReceiptMemoryView[]
  neighborLabel: string
  statusCopy: string
  t1: ReceiptT1View[]
  filteredLine: string
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

function metaFor(date: string | null | undefined, now: number): string {
  return relativeReceiptTime(date, now)
}

const TITLE_MAX = 46
const TITLE_CLIP = 54

/**
 * A memory abstraction is often one long machine sentence. Split it at the
 * first natural punctuation inside the title budget so the card reads as a
 * title + one-line context instead of a wall of text. The full text stays in
 * the memory page; the card never invents a summary.
 */
export function splitMemoryText(raw: string): { title: string; body: string } {
  const text = (raw || '').trim()
  if (!text) return { title: '', body: '' }
  const delimiters = ['：', '。', '；', '，', ': ', '. ', '; ', ', ']
  let cut = -1
  let cutLen = 1
  for (const delimiter of delimiters) {
    const index = text.indexOf(delimiter)
    if (index < 6 || index > TITLE_MAX) continue
    if (cut === -1 || index < cut) {
      cut = index
      cutLen = delimiter.length
    }
  }
  if (cut >= 0) {
    const title = text.slice(0, cut).trim()
    const body = text.slice(cut + cutLen).trim()
    if (title && body) return { title, body }
  }
  if (text.length > TITLE_CLIP) {
    let end = TITLE_MAX
    const space = text.lastIndexOf(' ', TITLE_MAX)
    if (space > 20) end = space
    return { title: `${text.slice(0, end).trim()}…`, body: text.slice(end).trim() }
  }
  return { title: text, body: '' }
}

export function buildMemoryReceiptView(receipt: MemoryReceiptDTO, now: number): MemoryReceiptView {
  const rawMemories = Array.isArray(receipt?.memories) ? receipt.memories : []
  const t1 = Array.isArray(receipt?.t1) ? receipt.t1 : []
  const filtered = Math.max(0, receipt?.filteredT1 ?? 0)

  const statusCopy = receipt?.status === 'low-confidence'
    ? '有点印象，但不确定'
    : receipt?.status === 'no-memory'
      ? '没找到相关记忆'
      : ''

  const memories: ReceiptMemoryView[] = rawMemories.map((memory) => {
    const { title, body } = splitMemoryText(memory.abstraction)
    return {
      id: memory.id,
      title,
      body,
      meta: metaFor(memory.date, now),
      neighbor: Boolean(memory.neighborOf),
    }
  })
  const primary = memories.filter((memory) => !memory.neighbor)
  const neighbors = memories.filter((memory) => memory.neighbor)

  // The card header must agree with the trigger: only primary memories count.
  // Neighbors are intentionally secondary and live behind one expandable line.
  const latestDate = rawMemories
    .filter((memory) => !memory.neighborOf && typeof memory.date === 'string')
    .map((memory) => memory.date as string)
    .sort()
    .at(-1)
  const latestLabel = relativeReceiptTime(latestDate ?? receipt?.updatedAt ?? null, now)

  const hasPrimary = primary.length > 0
  const t1Count = t1.length
  const pill = hasPrimary
    ? `想起 ${primary.length} 件旧事`
    : t1Count > 0
      ? `找到 ${t1Count} 段原话`
      : '没找到相关记忆'

  return {
    pill,
    header: hasPrimary
      ? `想起的 ${primary.length} 件旧事`
      : '这次回忆',
    latestLabel,
    primary,
    neighbors,
    neighborLabel: neighbors.length > 0 ? `还有 ${neighbors.length} 条顺带想起` : '',
    statusCopy,
    t1: t1.map((item) => ({
      traceId: item.traceId,
      excerpt: item.excerpt,
      meta: metaFor(receipt.updatedAt, now),
      available: Boolean(item.available),
    })),
    filteredLine: filtered > 0 ? `已过滤 ${filtered} 段工具 / 子代理输出` : '',
  }
}
