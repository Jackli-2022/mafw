import { For, Show } from "solid-js"
import type { PodAttentionItem } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"

const KIND_LABEL: Record<PodAttentionItem["kind"], string> = {
  plan_approval: "计划待批准",
  question: "等待回答",
  blocked: "需要处理",
}

export function PodAttentionList(props: {
  items: PodAttentionItem[]
  onOpenGoal: (goalId: string) => void
}) {
  return (
    <div class="mafw-pod-attention">
      <div class="mafw-pod-section-head">
        <span>需要你</span>
        <span class="mafw-pod-section-count">{props.items.length}</span>
      </div>
      <Show when={props.items.length > 0} fallback={<div class="mafw-pod-empty-line">没有需要你处理的事项</div>}>
        <For each={props.items}>
          {(item) => (
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-pod-attention-row"
              onClick={() => props.onOpenGoal(item.goalId)}
            >
              <span class={`mafw-pod-attention-kind is-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
              <span class="mafw-pod-attention-title">{item.title}</span>
            </ButtonV2>
          )}
        </For>
      </Show>
    </div>
  )
}
