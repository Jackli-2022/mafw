import { For, Show, createSignal } from "solid-js"
import type { PodGoal, PodMember, PodTask } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { groupPodTasks, podGoalStatusLabel, podMemberName, podTaskArtifacts, podTaskStatusLabel } from "../pod-model"

function goalOrder(goal: PodGoal): number {
  if (goal.status === "active") return 0
  if (goal.status === "queued") return 1
  return 2
}

export function PodGoalQueue(props: { goals: PodGoal[]; onOpenGoal: (goalId: string) => void }) {
  const visible = () => {
    const sorted = [...props.goals].sort(
      (a, b) => goalOrder(a) - goalOrder(b) || a.enqueuedAt.localeCompare(b.enqueuedAt),
    )
    const open = sorted.filter((goal) => goal.status === "active" || goal.status === "queued")
    const terminal = sorted.filter((goal) => goal.status !== "active" && goal.status !== "queued").slice(0, 3)
    return [...open, ...terminal]
  }

  const open = (goal: PodGoal) => {
    if (goal.goalId) props.onOpenGoal(goal.goalId)
  }

  return (
    <div class="mafw-pod-goals">
      <div class="mafw-pod-section-head">
        <span>队列</span>
        <span class="mafw-pod-section-count">{props.goals.filter((goal) => goal.status === "queued").length} 排队</span>
      </div>
      <Show when={visible().length > 0} fallback={<div class="mafw-pod-empty-line">暂无工单</div>}>
        <For each={visible()}>
          {(goal) => (
            <div
              class="mafw-pod-goal-row"
              role="button"
              tabIndex={0}
              onClick={() => open(goal)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  open(goal)
                }
              }}
            >
              <span class={`mafw-pod-goal-status mafw-pod-goal-${goal.status}`}>{podGoalStatusLabel(goal.status)}</span>
              <span class="mafw-pod-goal-id">{goal.goalId}</span>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}

export function PodTaskBoard(props: {
  tasks: PodTask[]
  members: PodMember[]
  busy: boolean
  onCreate: (title: string) => Promise<void>
  onOpenGoal: (goalId: string) => void
}) {
  const [creating, setCreating] = createSignal(false)
  const [title, setTitle] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  const submit = async () => {
    const value = title().trim()
    if (!value || submitting() || props.busy) return
    setSubmitting(true)
    try {
      await props.onCreate(value)
      setTitle("")
      setCreating(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div class="mafw-pod-board-wrap">
      <div class="mafw-pod-section-head">
        <span>任务板</span>
        <ButtonV2 variant="ghost" size="small" disabled={props.busy} onClick={() => setCreating((value) => !value)}>
          {creating() ? "取消" : "新建"}
        </ButtonV2>
      </div>

      <Show when={creating()}>
        <div class="mafw-pod-task-create">
          <TextInputV2
            value={title()}
            placeholder="手工任务标题"
            onInput={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit()
              if (event.key === "Escape") setCreating(false)
            }}
          />
          <ButtonV2 variant="outline" size="small" disabled={!title().trim() || submitting() || props.busy} onClick={() => void submit()}>
            添加
          </ButtonV2>
        </div>
      </Show>

      <div class="mafw-pod-board">
        <For each={groupPodTasks(props.tasks)}>
          {(lane) => (
            <div class="mafw-pod-lane">
              <div class="mafw-pod-lane-head">
                <span>{lane.label}</span>
                <span class="mafw-pod-lane-count">{lane.tasks.length}</span>
              </div>
              <For each={lane.tasks}>
                {(task) => {
                  const artifacts = () => podTaskArtifacts(task)
                  const open = () => {
                    if (task.goalId) props.onOpenGoal(task.goalId)
                  }
                  return (
                    <div
                      class="mafw-pod-task"
                      classList={{ "is-link": !!task.goalId }}
                      role={task.goalId ? "button" : undefined}
                      tabIndex={task.goalId ? 0 : undefined}
                      onClick={open}
                      onKeyDown={(event) => {
                        if (!task.goalId) return
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          open()
                        }
                      }}
                    >
                      <span class="mafw-pod-task-title">{task.title}</span>
                      <span class="mafw-pod-task-meta">
                        {podMemberName({ members: props.members }, task.ownerMemberId)} · {podTaskStatusLabel(task.status)}
                      </span>
                      <Show when={artifacts().length > 0}>
                        <span class="mafw-pod-task-artifacts">{artifacts().length} 个产物</span>
                      </Show>
                    </div>
                  )
                }}
              </For>
              <Show when={lane.tasks.length === 0}>
                <div class="mafw-pod-lane-empty">—</div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
