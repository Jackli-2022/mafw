// Structured receipt for the recall block. The route builds this AFTER the
// recall response is sent (never on the 100ms hot path), so it must stay a pure,
// synchronous function of data the route already has.

export type MemoryReceiptStatus = 'inject' | 'low-confidence' | 'no-memory'

export interface ReceiptMemory {
  id: string
  type: string
  abstraction: string
  date: string | null
  energy?: number
  pinned?: boolean
  available: boolean
  neighborOf?: string
}

export interface ReceiptT1 {
  traceId: string | null
  excerpt: string
  available: boolean
  sessionId?: string
  turnId?: number
  source?: string
}

export interface MemoryReceipt {
  version: 1
  status: MemoryReceiptStatus
  tookMs: number
  createdAt: string
  updatedAt: string
  topic: { title: string; hasRelated: boolean } | null
  memories: ReceiptMemory[]
  t1: ReceiptT1[]
  /** Non-conversation T1 rows dropped from display. */
  filteredT1: number
  counts: { memories: number; t1: number }
}

export interface ReceiptMemoryInput {
  id?: string
  type?: string
  primary_abstraction?: string
  memory_value?: string
  created_at?: string
  energy?: number
  pinned?: boolean
  neighborOf?: string | null
}

export interface ReceiptT1Input {
  traceId?: string | null
  excerpt?: string
  sessionId?: string
  turnId?: number
  source?: string
}

export interface BuildReceiptInput {
  status: MemoryReceiptStatus
  tookMs: number
  now: string
  topic: { title: string; hasRelated: boolean } | null
  memories: ReceiptMemoryInput[]
  t1: ReceiptT1Input[]
  /** True only when the model actually received the no-reliable-memory block. */
  noMemoryBlockRendered?: boolean
}

const MAX_ANCHORS = 5
const MAX_NEIGHBORS = 4
const MAX_T1 = 5
const MAX_TEXT = 240

const T1_BLACKLIST = /You are a subagent|\[object Object\]|<path>|^ok\s*\|/i

