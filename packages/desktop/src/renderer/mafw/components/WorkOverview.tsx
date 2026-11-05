import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import type { PodGoal, PodWorkOverview } from "@mafw/sdk"
import { workspaceSections } from "../workspace-model"
import { attentionTarget, podStageLabel, type GoalDetailFocus } from "../pod-model"

const LABELS: Record<string, string> = {
  needs_you: "需要你",
  queued: "排队中",
  in_progress: "进行中",
  result_ready: "结果",
  ended: "历史",
}

const EMPTY: PodWorkOverview = {
  projectDir: "",
  podId: "",
  groups: {
    needs_you: [],
    queued: [],
    in_progress: [],
    result_ready: [],
    ended: [],
  },
  counts: {
    needs_you: 0,
    queued: 0,
    in_progress: 0,
    result_ready: 0,
    ended: 0,
  },
  total: 0,
}

/** 行内只放真实元信息：阶段、revision、执行策略、是否独立评审。 */
function goalChips(goal: PodGoal): string[] {
  const chips: string[] = []
  const stage = podStageLabel(goal.stage)
  if (stage) chips.push(stage)
  if (typeof goal.revision === "number") chips.push(`rev ${goal.revision}`)
  if (goal.strategy === "quick") chips.push("快速执行")
  else if (goal.strategy === "collaborative") chips.push("协作")
  if (goal.assessment === "unreviewed") chips.push("未独立评审")
  return chips
}

/** One Overview projection: every count is the length of the list below it. */
export function WorkOverview(props: {
  overview: PodWorkOverview | null
  loading?: boolean
  error?: string | null
  onOpenGoal: (goal: PodGoal, focus: GoalDetailFocus) => void
  onOpenAll?: () => void
  /** 结果是否已查看（事件 + legacy 双读由调用方提供）；缺省 = 不标「未查看」。 */
  isViewed?: (goal: PodGoal) => boolean
}) {
  const sections = () => workspaceSections(props.overview ?? EMPTY)
  return (
    <section class="mafw-work-overview" aria-label="工作概览">
      <div class="mafw-work-overview-head">
        <div class="mafw-work-overview-title">
          <div class="mafw-work-kicker">工作概览</div>
          <div class="mafw-work-total">
            <strong>{props.overview?.total ?? 0}</strong>
            <span>项工作</span>
          </div>
        </div>
        <Show when={props.onOpenAll}>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenAll?.()}>全部历史</ButtonV2>
        </Show>
      </div>
      <Show when={props.error}>
        <div class="mafw-work-error">{props.error}</div>
      </Show>
      <Show when={!props.error && props.loading && !props.overview}>
        <div class="mafw-work-empty">正在加载工作概览…</div>
      </Show>
      <Show when={!props.error && !props.loading && (props.overview?.total ?? 0) === 0}>
        <div class="mafw-work-empty">
          <Icon name="layout-grid" size="large" class="mafw-work-empty-icon" />
          <div>
            <strong>还没有工作项</strong>
            <span>向 Lead 交代一件事，或用「新话题」先讨论。</span>
          </div>
        </div>
      </Show>
      <For each={sections()}>
        {(section) => (
          <Show when={section.count > 0}>
            <div class={`mafw-work-group is-${section.bucket}`}>
              <div class="mafw-work-group-head">
                <span class="mafw-work-group-label">
                  <span class="mafw-work-status-dot" aria-hidden="true" />
                  {LABELS[section.bucket] ?? section.bucket}
                </span>
                <span class="mafw-work-count mafw-work-group-count">{section.count}</span>
              </div>
              <For each={section.goals}>
                {(goal) => (
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-work-item"
                    onClick={() => props.onOpenGoal(goal, attentionTarget(goal.stage.action))}
                  >
                    <span class="mafw-work-item-main">
                      <span class="mafw-work-item-title">{goal.title || "未命名目标"}</span>
                      <span class="mafw-work-item-meta">
                        <Show when={section.bucket === "result_ready" && props.isViewed && !props.isViewed(goal)}>
                          <span class="mafw-work-chip is-unviewed">未查看</span>
                        </Show>
                        <For each={goalChips(goal)}>
                          {(chip) => <span class="mafw-work-chip">{chip}</span>}
                        </For>
                      </span>
                    </span>
                    <Icon name="chevron-right" size="small" class="mafw-work-item-chevron" />
                  </ButtonV2>
                )}
              </For>
            </div>
          </Show>
        )}
      </For>
    </section>
  )
}
