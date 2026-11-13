// 统一文档顺序的持久化：按 world 存 id 顺序 + activeId，不存文件内容。
// 300ms 去抖，存储失败 fail-open；切 world 前由调用方 flush。
export type DocumentListStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export type DocumentListSnapshot = {
  version: 1
  order: string[]
  activeId: string | null
}

const PREFIX = "mafw-document-list:v1:"
const PERSIST_DELAY_MS = 300
const MAX_ORDER = 100

function defaultStorage(): DocumentListStorage | null {
  try {
    return (globalThis as { localStorage?: DocumentListStorage }).localStorage ?? null
  } catch {
    return null
  }
}

let storage: DocumentListStorage | null = defaultStorage()
const pending = new Map<string, DocumentListSnapshot>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function documentListStorageKey(worldId: string): string {
  return `${PREFIX}${worldId}`
}

function emptySnapshot(): DocumentListSnapshot {
  return { version: 1, order: [], activeId: null }
}

function normalizeOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const order: string[] = []
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue
    seen.add(item)
    order.push(item)
    if (order.length >= MAX_ORDER) break
  }
  return order
}

function normalizeSnapshot(value: unknown): DocumentListSnapshot {
  if (!value || typeof value !== "object") return emptySnapshot()
  const raw = value as Record<string, unknown>
  if (raw.version !== 1) return emptySnapshot()
  const order = normalizeOrder(raw.order)
  const activeId =
    typeof raw.activeId === "string" && order.includes(raw.activeId) ? raw.activeId : null
  return { version: 1, order, activeId }
}

export function configureDocumentListStorage(next: DocumentListStorage | null): void {
  storage = next
}

export function loadDocumentListSnapshot(worldId: string): DocumentListSnapshot {
  if (!storage) return emptySnapshot()
  try {
    const raw = storage.getItem(documentListStorageKey(worldId))
    if (!raw) return emptySnapshot()
    return normalizeSnapshot(JSON.parse(raw))
  } catch {
    return emptySnapshot()
  }
}

function writeSnapshot(worldId: string, snapshot: DocumentListSnapshot): void {
  if (!storage) return
  try {
    storage.setItem(documentListStorageKey(worldId), JSON.stringify(snapshot))
  } catch { /* quota/blocked → fail-open */ }
}

export function saveDocumentListSnapshot(worldId: string, snapshot: DocumentListSnapshot): void {
  if (!storage) return
  const normalized = normalizeSnapshot(snapshot)
  pending.set(worldId, normalized)
  const previous = timers.get(worldId)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    timers.delete(worldId)
    const latest = pending.get(worldId)
    pending.delete(worldId)
    if (latest) writeSnapshot(worldId, latest)
  }, PERSIST_DELAY_MS)
  ;(timer as any).unref?.()
  timers.set(worldId, timer)
}

export function flushDocumentListPersistence(worldId?: string): void {
  const worlds = worldId ? [worldId] : [...pending.keys()]
  for (const world of worlds) {
    const timer = timers.get(world)
    if (timer) clearTimeout(timer)
    timers.delete(world)
    const latest = pending.get(world)
    pending.delete(world)
    if (latest) writeSnapshot(world, latest)
  }
}

export function resetDocumentListPersistenceForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  pending.clear()
  storage = defaultStorage()
}
