// 批注草稿的纯逻辑 + 可注入 store 的仓库（electron 无关，main/测试共用）。
// main 侧装配在 ipc.ts：createAnnotationRepo(getStore("mafw-annotations"))。
import type { Annotation, AnnotationDb, AnnotationPatch } from "./annotation-types"

const DB_KEY = "bySession"

export function listAnnotations(db: AnnotationDb, sessionID: string): Annotation[] {
  return [...(db[sessionID] ?? [])].sort((a, b) => a.createdAt - b.createdAt)
}

export function addAnnotation(db: AnnotationDb, a: Annotation): AnnotationDb {
  return { ...db, [a.sessionID]: [...(db[a.sessionID] ?? []), a] }
}

export function removeAnnotation(db: AnnotationDb, sessionID: string, id: string): AnnotationDb {
  return { ...db, [sessionID]: (db[sessionID] ?? []).filter((x) => x.id !== id) }
}

export function clearAnnotations(db: AnnotationDb, sessionID: string): AnnotationDb {
  return { ...db, [sessionID]: [] }
}

/** 设置单条批注的 held（保留但不随下一条消息发送）。 */
export function setAnnotationHeld(db: AnnotationDb, sessionID: string, id: string, held: boolean): AnnotationDb {
  return {
    ...db,
    [sessionID]: (db[sessionID] ?? []).map((a) => (a.id === id ? { ...a, held } : a)),
  }
}

/** Apply only lifecycle/source fields; identity and authored content are immutable. */
export function patchAnnotation(
  db: AnnotationDb,
  sessionID: string,
  id: string,
  patch: AnnotationPatch,
): AnnotationDb {
  const allowed: AnnotationPatch = {}
  for (const key of [
    "held", "source", "contentVersion", "capturedDirty",
    "discussedAt", "delegatedAt", "reviewItemIDs",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, key)) {
      (allowed as any)[key] = (patch as any)[key]
    }
  }
  return {
    ...db,
    [sessionID]: (db[sessionID] ?? []).map((a) => (a.id === id ? { ...a, ...allowed } : a)),
  }
}

/** Find annotations across every owner bucket, preserving the requested id order. */
export function findAnnotationsByIds(db: AnnotationDb, ids: readonly string[]): Annotation[] {
  const wanted = new Set(ids)
  const byId = new Map<string, Annotation>()
  for (const list of Object.values(db)) {
    for (const annotation of list) {
      if (wanted.has(annotation.id)) byId.set(annotation.id, annotation)
    }
  }
  return ids.flatMap((id) => {
    const found = byId.get(id)
    return found ? [found] : []
  })
}

type KvStore = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

function readDb(store: KvStore): AnnotationDb {
  const raw = store.get(DB_KEY)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const db: AnnotationDb = {}
  for (const [sid, list] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(list)) db[sid] = list as Annotation[]
  }
  return db
}

export function createAnnotationRepo(store: KvStore) {
  const save = (db: AnnotationDb) => store.set(DB_KEY, db)
  return {
    list(sessionID: string): Annotation[] {
      return listAnnotations(readDb(store), sessionID)
    },
    add(input: Omit<Annotation, "id" | "createdAt"> & Partial<Pick<Annotation, "id" | "createdAt">>): Annotation {
      const item: Annotation = {
        ...input,
        id: input.id ?? `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: input.createdAt ?? Date.now(),
      }
      save(addAnnotation(readDb(store), item))
      return item
    },
    remove(sessionID: string, id: string): boolean {
      const before = listAnnotations(readDb(store), sessionID).length
      save(removeAnnotation(readDb(store), sessionID, id))
      return listAnnotations(readDb(store), sessionID).length < before
    },
    clear(sessionID: string): void {
      save(clearAnnotations(readDb(store), sessionID))
    },
    setHeld(sessionID: string, id: string, held: boolean): boolean {
      const before = listAnnotations(readDb(store), sessionID)
      if (!before.some((a) => a.id === id)) return false
      save(setAnnotationHeld(readDb(store), sessionID, id, held))
      return true
    },
    patch(sessionID: string, id: string, patch: AnnotationPatch): boolean {
      const before = listAnnotations(readDb(store), sessionID)
      if (!before.some((a) => a.id === id)) return false
      save(patchAnnotation(readDb(store), sessionID, id, patch))
      return true
    },
    findByIds(ids: readonly string[]): Annotation[] {
      return findAnnotationsByIds(readDb(store), ids)
    },
  }
}
