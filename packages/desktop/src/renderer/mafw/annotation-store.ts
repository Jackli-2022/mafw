// 批注草稿 renderer store（模块单例 + write-through 到 main）。
// 语义：本地 signal 是读取源；每次变更先更新本地再 IPC 落盘（fail-open：IPC 失败不回滚，
// 下次 hydrate 以磁盘为准）。pendingFor 只读；takeForSend 取走并清空。
import { createSignal } from "solid-js"
import type { Annotation, AnnotationDb, AnnotationPatch } from "../../shared/annotation-types"

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
        setHeld?(sessionID: string, id: string, held: boolean): Promise<unknown>
        patch?(sessionID: string, id: string, patch: AnnotationPatch): Promise<unknown>
        findByIds?(ids: readonly string[]): Promise<Annotation[]>
      }
    | undefined
}

const bump = () => setRev((v) => v + 1)

export function pendingFor(sessionID: string): Annotation[] {
  rev() // 订阅
  return [...(db[sessionID] ?? [])].sort((a, b) => a.createdAt - b.createdAt)
}

/** All local drafts for one owner, including already discussed/delegated rows. */
export function draftsFor(sessionID: string): Annotation[] {
  return pendingFor(sessionID)
}

/** 会随下一条消息发送的批注（held / 已讨论 / 已委托不参与）。 */
export function sendableFor(sessionID: string): Annotation[] {
  return pendingFor(sessionID).filter((a) => !a.held && !a.discussedAt && !a.delegatedAt)
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

/** 设置 held：本地立即生效，IPC 落盘（旧 preload 无 setHeld 时仅本地）。 */
export function setAnnotationHeld(sessionID: string, id: string, held: boolean): void {
  db = {
    ...db,
    [sessionID]: (db[sessionID] ?? []).map((a) => (a.id === id ? { ...a, held } : a)),
  }
  bump()
  void api()?.setHeld?.(sessionID, id, held).catch(() => {})
}

/** Apply a lifecycle/source-only patch; identity and authored text stay local. */
export function patchPending(sessionID: string, id: string, patch: AnnotationPatch): void {
  const existing = (db[sessionID] ?? []).find((a) => a.id === id)
  if (!existing) return
  const next = { ...existing }
  for (const key of [
    "held", "source", "contentVersion", "capturedDirty",
    "discussedAt", "delegatedAt", "reviewItemIDs",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, key)) {
      (next as any)[key] = (patch as any)[key]
    }
  }
  db = {
    ...db,
    [sessionID]: (db[sessionID] ?? []).map((a) => (a.id === id ? next : a)),
  }
  bump()
  void api()?.patch?.(sessionID, id, patch).catch(() => {})
}

/** Find already-hydrated records across owner buckets, preserving ids order. */
export function annotationsByIDs(ids: readonly string[]): Annotation[] {
  rev()
  const wanted = new Set(ids)
  const found = new Map<string, Annotation>()
  for (const list of Object.values(db)) {
    for (const annotation of list) {
      if (wanted.has(annotation.id)) found.set(annotation.id, annotation)
    }
  }
  return ids.flatMap((id) => {
    const annotation = found.get(id)
    return annotation ? [annotation] : []
  })
}

/** Hydrate annotation records referenced by a message when their owner bucket is not loaded. */
export async function hydrateAnnotationsByIDs(ids: readonly string[]): Promise<void> {
  const present = new Set(annotationsByIDs(ids).map((a) => a.id))
  const missing = ids.filter((id) => !present.has(id))
  if (missing.length === 0) return
  try {
    const list = (await api()?.findByIds?.(missing)) ?? []
    if (!Array.isArray(list) || list.length === 0) return
    const next = { ...db }
    for (const annotation of list) {
      const bucket = next[annotation.sessionID] ?? []
      if (bucket.some((a) => a.id === annotation.id)) continue
      next[annotation.sessionID] = [...bucket, annotation]
    }
    db = next
    bump()
  } catch {
    /* fail-open: marker refs can retry on next render */
  }
}

/** 发送时取走可发送批注并清空（held 保留；同一条消息不重复携带）。 */
export function takeForSend(sessionID: string): Annotation[] {
  const items = sendableFor(sessionID)
  for (const item of items) removePending(sessionID, item.id)
  return items
}

/** 只取走快照里的可发送批注；落库期间新增的、以及 held 都留给下一条消息。 */
export function takeForSendById(sessionID: string, ids: readonly string[]): Annotation[] {
  const wanted = new Set(ids)
  const taken = sendableFor(sessionID).filter((item) => wanted.has(item.id))
  for (const item of taken) removePending(sessionID, item.id)
  return taken
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
