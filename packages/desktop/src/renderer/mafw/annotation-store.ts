// 批注草稿 renderer store（模块单例 + write-through 到 main）。
// 语义：本地 signal 是读取源；每次变更先更新本地再 IPC 落盘（fail-open：IPC 失败不回滚，
// 下次 hydrate 以磁盘为准）。pendingFor 只读；takeForSend 取走并清空。
import { createSignal } from "solid-js"
import type { Annotation, AnnotationDb } from "../../shared/annotation-types"

const [rev, setRev] = createSignal(0)
let db: AnnotationDb = {}
const hydrated = new Set<string>()

function api() {
  return (globalThis as any).window?.api?.annotations as
    | {
        list(sessionID: string): Promise<Annotation[]>
        add(a: Annotation): Promise<unknown>
        remove(sessionID: string, id: string): Promise<unknown>
        clear(sessionID: string): Promise<unknown>
      }
    | undefined
}

const bump = () => setRev((v) => v + 1)

export function pendingFor(sessionID: string): Annotation[] {
  rev() // 订阅
  return [...(db[sessionID] ?? [])].sort((a, b) => a.createdAt - b.createdAt)
}

export async function hydrateAnnotations(sessionID: string): Promise<void> {
  if (!sessionID || hydrated.has(sessionID)) return
  hydrated.add(sessionID)
  try {
    const list = (await api()?.list(sessionID)) ?? []
    db = { ...db, [sessionID]: Array.isArray(list) ? list : [] }
    bump()
  } catch {
    /* fail-open：保持空表，下次可重试 */
    hydrated.delete(sessionID)
  }
}

export function addPending(input: Omit<Annotation, "id" | "createdAt">): Annotation {
  const item: Annotation = {
    ...input,
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  }
  db = { ...db, [item.sessionID]: [...(db[item.sessionID] ?? []), item] }
  bump()
  void api()?.add(item).catch(() => {})
  return item
}

export function removePending(sessionID: string, id: string): void {
  db = { ...db, [sessionID]: (db[sessionID] ?? []).filter((x) => x.id !== id) }
  bump()
  void api()?.remove(sessionID, id).catch(() => {})
}

export function clearPending(sessionID: string): void {
  db = { ...db, [sessionID]: [] }
  bump()
  void api()?.clear(sessionID).catch(() => {})
}

/** 发送时取走该会话全部批注并清空（同一条消息不重复携带）。 */
export function takeForSend(sessionID: string): Annotation[] {
  const items = pendingFor(sessionID)
  if (items.length > 0) clearPending(sessionID)
  return items
}

/** 测试/会话删除清理。 */
export function resetAnnotationStore(): void {
  db = {}
  hydrated.clear()
  bump()
}

export function forgetSession(sessionID: string): void {
  if (!sessionID) return
  hydrated.delete(sessionID)
  if (!db[sessionID]) return
  const next = { ...db }
  delete next[sessionID]
  db = next
  bump()
}
