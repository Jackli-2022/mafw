export interface EpisodeSummaryInput {
  episodeId: string
  startedAt: number | null
  actors: string[]
  intent?: string
  startTurn: number
  endTurn: number
  boundarySource: string
}

/** One-line episode card summary: no narrative, only index metadata. */
export function formatEpisodeSummary(episode: EpisodeSummaryInput): string {
  const date = episode.startedAt
    ? new Date(episode.startedAt).toISOString().slice(0, 10)
    : "unknown"
  const actors = episode.actors
    .map((actor) => actor.replace(/^agent:/, ""))
    .join(", ")
  const turns = Math.max(1, episode.endTurn - episode.startTurn + 1)
  return [
    date,
    actors,
    episode.intent ?? "",
    `${turns} turn${turns === 1 ? "" : "s"}`,
    episode.boundarySource,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** Short badge label for the episode's origin. */
export function episodeBoundaryLabel(source: string): string {
  if (source === "declared") return "declared"
  if (source === "session_start") return "start"
  if (source === "max_length") return "auto-split"
  if (source === "session_end") return "idle-close"
  return "inferred"
}
