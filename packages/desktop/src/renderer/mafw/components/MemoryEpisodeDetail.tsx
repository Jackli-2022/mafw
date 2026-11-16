import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { T1EpisodeRecord } from "@mafw/sdk"
import { episodeBoundaryLabel, formatEpisodeSummary } from "../pages/episode-view"

export interface EpisodeDetailData {
  episode: T1EpisodeRecord
  members: Array<{ episodeId: string; traceId: string; turnSeq: number }>
}

export function MemoryEpisodeDetail(props: {
  detail: EpisodeDetailData | null
  onClose: () => void
}) {
  return (
    <Show when={props.detail}>
      {(data) => (
        <div class="mafw-card mafw-episode-detail" style={{ "flex-direction": "column", "align-items": "stretch" }}>
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
            <div class="mafw-card-title">{data().episode.intent ?? data().episode.episodeId}</div>
            <ButtonV2 variant="ghost" size="small" onClick={props.onClose}>Close</ButtonV2>
          </div>
          <div class="mafw-card-meta mafw-episode-meta">
            {formatEpisodeSummary({
              episodeId: data().episode.episodeId,
              startedAt: data().episode.startedAt,
              actors: data().episode.actors.map((actor) => actor.actorId),
              intent: data().episode.intent,
              startTurn: data().episode.startTurn,
              endTurn: data().episode.endTurn,
              boundarySource: data().episode.boundarySource,
            })}
          </div>
          <div class="mafw-tool-anchors">
            <span class="mafw-tool-chip">{episodeBoundaryLabel(data().episode.boundarySource)}</span>
            <span class="mafw-tool-chip">{data().episode.episodeId}</span>
          </div>
          <Show when={data().episode.outcome}>
            <div class="mafw-card-meta mafw-episode-outcome">→ {data().episode.outcome}</div>
          </Show>
          <div class="mafw-episode-members">
            <For each={data().members}>
              {(member) => (
                <div class="mafw-delta-row">
                  <div class="mafw-delta-content">
                    <div class="mafw-delta-text">turn {member.turnSeq}</div>
                    <div class="mafw-delta-priority">{member.traceId}</div>
                  </div>
                </div>
              )}
            </For>
          </div>
          <div class="mafw-card-meta">
            Expand a member turn with mafw_get_memory("t1:&lt;traceId&gt;"), or the whole episode with mafw_get_memory("t1ep:&lt;episodeId&gt;").
          </div>
        </div>
      )}
    </Show>
  )
}
