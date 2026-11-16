import { For, Show } from "solid-js"
import type { EpisodeHit } from "@mafw/sdk"
import { episodeBoundaryLabel, formatEpisodeSummary } from "../pages/episode-view"

export function MemoryEpisodes(props: {
  episodes: EpisodeHit[]
  onSelect: (episodeId: string) => void
}) {
  return (
    <div>
      <For each={props.episodes}>
        {(episode) => (
          <div
            class="mafw-card mafw-episode-card"
            tabIndex={0}
            role="button"
            onClick={() => props.onSelect(episode.episodeId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") props.onSelect(episode.episodeId)
            }}
          >
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
              <div class="mafw-card-title">
                {episode.intent ?? episode.episodeId}
              </div>
              <span class="mafw-tool-tag mafw-tag-episode">
                {episodeBoundaryLabel(episode.boundarySource)}
              </span>
            </div>
            <div class="mafw-card-meta mafw-episode-meta">
              {formatEpisodeSummary({
                episodeId: episode.episodeId,
                startedAt: episode.startedAt,
                actors: episode.actors,
                intent: episode.intent,
                startTurn: episode.startTurn,
                endTurn: episode.endTurn,
                boundarySource: episode.boundarySource,
              })}
            </div>
            <Show when={episode.outcome}>
              <div class="mafw-card-meta mafw-episode-outcome">→ {episode.outcome}</div>
            </Show>
            <div class="mafw-tool-anchors">
              <span class="mafw-tool-chip">{episode.episodeId}</span>
              <Show when={episode.topTraceIds.length > 0}>
                <span class="mafw-tool-chip">{episode.topTraceIds.length} traces</span>
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}
