// Singleton session data layer shared by Rail and MafwShell. The gateway
// already hides memory-worker/subagent sessions; this store owns the project
// buckets (ordered session ids + fetch state) and delegates every metadata
// field to `session-entities` (E6-2: one entity cache, no list copy).
import { batch, createSignal } from "solid-js"
import { sessionEntities, type SessionEntity } from "./session-entities"

type Bucket = {
  /** Session ids, last-activity desc. Metadata lives in sessionEntities. */
  ids: string[]
  fetchedAt: number
  failed: boolean
}

const cache = new Map<string, Bucket>()
const inflight = new Map<string, Promise<SessionEntity[]>>()
const [loading, setLoading] = createSignal(false)
// Bumped on every successful fetch / bucket mutation so reactive readers
// re-evaluate. Entity-only writes ride sessionEntities.version().
const [version, setVersion] = createSignal(0)

const keyOf = (projectID: string | null) => projectID || "__all__"

const activityOf = (id: string): number => {
  const time = sessionEntities.get(id)?.time
  return time?.updated || time?.created || 0
}

const sortIds = (ids: string[]): string[] =>
  Array.from(new Set(ids.filter(Boolean))).sort((a, b) => activityOf(b) - activityOf(a))

const withFallbackTitle = (s: SessionEntity): SessionEntity =>
  s.title && s.title.trim() ? s : { ...s, title: "New conversation" }

const asEntity = (row: any): SessionEntity | null =>
  row && typeof row.id === "string" ? (row as SessionEntity) : null

async function fetchFor(projectID: string | null): Promise<SessionEntity[]> {
  const key = keyOf(projectID)
  const existing = inflight.get(key)
  if (existing) return existing
  const p = (async () => {
    setLoading(true)
    try {
      const list = await window.api.mafw.sessions.list(projectID ?? undefined)
      const entities = (Array.isArray(list) ? list : []).map(asEntity).filter((s): s is SessionEntity => !!s)
      // Entities are the source of truth: upsert first, then keep ids only.
      // Batched so reactive readers rerun once, with the bucket already stored
      // (an unbatched upsert bump would re-enter an in-flight first read).
      let ids: string[] = []
      batch(() => {
        for (const entity of entities) sessionEntities.upsert(entity)
        ids = sortIds(entities.map(s => s.id))
        cache.set(key, { ids, fetchedAt: Date.now(), failed: false })
        setVersion(v => v + 1)
      })
      return ids.map(id => sessionEntities.get(id)).filter(Boolean) as SessionEntity[]
    } catch (e) {
      console.warn("[mafw] session-store fetch failed", e)
      cache.set(key, { ids: [], fetchedAt: Date.now(), failed: true })
      setVersion(v => v + 1)
      return []
    } finally {
      inflight.delete(key)
      setLoading(false)
    }
  })()
  inflight.set(key, p)
  return p
}

export const sessionStore = {
  /** Reactive read; triggers a fetch on first access for the project. */
  sessionsFor(projectID: string | null): SessionEntity[] {
    version()
    sessionEntities.version()
    const key = keyOf(projectID)
    const entry = cache.get(key)
    if (!entry) {
      void fetchFor(projectID)
      return []
    }
    return entry.ids
      .map(id => sessionEntities.get(id))
      .filter((s): s is SessionEntity => !!s)
      .map(withFallbackTitle)
  },

  isLoading: loading,

  /** True once a fetch for this project has completed (even if it was empty). */
  isLoaded(projectID: string | null): boolean {
    version()
    return cache.has(keyOf(projectID))
  },

  /** Reactive: last fetch for this project failed (gateway unreachable). */
  isOffline(projectID: string | null): boolean {
    version()
    return cache.get(keyOf(projectID))?.failed === true
  },

  /**
   * Drop buckets (optionally for one project) and refetch. Entities are kept on
   * purpose: they back offline reads while the refetch is in flight. A full SSE
   * resync additionally calls `sessionEntities.reset()` (see MafwShell).
   */
  invalidate(projectID?: string | null): void {
    if (projectID === undefined || projectID === null) {
      const keys = Array.from(cache.keys())
      cache.clear()
      for (const key of keys) void fetchFor(key === "__all__" ? null : key)
      setVersion(v => v + 1)
      return
    }
    cache.delete(keyOf(projectID))
    void fetchFor(projectID)
  },

  /**
   * Merge a partial update into the entity cache and re-sort every bucket that
   * contains the id. Returns true when the session is known.
   */
  patch(id: string, partial: Partial<SessionEntity>): boolean {
    const found = sessionEntities.patch(id, partial)
    if (!found) return false
    batch(() => {
      for (const [key, entry] of cache) {
        if (!entry.ids.includes(id)) continue
        cache.set(key, { ...entry, ids: sortIds(entry.ids) })
      }
      setVersion(v => v + 1)
    })
    return true
  },

  /** Remove a session from the entity cache and every bucket. True when found. */
  remove(id: string): boolean {
    let found = false
    batch(() => {
      found = sessionEntities.remove(id)
      for (const [key, entry] of cache) {
        if (!entry.ids.includes(id)) continue
        found = true
        cache.set(key, { ...entry, ids: entry.ids.filter(sid => sid !== id) })
      }
      if (found) setVersion(v => v + 1)
    })
    return found
  },
}
