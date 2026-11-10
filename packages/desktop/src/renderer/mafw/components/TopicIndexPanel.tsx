import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { LeadTopicListItem } from "../lead-topics"

/**
 * Lead topic index: user-facing topics only. Resume opens the existing Lead
 * session (or a rebuilt one); session ids never appear here.
 */
export function TopicIndexPanel(props: {
  topics: LeadTopicListItem[]
  busy?: boolean
  onResume: (id: string) => void
  onClose: () => void
}) {
  return (
    <div class="mafw-queue-bar mafw-topic-index" aria-label="话题">
      <div class="mafw-topic-index-head">
        <span class="mafw-run-count">话题</span>
        <ButtonV2 variant="ghost" size="small" onClick={props.onClose}>关闭</ButtonV2>
      </div>
      <Show
        when={props.topics.length > 0}
        fallback={<span class="mafw-card-meta">还没有可恢复的话题</span>}
      >
        <For each={props.topics}>
          {(topic) => (
            <div class="mafw-topic-index-row" data-topic-id={topic.id}>
              <ButtonV2
                variant="ghost"
                size="small"
                disabled={props.busy}
                onClick={() => props.onResume(topic.id)}
              >
                <span class="mafw-run-count">{topic.title}</span>
                <span class="mafw-card-meta">{topic.stateLabel}</span>
                <Show when={topic.summary}>
                  <span class="mafw-card-meta">{topic.summary}</span>
                </Show>
              </ButtonV2>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
