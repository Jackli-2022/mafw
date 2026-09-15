// Singleton session data layer shared by Rail and MafwShell. The gateway
// already hides memory-worker/subagent sessions; this store adds caching,
// unified ordering (last-activity desc), title fallback and offline tracking.
import { createSignal } from "solid-js"

type SessionInfo = {
  id: string
  directory?: string
  projectID?: string
  title?: string
  metadata?: { mafw?: { role?: string } }
  time?: { created?: number; updated?: number }
  parentID?: string
}

const cache = new Map<string, { list: SessionInfo[]; fetchedAt: number; failed: boolean }>()
const inflight = new Map<string, Promise<SessionInfo[]>>()
const [loading, setLoading] = createSignal(false)
// Bumped on every successful fetch so reactive readers re-evaluate.
const [version, setVersion] = createSignal(0)

const keyOf = (projectID: string | null) => projectID || "__all__"

const sortSessions = (list: SessionInfo[]): SessionInfo[] =>
  list.filter(Boolean).sort((a, b) => {
    const ta = a.time?.updated || a.time?.created || 0
    const tb = b.time?.updated || b.time?.created || 0
    return tb - ta
  })

const withFallbackTitle = (s: SessionInfo): SessionInfo =>
  s.title && s.title.trim() ? s : { ...s, title: "New conversation" }

async function fetchFor(projectID: string | null): Promise<SessionInfo[]> {
  const key = keyOf(projectID)
  const existing = inflight.get(key)
  if (existing) return existing
  const p = (async () => {
    setLoading(true)
    try {
      const list = await window.api.mafw.sessions.list(projectID ?? undefined)
      const sorted = sortSessions((Array.isArray(list) ? list : []) as SessionInfo[]).map(withFallbackTitle)
      cache.set(key, { list: sorted, fetchedAt: Date.now(), failed: false })
      setVersion(v => v + 1)
      return sorted
    } catch (e) {
      console.warn("[mafw] session-store fetch failed", e)
      cache.set(key, { list: [], fetchedAt: Date.now(), failed: true })
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
  sessionsFor(projectID: string | null): SessionInfo[] {
    version()
    const key = keyOf(projectID)
    const entry = cache.get(key)
    if (!entry) {
      void fetchFor(projectID)
      return []
    }
    return entry.list
  },

  isLoading: loading,

  /** Reactive: last fetch for this project failed (gateway unreachable). */
  isOffline(projectID: string | null): boolean {
    version()
    return cache.get(keyOf(projectID))?.failed === true
  },

  /** Drop cache (optionally for one project) and refetch. */
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
   * Merge a partial update into a cached session (every bucket containing it),
   * keeping ordering and title fallback intact. Returns true when found.
   */
  patch(id: string, partial: Partial<SessionInfo>): boolean {
    let found = false
    for (const [key, entry] of cache) {
      if (!entry.list.some(s => s.id === id)) continue
      found = true
      const merged = entry.list.map(s => (s.id === id ? { ...s, ...partial } : s))
      cache.set(key, { ...entry, list: sortSessions(merged).map(withFallbackTitle) })
    }
    if (found) setVersion(v => v + 1)
    return found
  },

  /** Remove a session from every cache bucket. Returns true when found. */
  remove(id: string): boolean {
    let found = false
    for (const [key, entry] of cache) {
      if (!entry.list.some(s => s.id === id)) continue
      found = true
      cache.set(key, { ...entry, list: entry.list.filter(s => s.id !== id) })
    }
    if (found) setVersion(v => v + 1)
    return found
  },
}
