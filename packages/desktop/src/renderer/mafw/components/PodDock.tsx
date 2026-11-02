import { For, Show, createEffect, createSignal, on } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type { PodDetail } from "@mafw/sdk"
import { DockBanner, DockEmpty, DockPanelHeader } from "./dock-panel"
import { PodGoalQueue, PodTaskBoard } from "./PodTaskBoard"
import { PodInbox } from "./PodInbox"
import { PodMemoryPanel } from "./PodMemoryPanel"
import { PodGoalComposer } from "./PodGoalComposer"
import { PodAttentionList } from "./PodAttentionList"
import { PodResultPanel } from "./PodResultPanel"
import { PodTranscriptOverlay } from "./PodTranscriptOverlay"
import type { PodGoalResult } from "@mafw/sdk"
import { podStore } from "../pod-store"
import { deliveryToast } from "../pod-rail-face-model"
import {
  formatPodCost,
  memberOpenTarget,
  podActiveGoalId,
  podHttpStatus,
  podMemberStatusLabel,
  podRoleLabel,
  podStatusLabel,
  shouldCloseTranscript,
} from "../pod-model"

export function PodDock(props: {
  projectDir: string | null
  active: boolean
  onOpenSession: (sid: string, title?: string) => void
  onOpenGoal: (goalId: string) => void
}) {
  const [transcriptSession, setTranscriptSession] = createSignal<string | null>(null)
  const [tab, setTab] = createSignal<"work" | "team" | "memory">("work")
  const [resultGoalId, setResultGoalId] = createSignal<string | null>(null)
  const [composerInitial, setComposerInitial] = createSignal<{
    title: string
    objective?: string
    acceptance?: string[]
  } | undefined>(undefined)
  let transcriptPodId: string | null = null

  // 首次加载归 shell（常驻订阅）；这里只在面板被打开时补一次刷新。
  // 必须用 on()：refresh() 同步读 detail()/refreshing()，裸 effect 会订阅它们，
  // setRefreshing(true/false) 再触发自己 → 无限刷新（pod listMessages / cost 打屏）。
  createEffect(on(() => props.active, (active) => {
    if (active) void podStore.refresh()
  }))

  createEffect(() => {
    const currentPodId = podStore.detail()?.pod.id ?? null
    if (!shouldCloseTranscript(transcriptPodId, currentPodId)) return
    transcriptPodId = null
    setTranscriptSession(null)
  })

  const memberTaskCount = (detail: PodDetail, memberId: string) =>
    detail.tasks.filter(
      (task) => task.ownerMemberId === memberId && task.status !== "done" && task.status !== "failed",
    ).length

  const openMember = (detail: PodDetail, memberId: string) => {
    const target = memberOpenTarget(detail, memberId)
    if (!target) return
    if (target.kind === "transcript") {
      transcriptPodId = detail.pod.id
      setTranscriptSession(target.sessionId)
      return
    }
    const member = detail.members.find((item) => item.id === memberId)
    props.onOpenSession(target.sessionId, `Pod · ${podRoleLabel(member?.role ?? "builder")}`)
  }

  const createGoal = async (input: {
    title: string
    objective: string
    acceptance: string[]
    boundaries: string[]
    planReview: "auto" | "manual"
  }): Promise<boolean> => {
    try {
      const result = await podStore.createGoal({
        title: input.title,
        objective: input.objective,
        acceptance: input.acceptance.length > 0 ? input.acceptance : undefined,
        boundaries: input.boundaries.length > 0 ? input.boundaries : undefined,
        planReview: input.planReview,
      })
      setComposerInitial(undefined)
      const queuedText = result.queueReason === "paused"
        ? "已排队：Pod 已暂停，恢复推进后才会开始"
        : result.queueReason === "archived"
          ? "已排队：Pod 已归档，恢复后才会开始"
          : result.queueReason === "budget"
            ? "已排队：预算不足，等待预算恢复"
            : "已排队，当前目标结束后自动开始"
      showToastV2({
        description: result.status === "started" ? "已交给团队" : queuedText,
        variant: "success",
        duration: 3000,
      } as any)
      return true
    } catch (err: any) {
      showToastV2({
        description: `提交失败：${taskErrorText(err)}`,
        variant: "error",
        duration: 3200,
      } as any)
      return false
    }
  }

  const resubmit = (result: PodGoalResult) => {
    const goal = podStore.detail()?.goals.find((item) => item.goalId === result.goalId)
    setComposerInitial({
      title: `重试：${goal?.title ?? result.goalId}`,
      objective: [
        "上一轮未达成。基于以下证据重新提交目标，不要复活旧 Goal。",
        result.reviewFeedback ? `Review feedback: ${result.reviewFeedback}` : "",
        ...result.tasks.filter((task) => task.result !== "pass").map((task) => `${task.taskId}: ${task.evidence}`),
      ].filter(Boolean).join("\n"),
      acceptance: result.goalAcceptance,
    })
    setResultGoalId(null)
    setTab("work")
  }

  const retryDelivery = async (messageId: string) => {
    const podId = podStore.detail()?.pod.id
    if (!podId) return
    try {
      const result = await window.api.mafw.pod.retryDelivery(podId, messageId)
      showToastV2({ description: result.delivery === "delivered" ? "已重新投递" : "仍待对方下次派活", variant: "success", duration: 2600 } as any)
      await podStore.refresh()
    } catch (err: any) {
      showToastV2({ description: `重试失败：${String(err?.message ?? err).slice(0, 80)}`, variant: "error", duration: 3000 } as any)
    }
  }

  const dismissDelivery = async (messageId: string, memberId: string) => {
    const podId = podStore.detail()?.pod.id
    if (!podId) return
    try {
      await window.api.mafw.pod.dismissDelivery(podId, messageId, memberId)
      await podStore.refresh()
    } catch (err: any) {
      showToastV2({ description: `忽略失败：${String(err?.message ?? err).slice(0, 80)}`, variant: "error", duration: 3000 } as any)
    }
  }

  const cancelQueued = async (goalId: string): Promise<boolean> => {
    try {
      await podStore.cancelGoal(goalId)
      showToastV2({ description: "已取消排队", variant: "success", duration: 2200 } as any)
      return true
    } catch (err: any) {
      showToastV2({ description: `取消失败：${taskErrorText(err)}`, variant: "error", duration: 3000 } as any)
      return false
    }
  }

  const createTask = async (title: string): Promise<boolean> => {
    const podId = podStore.detail()?.pod.id
    if (!podId) return false
    try {
      await window.api.mafw.pod.createTask(podId, { title })
      await podStore.refresh()
      return true
    } catch (err: any) {
      showToastV2({ description: `创建任务失败：${taskErrorText(err)}`, variant: "error", duration: 3000 } as any)
      return false
    }
  }

  const editTask = async (
    taskId: string,
    patch: { title: string; acceptance: string[] },
  ): Promise<boolean> => {
    const podId = podStore.detail()?.pod.id
    if (!podId) return false
    try {
      await window.api.mafw.pod.updateTask(podId, taskId, patch)
      await podStore.refresh()
      return true
    } catch (err: any) {
      showToastV2({ description: `保存失败：${taskErrorText(err)}`, variant: "error", duration: 3000 } as any)
      return false
    }
  }

  const activeGoalId = () => podActiveGoalId(podStore.detail()?.goals ?? [])

  const createPlanTask = async (title: string): Promise<boolean> => {
    const podId = podStore.detail()?.pod.id
    const goalId = activeGoalId()
    if (!podId || !goalId) return false
    try {
      await window.api.mafw.pod.createTask(podId, { plan: true, goalId, title })
      await podStore.refresh()
      return true
    } catch (err: any) {
      showToastV2({ description: `加入计划失败：${taskErrorText(err)}`, variant: "error", duration: 3000 } as any)
      return false
    }
  }

  const renameNote = async (taskId: string, title: string): Promise<boolean> => {
    const podId = podStore.detail()?.pod.id
    if (!podId) return false
    try {
      await window.api.mafw.pod.updateTask(podId, taskId, { title })
      await podStore.refresh()
      return true
    } catch (err: any) {
      showToastV2({ description: `改名失败：${taskErrorText(err)}`, variant: "error", duration: 3000 } as any)
      return false
    }
  }

  const deleteTask = async (taskId: string): Promise<boolean> => {
    const podId = podStore.detail()?.pod.id
    if (!podId) return false
    try {
      await window.api.mafw.pod.deleteTask(podId, taskId)
      await podStore.refresh()
      return true
    } catch (err: any) {
      showToastV2({ description: `删除失败：${taskErrorText(err)}`, variant: "error", duration: 3000 } as any)
      return false
    }
  }

  const sendMessage = async (input: { kind: string; toMemberId: string | null; body: string; notify: boolean }): Promise<string> => {
    const detail = podStore.detail()
    const podId = detail?.pod.id
    const lead = detail?.members.find((member) => member.role === "lead")
    if (!podId || !lead) return "鲸群未就绪"
    const res = await window.api.mafw.pod.sendMessage(podId, {
      fromMemberId: lead.id,
      toMemberId: input.toMemberId ?? undefined,
      kind: input.kind as any,
      body: input.body,
      notify: input.notify,
    })
    await podStore.refresh()
    return input.notify ? deliveryToast(res?.delivery) : "已发送"
  }

  const toggleStatus = () => {
    const status = podStore.detail()?.pod.status
    if (!status || status === "archived") return
    void podStore.setStatus(status === "paused" ? "active" : "paused")
  }

  return (
    <div class="mafw-pod-dock">
      <DockPanelHeader title={`鲸群${podStore.detail() ? ` · ${podStore.detail()!.pod.name}` : ""}`}>
        <Show when={podStore.detail()}>
          <ButtonV2 variant="ghost" size="small" disabled={podStore.busy()} onClick={() => void podStore.refresh()}>
            刷新
          </ButtonV2>
          <Show when={podStore.detail()!.pod.status !== "archived"}>
            <ButtonV2 variant="ghost" size="small" onClick={toggleStatus}>
              {podStore.detail()!.pod.status === "paused" ? "恢复推进" : "暂停推进"}
            </ButtonV2>
          </Show>
        </Show>
      </DockPanelHeader>

      <Show when={props.projectDir} fallback={
        <DockEmpty text="先打开一个会话" hint="鲸群跟随当前项目；打开会话后会自动定位" />
      }>
        <Show when={!podStore.unsupported()} fallback={
          <DockBanner kind="warn" text="当前 gateway 不支持 Pod，请更新 gateway" />
        }>
          <Show when={podStore.detail()} fallback={
            <Show when={podStore.loading()} fallback={
              <Show when={podStore.error()} fallback={
                <DockEmpty
                  text="这个项目还没有鲸群"
                  hint="创建后直接交代第一个目标"
                  action={{ label: "创建鲸群并交代第一个目标", onClick: () => void podStore.create() }}
                />
              }>
                <DockBanner
                  kind="error"
                  text={podStore.error()!}
                  action={{ label: "重试", onClick: () => void podStore.open(props.projectDir!) }}
                />
              </Show>
            }>
              <div class="mafw-pod-loading"><LoaderV2 width={16} height={16} /></div>
            </Show>
          }>
            {(detail) => (
              <>
                <Show when={podStore.error()}>
                  <DockBanner
                    kind="error"
                    text={podStore.error()!}
                    action={{ label: "重试", onClick: () => void podStore.refresh() }}
                  />
                </Show>
                <Show when={detail().stageSupported === false}>
                  <DockBanner kind="warn" text="当前 gateway 是旧版：阶段/注意力投影不可用，请升级 gateway" />
                </Show>

                <div class="mafw-pod-status">
                  <span class={`mafw-pod-status-badge mafw-pod-status-${detail().pod.status}`}>
                    {podStatusLabel(detail().pod.status)}
                  </span>
                  <Show when={detail().goals.find((goal) => goal.status === "active")}>
                    {(goal) => <span class="mafw-pod-status-goal">{goal().title}</span>}
                  </Show>
                  <span class="mafw-pod-status-queue">
                    {detail().goals.filter((goal) => goal.status === "queued").length} 排队
                  </span>
                  <span class="mafw-pod-status-cost">{formatPodCost(podStore.cost())}</span>
                </div>

                <div class="mafw-pod-tabs" role="tablist" aria-label="鲸群视图">
                  <ButtonV2 variant="ghost" size="small" aria-selected={tab() === "work"} onClick={() => setTab("work")}>工作</ButtonV2>
                  <ButtonV2 variant="ghost" size="small" aria-selected={tab() === "team"} onClick={() => setTab("team")}>团队</ButtonV2>
                  <ButtonV2 variant="ghost" size="small" aria-selected={tab() === "memory"} onClick={() => setTab("memory")}>记忆</ButtonV2>
                </div>

                <Show when={tab() === "work"}>
                  <PodGoalComposer
                    busy={podStore.busy()}
                    activeGoalId={activeGoalId()}
                    autofocus={detail().goals.length === 0}
                    initial={composerInitial()}
                    onCreate={createGoal}
                  />

                  <PodAttentionList
                    items={detail().attention}
                    onOpenGoal={props.onOpenGoal}
                  />

                  <PodGoalQueue
                    goals={detail().goals}
                    onOpenGoal={props.onOpenGoal}
                    onOpenResult={setResultGoalId}
                    onCancelGoal={cancelQueued}
                  />
                  <PodTaskBoard
                    tasks={detail().tasks}
                    members={detail().members}
                    busy={podStore.busy()}
                    planGoalId={activeGoalId()}
                    planEditable={(() => {
                      const stage = podStore.detail()?.goals.find((goal) => goal.status === "active")?.stage
                      return !!stage && stage.kind !== "working" && stage.kind !== "queued" && stage.kind !== "ended"
                    })()}
                    onCreate={createTask}
                    onCreatePlan={createPlanTask}
                    onEdit={editTask}
                    onRenameNote={renameNote}
                    onDelete={deleteTask}
                    onOpenGoal={props.onOpenGoal}
                  />
                  <Show when={resultGoalId()}>
                    {(goalId) => (
                      <PodResultPanel
                        podId={detail().pod.id}
                        goalId={goalId()}
                        onClose={() => setResultGoalId(null)}
                        onResubmit={resubmit}
                      />
                    )}
                  </Show>
                </Show>

                <Show when={tab() === "team"}>
                  <div class="mafw-pod-members">
                    <For each={detail().members}>
                      {(member) => {
                        const target = () => memberOpenTarget(detail(), member.id)
                        return (
                          <div
                            class="mafw-pod-member"
                            classList={{ "is-open": !!target() }}
                            role={target() ? "button" : undefined}
                            tabIndex={target() ? 0 : undefined}
                            onClick={() => openMember(detail(), member.id)}
                            onKeyDown={(event) => {
                              if (!target()) return
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                openMember(detail(), member.id)
                              }
                            }}
                          >
                            <span class="mafw-pod-member-role">{podRoleLabel(member.role)}</span>
                            <span class="mafw-pod-member-name">{member.displayName}</span>
                            <span class={`mafw-pod-member-status mafw-pod-member-${member.status}`}>
                              {podMemberStatusLabel(member.status)}
                            </span>
                            <span class="mafw-pod-member-count">
                              {target() ? (target()!.kind === "session" ? "打开会话" : "查看快照") : "空闲"}
                            </span>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                  <Show when={detail().messageHealth.filter((item) => item.attempts >= 3).length > 0}>
                    <div class="mafw-pod-message-health">
                      <div class="mafw-pod-section-head">
                        <span>投递问题</span>
                        <span>{detail().messageHealth.filter((item) => item.attempts >= 3).length}</span>
                      </div>
                      <For each={detail().messageHealth.filter((item) => item.attempts >= 3)}>
                        {(item) => {
                          const message = () => podStore.messages().find((row) => row.id === item.messageId)
                          const member = () => detail().members.find((row) => row.id === item.memberId)
                          return (
                            <div class="mafw-pod-message-health-row">
                              <span>{member()?.displayName ?? "成员"}</span>
                              <span>{item.lastError ?? "投递失败"}</span>
                              <span>{item.attempts} 次</span>
                              <Show when={message()?.toMemberId}>
                                <ButtonV2 variant="ghost" size="small" onClick={() => void retryDelivery(item.messageId)}>重试</ButtonV2>
                              </Show>
                              <ButtonV2 variant="ghost" size="small" onClick={() => void dismissDelivery(item.messageId, item.memberId)}>忽略</ButtonV2>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  </Show>
                  <PodInbox
                    detail={detail()}
                    messages={podStore.messages()}
                    busy={podStore.busy()}
                    onSend={sendMessage}
                    onRead={(id) => { void podStore.markRead(id) }}
                  />
                </Show>

                <Show when={tab() === "memory"}>
                  <PodMemoryPanel podId={detail().pod.id} />
                </Show>
              </>
            )}
          </Show>
        </Show>
      </Show>

      <Show when={transcriptSession() && podStore.detail()}>
        <PodTranscriptOverlay
          podId={podStore.detail()!.pod.id}
          sessionId={transcriptSession()!}
          onClose={() => setTranscriptSession(null)}
        />
      </Show>
    </div>
  )
}

function taskErrorText(err: any): string {
  const status = podHttpStatus(err)
  if (status === 409) return "goal 正在执行或已结束，暂不能改计划"
  if (status === 400) return "该任务不能改计划（手工任务或参数不合法）"
  if (status === 404) return "任务或计划文件不存在"
  return String(err?.message ?? err).slice(0, 60)
}
