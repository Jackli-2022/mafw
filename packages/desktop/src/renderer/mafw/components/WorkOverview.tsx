import { For, Show, createMemo } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import type { PodGoal } from "@mafw/sdk"
import {
  WORK_FILTERS,
  filterWorkGoals,
  workFilterCounts,
  type WorkFilter,
} from "../work-overview-model"
import { attentionTarget, type GoalDetailFocus } from "../pod-model"
import { summarizeGoalForUser } from "../goal-user-view"

/** Complete Goal list: filtering never changes the underlying collection. */
export function WorkOverview(props: {
  goals: PodGoal[]
  loading?: boolean
  error?: string | null
  filter: WorkFilter
  onFilter: (filter: WorkFilter) => void
  onOpenGoal: (goal: PodGoal, focus: GoalDetailFocus) => void
  /** 结果是否已查看（事件 + legacy 双读由调用方提供）；缺省 = 不标「未查看」。 */
  isViewed?: (goal: PodGoal) => boolean
}) {
  const visibleGoals = createMemo(() => filterWorkGoals(props.goals, props.filter))
  const counts = createMemo(() => workFilterCounts(props.goals))
  return (
    <section class="mafw-work-overview" aria-label="全部 Goal">
      <div class="mafw-work-all-head">
        <div class="mafw-work-all-title">
          全部 Goal <span class="mafw-work-all-count">{counts().all}</span>
        </div>
        <div class="mafw-work-filters" role="group" aria-label="按状态筛选 Goal">
          <For each={WORK_FILTERS}>
            {(item) => (
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-work-filter"
                aria-pressed={props.filter === item.id}
                onClick={() => props.onFilter(item.id)}
              >
                {item.label}
                <span class="mafw-work-filter-count">{counts()[item.id]}</span>
              </ButtonV2>
            )}
          </For>
        </div>
      </div>

      <Show when={props.error}>
        <div class="mafw-work-error">{props.error}</div>
      </Show>
      <Show when={!props.error && props.loading && props.goals.length === 0}>
        <div class="mafw-work-empty">正在加载工作项…</div>
      </Show>
      <Show when={!props.error && !props.loading && props.goals.length === 0}>
        <div class="mafw-work-empty">
          <Icon name="layout-grid" size="large" class="mafw-work-empty-icon" />
          <div>
            <strong>还没有工作项</strong>
            <span>向 Lead 交代一件事，或先和 Tech Lead 讨论方案。</span>
          </div>
        </div>
      </Show>
      <Show when={!props.error && props.goals.length > 0 && visibleGoals().length === 0}>
        <div class="mafw-work-empty">这个筛选下没有 Goal。</div>
      </Show>

      <div class="mafw-work-list">
        <For each={visibleGoals()}>
          {(goal) => {
            const summary = summarizeGoalForUser(goal)
            return (
              <div class="mafw-work-row" data-goal-id={goal.goalId}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-work-item"
                  onClick={() => props.onOpenGoal(goal, attentionTarget(goal.stage?.action))}
                >
                  <span class="mafw-work-item-main">
                    <span class="mafw-work-item-title">{goal.title || "未命名目标"}</span>
                    <span class="mafw-work-item-meta">
                      <Show when={goal.bucket === "result_ready" && props.isViewed && !props.isViewed(goal)}>
                        <span class="mafw-work-chip is-unviewed">未查看</span>
                      </Show>
                      <span class="mafw-work-item-stage">{summary.statusLabel}</span>
                      <span class="mafw-work-item-owner">{summary.ownerLabel}</span>
                      <Show when={summary.nextActionLabel}>
                        {(label) => <span class="mafw-work-chip">{label()}</span>}
                      </Show>
                      <Show when={summary.progressText}>
                        {(text) => <span class="mafw-work-item-progress">{text()}</span>}
                      </Show>
                    </span>
                  </span>
                  <Icon name="chevron-right" size="small" class="mafw-work-item-chevron" />
                </ButtonV2>
              </div>
            )
          }}
        </For>
      </div>
    </section>
  )
}
