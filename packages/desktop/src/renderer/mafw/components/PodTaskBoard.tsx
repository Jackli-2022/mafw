import { For, Show, createSignal } from "solid-js"
import type { PodGoal, PodMember, PodTask } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import {
  canEditPlanTask,
  formatAcceptanceLines,
  groupPodTasks,
  goalQueueRow,
  parseAcceptanceLines,
  planTaskOnly,
  noteTasksOnly,
  podMemberName,
  podTaskAcceptance,
  podTaskArtifacts,
  podTaskStatusLabel,
  terminalGoalsNewestFirst,
} from "../pod-model"

function goalOrder(goal: PodGoal): number {
  if (goal.status === "active") return 0
  if (goal.status === "queued") return 1
  return 2
}

export function PodGoalQueue(props: {
  goals: PodGoal[]
  onOpenGoal: (goalId: string) => void
  onOpenResult?: (goalId: string) => void
  onCancelGoal?: (goalId: string) => Promise<boolean>
}) {
  const [cancelId, setCancelId] = createSignal<string | null>(null)
  const [cancelling, setCancelling] = createSignal(false)
  const cancel = async (goalId: string) => {
    if (!props.onCancelGoal || cancelling()) return
    setCancelling(true)
    try {
      if (await props.onCancelGoal(goalId)) setCancelId(null)
    } finally {
      setCancelling(false)
    }
  }
  const visible = () => {
    const sorted = [...props.goals].sort(
      (a, b) => goalOrder(a) - goalOrder(b) || a.enqueuedAt.localeCompare(b.enqueuedAt),
    )
    const open = sorted.filter((goal) => goal.status === "active" || goal.status === "queued")
    const terminal = terminalGoalsNewestFirst(sorted).slice(0, 3)
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
              <span class={`mafw-pod-goal-status mafw-pod-goal-${goal.status}`}>{goal.stage.owner === "person" ? "需要你" : goal.stage.kind === "ended" ? "已结束" : "进行中"}</span>
              <span class="mafw-pod-goal-title">{goalQueueRow(goal)}</span>
              <Show when={goal.resultReady && props.onOpenResult}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  onClick={(event: MouseEvent) => {
                    event.stopPropagation()
                    props.onOpenResult!(goal.goalId)
                  }}
                >
                  结果
                </ButtonV2>
              </Show>
              <Show when={goal.status === "queued" && props.onCancelGoal}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  disabled={cancelling()}
                  onClick={(event: MouseEvent) => {
                    event.stopPropagation()
                    if (cancelId() === goal.goalId) void cancel(goal.goalId)
                    else setCancelId(goal.goalId)
                  }}
                >
                  {cancelId() === goal.goalId ? (cancelling() ? "取消中…" : "确认取消") : "取消排队"}
                </ButtonV2>
              </Show>
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
  planGoalId: string | null
  planEditable: boolean
  onCreate: (title: string) => Promise<boolean>
  onCreatePlan: (title: string) => Promise<boolean>
  onEdit: (taskId: string, patch: { title: string; acceptance: string[] }) => Promise<boolean>
  onDelete: (taskId: string) => Promise<boolean>
  onOpenGoal: (goalId: string) => void
}) {
  const [creating, setCreating] = createSignal(false)
  const [createMode, setCreateMode] = createSignal<"manual" | "plan">("manual")
  const [title, setTitle] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editTitle, setEditTitle] = createSignal("")
  const [editAcceptance, setEditAcceptance] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [deletingId, setDeletingId] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)

  const startEdit = (task: PodTask) => {
    setCreating(false)
    setDeletingId(null)
    setEditingId(task.id)
    setEditTitle(task.title)
    setEditAcceptance(formatAcceptanceLines(podTaskAcceptance(task)))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTitle("")
    setEditAcceptance("")
  }

  const saveEdit = async (taskId: string) => {
    const value = editTitle().trim()
    if (!value || saving() || props.busy) return
    setSaving(true)
    try {
      const ok = await props.onEdit(taskId, { title: value, acceptance: parseAcceptanceLines(editAcceptance()) })
      if (ok) cancelEdit()
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async (taskId: string) => {
    if (deleting() || props.busy) return
    setDeleting(true)
    try {
      const ok = await props.onDelete(taskId)
      if (ok) setDeletingId(null)
    } finally {
      setDeleting(false)
    }
  }

  const submit = async () => {
    const value = title().trim()
    if (!value || submitting() || props.busy) return
    if (createMode() === "plan" && !props.planGoalId) return
    const plan = createMode() === "plan" && !!props.planGoalId
    setSubmitting(true)
    try {
      const ok = plan ? await props.onCreatePlan(value) : await props.onCreate(value)
      if (!ok) return
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
          <Show when={props.planGoalId}>
            <div class="mafw-pod-task-create-mode">
              <ButtonV2
                variant="ghost"
                size="small"
                aria-pressed={createMode() === "manual"}
                onClick={() => setCreateMode("manual")}
              >
                备注
              </ButtonV2>
              <ButtonV2
                variant="ghost"
                size="small"
                aria-pressed={createMode() === "plan"}
                onClick={() => setCreateMode("plan")}
              >
                加入计划
              </ButtonV2>
            </div>
          </Show>
          <TextInputV2
            value={title()}
            placeholder={createMode() === "plan" ? "追加到计划最后一个 wave" : "备注（不会自动执行）"}
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
        <For each={groupPodTasks(planTaskOnly(props.tasks).filter((task) => task.goalId === props.planGoalId))}>
          {(lane) => (
            <div class="mafw-pod-lane">
              <div class="mafw-pod-lane-head">
                <span>{lane.label}</span>
                <span class="mafw-pod-lane-count">{lane.tasks.length}</span>
              </div>
              <For each={lane.tasks}>
                {(task) => {
                  const artifacts = () => podTaskArtifacts(task)
                  const acceptanceCount = () => podTaskAcceptance(task).length
                  const editable = () => props.planEditable && canEditPlanTask(task)
                  const open = () => {
                    if (task.goalId) props.onOpenGoal(task.goalId)
                  }
                  return (
                    <>
                      <div
                        class="mafw-pod-task"
                        classList={{ "is-link": !!task.goalId, "is-editing": editingId() === task.id }}
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
                        <Show when={acceptanceCount() > 0}>
                          <span class="mafw-pod-task-artifacts">{acceptanceCount()} 条验收</span>
                        </Show>
                        <Show when={artifacts().length > 0}>
                          <span class="mafw-pod-task-artifacts">{artifacts().length} 个产物</span>
                        </Show>
                        <Show when={editable()}>
                          <div class="mafw-pod-task-actions" onClick={(event) => event.stopPropagation()}>
                            <ButtonV2
                              variant="ghost"
                              size="small"
                              disabled={props.busy || saving()}
                              onClick={() => {
                                if (editingId() === task.id) cancelEdit()
                                else startEdit(task)
                              }}
                            >
                              {editingId() === task.id ? "取消编辑" : "编辑"}
                            </ButtonV2>
                            <Show when={deletingId() !== task.id}>
                              <ButtonV2
                                variant="ghost"
                                size="small"
                                disabled={props.busy || deleting()}
                                onClick={() => {
                                  setCreating(false)
                                  cancelEdit()
                                  setDeletingId(task.id)
                                }}
                              >
                                删除
                              </ButtonV2>
                            </Show>
                          </div>
                        </Show>
                        <Show when={deletingId() === task.id}>
                          <div class="mafw-pod-task-delete" onClick={(event) => event.stopPropagation()}>
                            <span class="mafw-pod-task-edit-hint">删除这条计划任务？（不影响历史回执）</span>
                            <ButtonV2 variant="ghost" size="small" onClick={() => setDeletingId(null)}>取消</ButtonV2>
                            <ButtonV2
                              variant="contrast"
                              size="small"
                              disabled={deleting() || props.busy}
                              onClick={() => void confirmDelete(task.id)}
                            >
                              {deleting() ? "删除中…" : "确认删除"}
                            </ButtonV2>
                          </div>
                        </Show>
                      </div>
                      <Show when={editingId() === task.id}>
                        <div
                          class="mafw-pod-task-edit"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") cancelEdit()
                          }}
                        >
                          <span class="mafw-pod-task-edit-label">标题</span>
                          <TextInputV2
                            value={editTitle()}
                            placeholder="任务标题"
                            onInput={(event) => setEditTitle(event.currentTarget.value)}
                          />
                          <span class="mafw-pod-task-edit-label">验收（一行一条）</span>
                          <TextareaV2
                            rows={4}
                            value={editAcceptance()}
                            placeholder="例如：npm test -- pod 全绿"
                            onInput={(event) => setEditAcceptance(event.currentTarget.value)}
                          />
                          <div class="mafw-pod-task-edit-actions">
                            <span class="mafw-pod-task-edit-hint">只对当前轮生效</span>
                            <ButtonV2 variant="ghost" size="small" onClick={cancelEdit}>取消</ButtonV2>
                            <ButtonV2
                              variant="contrast"
                              size="small"
                              disabled={!editTitle().trim() || saving() || props.busy}
                              onClick={() => void saveEdit(task.id)}
                            >
                              {saving() ? "保存中…" : "保存"}
                            </ButtonV2>
                          </div>
                        </div>
                      </Show>
                    </>
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

      <Show when={props.tasks.some((task) => task.kind === "external_request")}>
        <div class="mafw-pod-notes">
          <div class="mafw-pod-section-head">
            <span>外部请求（未纳入执行计划）</span>
            <span class="mafw-pod-section-count">{props.tasks.filter((task) => task.kind === "external_request").length}</span>
          </div>
          <For each={props.tasks.filter((task) => task.kind === "external_request")}>
            {(task) => <div class="mafw-pod-note-row"><span>{task.title}</span></div>}
          </For>
        </div>
      </Show>

      <div class="mafw-pod-notes">
        <div class="mafw-pod-section-head">
          <span>备注</span>
          <span class="mafw-pod-section-count">{noteTasksOnly(props.tasks).length}</span>
        </div>
        <Show when={noteTasksOnly(props.tasks).length > 0} fallback={<div class="mafw-pod-empty-line">没有备注</div>}>
          <For each={noteTasksOnly(props.tasks)}>
            {(task) => (
              <div class="mafw-pod-note-row">
                <span>{task.title}</span>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  disabled={props.busy}
                  onClick={() => void props.onDelete(task.id)}
                >
                  删除
                </ButtonV2>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
