import { Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { GoalUserSummary } from "../goal-user-view"

/**
 * Goal 的第一层用户信息：现在是什么状态、是否需要我、做到哪里。
 * 技术诊断与内部状态不进入这里。
 */
export function GoalUserHero(props: {
  summary: GoalUserSummary
  actionLabel: string | null
  onAction?: () => void
  technicalOpen: boolean
  onToggleTechnical: () => void
}): JSX.Element {
  return (
    <section
      class="mafw-goal-user-hero"
      data-goal-face={props.summary.face}
      data-progress-state={
        props.summary.progressPercent == null
          ? undefined
          : props.summary.progressPercent >= 100
            ? "complete"
            : "active"
      }
    >
      <div class="mafw-goal-user-status">
        <span class="mafw-goal-user-state">{props.summary.statusLabel}</span>
        <span class="mafw-goal-user-owner">{props.summary.ownerLabel}</span>
        <span class="mafw-goal-user-revision">revision {props.summary.revision ?? "—"}</span>
      </div>

      <Show when={props.summary.progressText}>
        {(text) => (
          <div class="mafw-goal-user-progress">
            <span>{text()}</span>
            <Show when={props.summary.progressPercent != null}>
              <span class="mafw-goal-user-percent">{props.summary.progressPercent}%</span>
            </Show>
            <Show when={props.summary.progressPercent != null}>
              <span
                class="mafw-goal-user-progress-track"
                role="progressbar"
                aria-label={`${text()} 完成度`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={props.summary.progressPercent ?? 0}
              >
                <span
                  class="mafw-goal-user-progress-value"
                  style={{ width: `${props.summary.progressPercent ?? 0}%` }}
                />
              </span>
            </Show>
          </div>
        )}
      </Show>

      <div class="mafw-goal-user-next">
        <Show when={props.actionLabel && props.onAction}>
          <ButtonV2 variant="contrast" size="small" onClick={() => props.onAction?.()}>
            {props.actionLabel}
          </ButtonV2>
        </Show>
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-goal-technical-toggle"
          aria-expanded={props.technicalOpen}
          aria-controls={props.technicalOpen ? "mafw-goal-technical" : undefined}
          onClick={props.onToggleTechnical}
        >
          {props.technicalOpen ? "收起技术详情" : "技术详情"}
        </ButtonV2>
      </div>
    </section>
  )
}
