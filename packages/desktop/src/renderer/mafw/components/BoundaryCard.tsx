import { For } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { LeadBoundaryView } from "@mafw/sdk"
import { boundaryTriggerLabel } from "../chat/boundary-card"

/** Inline topic-boundary proposal: the Lead detected a likely new topic. */
export function BoundaryCard(props: {
  boundaries: readonly LeadBoundaryView[]
  busy?: boolean
  onAction: (id: string, action: "accept" | "merge" | "undo") => void
}) {
  return (
    <section class="mafw-boundary-card" aria-label="话题边界提议">
      <div class="mafw-boundary-card-head">
        <span class="mafw-boundary-card-title">检测到新话题</span>
        <span class="mafw-boundary-card-count">{props.boundaries.length} 条提议</span>
      </div>
      <For each={props.boundaries}>
        {(boundary) => (
          <div class="mafw-boundary-card-item" data-boundary-id={boundary.id}>
            <div class="mafw-boundary-card-text">{boundary.text || "这段对话像是新话题"}</div>
            <div class="mafw-boundary-card-meta">
              {boundaryTriggerLabel(boundary.trigger)} · 置信度 {Math.round(boundary.confidence * 100)}%
            </div>
            <div class="mafw-boundary-card-actions">
              <ButtonV2
                variant="outline"
                size="small"
                disabled={props.busy}
                onClick={() => props.onAction(boundary.id, "accept")}
              >
                分开
              </ButtonV2>
              <ButtonV2
                variant="ghost"
                size="small"
                disabled={props.busy}
                onClick={() => props.onAction(boundary.id, "merge")}
              >
                合并
              </ButtonV2>
              <ButtonV2
                variant="ghost"
                size="small"
                disabled={props.busy}
                onClick={() => props.onAction(boundary.id, "undo")}
              >
                忽略
              </ButtonV2>
            </div>
          </div>
        )}
      </For>
    </section>
  )
}
