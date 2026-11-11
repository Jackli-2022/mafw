import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { PodGoal } from "@mafw/sdk"
import { attentionTarget, type GoalDetailFocus } from "../pod-model"
import type { WorkPriorityItem, AttentionListItem } from "../work-overview-model"
import { summarizeGoalForUser } from "../goal-user-view"

function priorityFocus(item: WorkPriorityItem): GoalDetailFocus {
  return item.kind === "result" ? "result" : attentionTarget(item.kind === "attention" && item.actionType ? { type: item.actionType } : undefined)
}

/** The only deliberate interruption above the complete Goal list. */
export function WorkPriorityList(props: {
  items: WorkPriorityItem[]
  attention?: AttentionListItem[]
  onOpen: (goal: PodGoal, focus: GoalDetailFocus) => void
}) {
  return (
    <>
      <Show when={props.attention}>
        <section class="mafw-work-priority" aria-label="需要你处理">
          <div class="mafw-work-priority-head">
            <span class="mafw-work-kicker">需要你处理</span>
            <span class="mafw-work-priority-count">{props.attention!.length}</span>
          </div>
          <Show
            when={props.attention!.length > 0}
            fallback={<div class="mafw-work-empty">现在没有需要你处理的事项</div>}
          >
            <For each={props.attention}>
              {(item) => {
                const summary = summarizeGoalForUser(item.goal)
                return (
                  <article class="mafw-work-priority-card" data-goal-id={item.goal.goalId}>
                    <div class="mafw-work-priority-top">
                      <span class="mafw-work-priority-badge">{summary.statusLabel}</span>
                      <span class="mafw-work-priority-stage">{summary.ownerLabel}</span>
                    </div>
                    <div class="mafw-work-priority-title">{item.goal.title || "未命名目标"}</div>
                    <ButtonV2
                      variant="contrast"
                      size="small"
                      class="mafw-work-priority-action"
                      onClick={() => props.onOpen(item.goal, attentionTarget(item.actionType ? { type: item.actionType } : undefined))}
                    >
                      {summary.nextActionLabel ?? item.label}
                    </ButtonV2>
                  </article>
                )
              }}
            </For>
          </Show>
        </section>
      </Show>
      <Show when={!props.attention}>
        <Show when={props.items.length > 0}>
          <section class="mafw-work-priority" aria-label="现在需要关注">
            <div class="mafw-work-priority-head">
              <span class="mafw-work-kicker">现在需要关注</span>
              <span class="mafw-work-priority-count">{props.items.length}</span>
            </div>
            <For each={props.items}>
              {(item) => {
                const summary = summarizeGoalForUser(item.goal)
                return (
                  <article
                    class="mafw-work-priority-card"
                    classList={{ "is-result": item.kind === "result" }}
                  >
                    <div class="mafw-work-priority-top">
                      <span class="mafw-work-priority-badge">{summary.statusLabel}</span>
                      <span class="mafw-work-priority-stage">{summary.ownerLabel}</span>
                    </div>
                    <div class="mafw-work-priority-title">{item.goal.title || "未命名目标"}</div>
                    <ButtonV2
                      variant={item.kind === "attention" ? "contrast" : "ghost"}
                      size="small"
                      class="mafw-work-priority-action"
                      onClick={() => props.onOpen(item.goal, priorityFocus(item))}
                    >
                      {summary.nextActionLabel ?? (item.kind === "attention" ? item.label : "查看结果")}
                    </ButtonV2>
                  </article>
                )
              }}
            </For>
          </section>
        </Show>
      </Show>
    </>
  )
}
