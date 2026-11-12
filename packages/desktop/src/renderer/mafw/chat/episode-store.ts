import type { ChatEpisode } from "./episode-model"

const MAX_EPISODES = 100

function keyFor(sessionID: string): string {
  return `mafw-episodes:v1:${sessionID}`
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isValid(value: unknown, sessionID: string): value is ChatEpisode {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return row.sessionID === sessionID
    && isString(row.id)
    && isString(row.title)
    && isString(row.startMessageId)
    && (row.endMessageId === null || isString(row.endMessageId))
    && (row.status === "open" || row.status === "closed")
    && (row.decisionRecordId === null || isString(row.decisionRecordId))
    && isString(row.createdAt)
    && isString(row.updatedAt)
}

function byCreatedAt(a: ChatEpisode, b: ChatEpisode): number {
  return a.createdAt.localeCompare(b.createdAt)
}

/** Per-session episode view state. Bad data and storage failures never block chat. */
export function createEpisodeStore(storage: Storage, sessionID: string) {
  const storageKey = keyFor(sessionID)

  const load = (): ChatEpisode[] => {
    try {
      const raw = storage.getItem(storageKey)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((value): value is ChatEpisode => isValid(value, sessionID))
        .sort(byCreatedAt)
        .slice(-MAX_EPISODES)
    } catch {
      return []
    }
  }

  const save = (episodes: readonly ChatEpisode[]): void => {
    try {
      storage.setItem(storageKey, JSON.stringify([...episodes].sort(byCreatedAt).slice(-MAX_EPISODES)))
    } catch {
      /* fail-open */
    }
  }

  const upsert = (episode: ChatEpisode): ChatEpisode[] => {
    const next = [...load().filter((item) => item.id !== episode.id), episode]
      .sort(byCreatedAt)
      .slice(-MAX_EPISODES)
    save(next)
    return next
  }

  const remove = (id: string): ChatEpisode[] => {
    const next = load().filter((item) => item.id !== id)
    save(next)
    return next
  }

  return { load, save, upsert, remove }
}
