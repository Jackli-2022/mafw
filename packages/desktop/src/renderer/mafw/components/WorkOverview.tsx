import { For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { PodGoal, PodWorkOverview } from "@mafw/sdk"
import { workspaceSections } from "../workspace-model"
import { attentionTarget, type GoalDetailFocus } from "../pod-model"

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

function goalMeta(goal: PodGoal): string {
  const revision = typeof goal.revision === "number" ? `rev ${goal.revision}` : ""
  const strategy = goal.strategy === "quick"
    ? "快速执行"
    : goal.strategy === "collaborative"
      ? "协作"
      : ""
  const assessment = goal.assessment === "unreviewed" ? "未独立评审" : ""
  return [revision, strategy, assessment].filter(Boolean).join(" · ")
}

/** One Overview projection: every count is the length of the list below it. */
export function WorkOverview(props: {
  overview: PodWorkOverview | null
  loading?: boolean
  error?: string | null
  onOpenGoal: (goal: PodGoal, focus: GoalDetailFocus) => void
  onOpenAll?: () => void
}) {
  const sections = () => workspaceSections(props.overview ?? EMPTY)
  return (
    <section class="mafw-work-overview" aria-label="工作概览">
      <div class="mafw-work-overview-head">
        <div>
          <div class="mafw-work-kicker">工作概览</div>
          <div class="mafw-work-total">{props.overview?.total ?? 0} 项工作</div>
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
        <div class="mafw-work-empty">还没有工作项。向 Lead 交代一件事，或用「新话题」先讨论。</div>
      </Show>
      <For each={sections()}>
        {(section) => (
          <Show when={section.count > 0}>
            <div class="mafw-work-group">
              <div class="mafw-work-group-head">
                <span>{LABELS[section.bucket] ?? section.bucket}</span>
                <span class="mafw-work-count">{section.count}</span>
              </div>
              <For each={section.goals}>
                {(goal) => (
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-work-item"
                    onClick={() => props.onOpenGoal(goal, attentionTarget(goal.stage.action))}
                  >
                    <span class="mafw-work-item-title">{goal.title || "未命名目标"}</span>
                    <span class="mafw-work-item-meta">{goalMeta(goal)}</span>
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
