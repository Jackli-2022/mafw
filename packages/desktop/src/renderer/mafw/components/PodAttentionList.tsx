import { For, Show } from "solid-js"
import type { PodAttentionItem } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { attentionTarget } from "../pod-model"

const KIND_LABEL: Record<PodAttentionItem["kind"], string> = {
  plan_approval: "计划待批准",
  direction_review: "方向待裁定",
  question: "等待回答",
  blocked: "需要处理",
}

/** attention 类型 → 人类可读标签（方向裁定与计划批准都是真正的人类阻塞）。 */
export function attentionKindLabel(kind: PodAttentionItem["kind"] | string): string {
  return KIND_LABEL[kind as PodAttentionItem["kind"]] ?? String(kind)
}

/**
 * open_plan_review / open_question / open_direction_review / open_result 由
 * shell 的 attentionTarget 分流到详情里的对应区域；这里只上报动作。
 */
export function PodAttentionList(props: {
  items: PodAttentionItem[]
  onOpenAttention: (item: PodAttentionItem) => void
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
              data-action={item.action.type}
              data-focus={attentionTarget(item.action)}
              onClick={() => props.onOpenAttention(item)}
            >
              <span class={`mafw-pod-attention-kind is-${item.kind}`}>{attentionKindLabel(item.kind)}</span>
              <span class="mafw-pod-attention-title">{item.title}</span>
            </ButtonV2>
          )}
        </For>
      </Show>
    </div>
  )
}
