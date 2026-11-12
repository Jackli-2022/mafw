export type EpisodeStatus = "open" | "closed"

export type ChatEpisode = {
  id: string
  sessionID: string
  title: string
  startMessageId: string
  endMessageId: string | null
  status: EpisodeStatus
  decisionRecordId: string | null
  createdAt: string
  updatedAt: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function nextIso(previous?: string): string {
  const now = Date.now()
  const previousMs = previous ? Date.parse(previous) : NaN
  return new Date(Number.isFinite(previousMs) && now <= previousMs ? previousMs + 1 : now).toISOString()
}

function newId(): string {
  return `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEpisode(input: {
  sessionID: string
  title: string
  startMessageId: string
  now?: string
  id?: string
}): ChatEpisode {
  const at = input.now ?? nowIso()
  return {
    id: input.id ?? newId(),
    sessionID: input.sessionID,
    title: input.title.trim() || "未命名讨论",
    startMessageId: input.startMessageId,
    endMessageId: null,
    status: "open",
    decisionRecordId: null,
    createdAt: at,
    updatedAt: at,
  }
}

export function closeEpisode(
  episode: ChatEpisode,
  endMessageId: string,
  decisionRecordId: string | null = null,
): ChatEpisode {
  return {
    ...episode,
    endMessageId: endMessageId || null,
    status: "closed",
    decisionRecordId,
    updatedAt: nextIso(episode.updatedAt),
  }
}

export function reopenEpisode(episode: ChatEpisode): ChatEpisode {
  return {
    ...episode,
    endMessageId: null,
    status: "open",
    decisionRecordId: null,
    updatedAt: nextIso(episode.updatedAt),
  }
}

/**
 * View-only grouping: turns before the first episode or between episodes are
 * `episode: null`; a closed episode with no end extends to the last turn.
 */
export function groupTurnsByEpisode<T extends { id: string }>(
  turns: readonly T[],
  episodes: readonly ChatEpisode[],
): Array<{ episode: ChatEpisode | null; turns: T[] }> {
  const byStart = new Map(episodes.map((episode) => [episode.startMessageId, episode]))
  const groups: Array<{ episode: ChatEpisode | null; turns: T[] }> = []
  let current: { episode: ChatEpisode; endId: string | null; turns: T[] } | null = null

  const flush = () => {
    if (!current) return
    groups.push({ episode: current.episode, turns: current.turns })
    current = null
  }

  for (const turn of turns) {
    const start = byStart.get(turn.id)
    if (start) {
      flush()
      current = {
        episode: start,
        endId: start.status === "closed" ? start.endMessageId : null,
        turns: [],
      }
    }
    if (!current) {
      const previous = groups[groups.length - 1]
      if (previous && previous.episode === null) previous.turns.push(turn)
      else groups.push({ episode: null, turns: [turn] })
      continue
    }
    current.turns.push(turn)
    if (current.endId && turn.id === current.endId) {
      flush()
    }
  }
  flush()
  return groups
}
