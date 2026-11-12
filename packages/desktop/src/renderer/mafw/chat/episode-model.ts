export type EpisodeStatus = "open" | "closed"

export type ChatEpisode = {
  id: string
  sessionID: string
  title: string
  startMessageId: string
  /** 锚点消息的创建时间；乐观 user id 被服务端 id 替换后靠它找回边界。 */
  startAt?: number
  endMessageId: string | null
  /** 关闭时末条消息的创建时间；与 startAt 同样的 id 对账回退。 */
  endAt?: number
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
  startAt?: number
  now?: string
  id?: string
}): ChatEpisode {
  const at = input.now ?? nowIso()
  return {
    id: input.id ?? newId(),
    sessionID: input.sessionID,
    title: input.title.trim() || "未命名讨论",
    startMessageId: input.startMessageId,
    ...(Number.isFinite(input.startAt) ? { startAt: input.startAt } : {}),
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
  endAt?: number,
): ChatEpisode {
  return {
    ...episode,
    endMessageId: endMessageId || null,
    ...(Number.isFinite(endAt) ? { endAt } : {}),
    status: "closed",
    decisionRecordId,
    updatedAt: nextIso(episode.updatedAt),
  }
}

export function reopenEpisode(episode: ChatEpisode): ChatEpisode {
  return {
    ...episode,
    endMessageId: null,
    endAt: undefined,
    status: "open",
    decisionRecordId: null,
    updatedAt: nextIso(episode.updatedAt),
  }
}

/**
 * View-only grouping: turns before the first episode or between episodes are
 * `episode: null`; a closed episode with no end extends to the last turn.
 * If the exact start id is gone (optimistic `user-...` id reconciled to a
 * server id), `startAt` finds the closest message by creation time.
 */
export function groupTurnsByEpisode<T extends { id: string; time?: { created?: number } }>(
  turns: readonly T[],
  episodes: readonly ChatEpisode[],
): Array<{ episode: ChatEpisode | null; turns: T[] }> {
  const resolveByTime = (target: number, from: number, exclude: Set<number>): number => {
    let best = -1
    let bestDelta = Infinity
    for (let i = from; i < turns.length; i++) {
      if (exclude.has(i)) continue
      const created = turns[i]?.time?.created
      if (typeof created !== "number") continue
      const delta = Math.abs(created - target)
      if (delta <= 10_000 && delta < bestDelta) {
        bestDelta = delta
        best = i
      }
    }
    return best
  }

  const startIndexByEpisode = new Map<ChatEpisode, number>()
  const usedStarts = new Set<number>()
  for (const episode of episodes) {
    const exact = turns.findIndex((turn) => turn.id === episode.startMessageId)
    let index = exact
    if (index < 0 && typeof episode.startAt === "number") {
      index = resolveByTime(episode.startAt, 0, usedStarts)
    }
    if (index >= 0 && !usedStarts.has(index)) {
      usedStarts.add(index)
      startIndexByEpisode.set(episode, index)
    }
  }
  const startsAt = new Map<number, ChatEpisode>()
  for (const [episode, index] of startIndexByEpisode) startsAt.set(index, episode)

  const endIndexFor = (episode: ChatEpisode, startIndex: number): number | null => {
    if (episode.status !== "closed") return null
    if (!episode.endMessageId) return null
    const exact = turns.findIndex((turn, i) => i >= startIndex && turn.id === episode.endMessageId)
    if (exact >= 0) return exact
    if (typeof episode.endAt === "number") {
      const index = resolveByTime(episode.endAt, startIndex, new Set())
      return index >= 0 ? index : null
    }
    return null
  }

  const groups: Array<{ episode: ChatEpisode | null; turns: T[] }> = []
  let current: { episode: ChatEpisode; endIndex: number | null; turns: T[] } | null = null

  const flush = () => {
    if (!current) return
    groups.push({ episode: current.episode, turns: current.turns })
    current = null
  }

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!
    const start = startsAt.get(i)
    if (start) {
      flush()
      current = {
        episode: start,
        endIndex: endIndexFor(start, i),
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
    if (current.endIndex !== null && i === current.endIndex) {
      flush()
    }
  }
  flush()
  return groups
}
