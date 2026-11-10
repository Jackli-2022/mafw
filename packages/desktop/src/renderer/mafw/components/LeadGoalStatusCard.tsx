import { For, Show } from "solid-js"
import type { LeadGoalStatusCardModel } from "../lead-goal-status"

/**
 * On-demand Lead status card. Parent computes the projection from Pod state;
 * this component is presentational and never fetches or shows session ids.
 */
export function LeadGoalStatusCard(props: { goals: LeadGoalStatusCardModel[] }) {
  return (
    <div class="mafw-queue-bar mafw-lead-status-card">
      <Show
        when={props.goals.length > 0}
        fallback={<span class="mafw-card-meta">暂无进行中的 Goal</span>}
      >
        <For each={props.goals}>
          {(goal) => (
            <div class="mafw-lead-status-row" data-goal-id={goal.goalId}>
              <span class="mafw-run-count">{goal.title}</span>
              <span class="mafw-card-meta">{goal.stageLabel}</span>
              <Show when={goal.progressText}>
                <span class="mafw-card-meta">{goal.progressText}</span>
              </Show>
              <Show when={goal.blocker}>
                <span class="mafw-card-meta">{goal.blocker}</span>
              </Show>
              <Show when={goal.pendingAttention > 0}>
                <span class="mafw-card-meta">待处理 {goal.pendingAttention}</span>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
