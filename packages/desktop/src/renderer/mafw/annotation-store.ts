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
    const fromDisk = Array.isArray(list) ? list : []
    // 水合期间用户可能已加入批注：按 id 合并，磁盘项不覆盖本地新项
    const local = db[sessionID] ?? []
    const merged = [...fromDisk.filter((x) => !local.some((y) => y.id === x.id)), ...local]
    db = { ...db, [sessionID]: merged }
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
  // imageDataUrl 仅内存（dataURL 体积大）；落盘剥离，避免 electron-store 膨胀。
  const { imageDataUrl: _img, ...persisted } = item
  void api()?.add(persisted as Annotation).catch(() => {})
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