function clamp(text: string | undefined | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

function normalizeSource(source: string | undefined): string {
  return (source ?? '').trim().toLowerCase()
}

function isT1Eligible(item: ReceiptT1Input): boolean {
  const excerpt = clamp(item.excerpt)
  if (!excerpt) return false
  const source = normalizeSource(item.source)
  if (source === 'tool' || source === 'system') return false
  if (source === 'user' || source === 'assistant') return true
  // Unknown provenance: apply the content blacklist rather than trusting it.
  return !T1_BLACKLIST.test(excerpt)
}

export function filterT1(hits: ReceiptT1Input[]): { kept: ReceiptT1[]; filtered: number } {
  const kept: ReceiptT1[] = []
  let filtered = 0
  for (const item of hits ?? []) {
    if (!isT1Eligible(item)) {
      filtered++;
      continue;
    }
    kept.push({
      traceId: typeof item.traceId === 'string' && item.traceId ? item.traceId : null,
      excerpt: clamp(item.excerpt),
      available: Boolean(item.traceId),
      ...(typeof item.sessionId === 'string' && item.sessionId ? { sessionId: item.sessionId } : {}),
      ...(typeof item.turnId === 'number' && Number.isFinite(item.turnId) ? { turnId: item.turnId } : {}),
      ...(item.source ? { source: normalizeSource(item.source) } : {}),
    })
  }
  return { kept, filtered }
}

function normalizeMemory(item: ReceiptMemoryInput): ReceiptMemory | null {
  if (!item || typeof item.id !== 'string' || !item.id) return null
  const abstraction = clamp(item.primary_abstraction || item.memory_value) || '?'
  return {
    id: item.id,
    type: typeof item.type === 'string' && item.type ? item.type : 'unknown',
    abstraction,
    date: typeof item.created_at === 'string' && item.created_at ? item.created_at : null,
    available: true,
    ...(typeof item.energy === 'number' && Number.isFinite(item.energy) ? { energy: item.energy } : {}),
    ...(item.pinned === true ? { pinned: true } : {}),
    ...(typeof item.neighborOf === 'string' && item.neighborOf ? { neighborOf: item.neighborOf } : {}),
  }
}

function splitMemories(items: ReceiptMemory[]): { anchors: ReceiptMemory[]; neighbors: ReceiptMemory[] } {
  return {
    anchors: items.filter((item) => !item.neighborOf).slice(0, MAX_ANCHORS),
    neighbors: items.filter((item) => !!item.neighborOf).slice(0, MAX_NEIGHBORS),
  }
}

function dedupeMemories(items: ReceiptMemory[]): ReceiptMemory[] {
  const byId = new Map<string, ReceiptMemory>()
  for (const item of items) {
    const prev = byId.get(item.id)
    byId.set(item.id, prev ? { ...prev, ...item } : item)
  }
  return [...byId.values()]
}

function dedupeT1(items: ReceiptT1[]): ReceiptT1[] {
  const byKey = new Map<string, ReceiptT1>()
  for (const item of items) byKey.set(t1Key(item), item)
  return [...byKey.values()]
}

export function buildMemoryReceipt(input: BuildReceiptInput): MemoryReceipt | null {
  const filtered = filterT1(input.t1)
  const t1 = dedupeT1(filtered.kept).slice(0, MAX_T1)

  const normalized = dedupeMemories(
    (input.memories ?? []).map(normalizeMemory).filter((item): item is ReceiptMemory => !!item),
  )
  const { anchors, neighbors } = splitMemories(normalized)
  const memories = [...anchors, ...neighbors]
  const hasContent = memories.length > 0 || t1.length > 0

  if (!hasContent) {
    if (input.status === 'no-memory' && input.noMemoryBlockRendered) {
      return {
        version: 1,
        status: 'no-memory',
        tookMs: input.tookMs,
        createdAt: input.now,
        updatedAt: input.now,
        topic: normalizeTopic(input.topic),
        memories: [],
        t1: [],
        filteredT1: filtered.filtered,
        counts: { memories: 0, t1: 0 },
      }
    }
    return null
  }

  return {
    version: 1,
    status: input.status === 'low-confidence' ? 'low-confidence' : 'inject',
    tookMs: input.tookMs,
    createdAt: input.now,
    updatedAt: input.now,
    topic: normalizeTopic(input.topic),
    memories,
    t1,
    filteredT1: filtered.filtered,
    counts: { memories: anchors.length, t1: t1.length },
  }
}

function normalizeTopic(topic: BuildReceiptInput['topic']): MemoryReceipt['topic'] {
  if (!topic) return null
  const title = clamp(topic.title)
  if (!title) return null
  return { title, hasRelated: Boolean(topic.hasRelated) }
}

function t1Key(item: ReceiptT1): string {
  if (item.traceId) return `trace:${item.traceId}`
  return `turn:${item.sessionId ?? ''}:${item.turnId ?? ''}:${item.excerpt}`
}

export function mergeMemoryReceipt(prev: MemoryReceipt, next: MemoryReceipt): MemoryReceipt {
  const memories = dedupeMemories([...prev.memories, ...next.memories])
  const { anchors, neighbors } = splitMemories(memories)

  const t1ById = new Map<string, ReceiptT1>()
  for (const item of [...prev.t1, ...next.t1]) {
    const key = t1Key(item)
    const prior = t1ById.get(key)
    t1ById.set(key, prior ? { ...prior, ...item } : item)
  }
  const t1 = [...t1ById.values()].slice(0, MAX_T1)

  const contributors = [prev, next].filter((item) => item.counts.memories + item.counts.t1 > 0)
  let status: MemoryReceiptStatus
  if (anchors.length + neighbors.length + t1.length > 0) {
    status = contributors.length > 0 && contributors.every((item) => item.status === 'low-confidence')
      ? 'low-confidence'
      : 'inject'
  } else {
    status = prev.status === 'no-memory' || next.status === 'no-memory' ? 'no-memory' : 'inject'
  }

  return {
    version: 1,
    status,
    tookMs: Math.max(prev.tookMs, next.tookMs),
    createdAt: [prev.createdAt, next.createdAt].filter(Boolean).sort()[0] ?? next.createdAt,
    updatedAt: [prev.updatedAt, next.updatedAt].filter(Boolean).sort().slice(-1)[0] ?? next.updatedAt,
    topic: next.topic ?? prev.topic,
    memories: [...anchors, ...neighbors],
    t1,
    filteredT1: (prev.filteredT1 ?? 0) + (next.filteredT1 ?? 0),
    counts: { memories: anchors.length, t1: t1.length },
  }
}
