import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { PodGoal } from "@mafw/sdk"
import { attentionTarget, podStageLabel, type GoalDetailFocus } from "../pod-model"
import type { WorkPriorityItem } from "../work-overview-model"

function priorityFocus(item: WorkPriorityItem): GoalDetailFocus {
  return item.kind === "result" ? "result" : attentionTarget(item.kind === "attention" && item.actionType ? { type: item.actionType } : undefined)
}

/** The only deliberate interruption above the complete Goal list. */
export function WorkPriorityList(props: {
  items: WorkPriorityItem[]
  onOpen: (goal: PodGoal, focus: GoalDetailFocus) => void
}) {
  return (
    <Show when={props.items.length > 0}>
      <section class="mafw-work-priority" aria-label="现在需要关注">
        <div class="mafw-work-priority-head">
          <span class="mafw-work-kicker">现在需要关注</span>
          <span class="mafw-work-priority-count">{props.items.length}</span>
        </div>
        <For each={props.items}>
          {(item) => (
            <article
              class="mafw-work-priority-card"
              classList={{ "is-result": item.kind === "result" }}
            >
              <div class="mafw-work-priority-top">
                <span class="mafw-work-priority-badge">
                  {item.kind === "attention" ? "等待你处理" : "新结果"}
                </span>
                <span class="mafw-work-priority-stage">{podStageLabel(item.goal.stage)}</span>
              </div>
              <div class="mafw-work-priority-title">{item.goal.title || "未命名目标"}</div>
              <ButtonV2
                variant={item.kind === "attention" ? "contrast" : "ghost"}
                size="small"
                class="mafw-work-priority-action"
                onClick={() => props.onOpen(item.goal, priorityFocus(item))}
              >
                {item.kind === "attention" ? item.label : "查看结果"}
              </ButtonV2>
            </article>
          )}
        </For>
      </section>
    </Show>
  )
}
