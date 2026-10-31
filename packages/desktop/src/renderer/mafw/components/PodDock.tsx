import { For, Show, createEffect, createSignal } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type { PodDetail } from "@mafw/sdk"
import { DockBanner, DockEmpty, DockPanelHeader } from "./dock-panel"
import { PodGoalQueue, PodTaskBoard } from "./PodTaskBoard"
import { PodInbox } from "./PodInbox"
import { PodMemoryPanel } from "./PodMemoryPanel"
import { PodTranscriptOverlay } from "./PodTranscriptOverlay"
import { podStore } from "../pod-store"
import {
  formatPodCost,
  memberOpenTarget,
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
  let transcriptPodId: string | null = null

  createEffect(() => {
    if (!props.active) return
    const dir = props.projectDir
    if (dir) void podStore.open(dir)
  })

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

  const createTask = async (title: string): Promise<boolean> => {
    const podId = podStore.detail()?.pod.id
    if (!podId) return false
    try {
      await window.api.mafw.pod.createTask(podId, { title })
      await podStore.refresh()
      return true
    } catch (err: any) {
      showToastV2({ description: `创建任务失败：${String(err?.message ?? err).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
      return false
    }
  }

  const sendMessage = async (input: { kind: string; toMemberId: string | null; body: string }) => {
    const detail = podStore.detail()
    const podId = detail?.pod.id
    const lead = detail?.members.find((member) => member.role === "lead")
    if (!podId || !lead) return
    await window.api.mafw.pod.sendMessage(podId, {
      fromMemberId: lead.id,
      toMemberId: input.toMemberId ?? undefined,
      kind: input.kind as any,
      body: input.body,
    })
    await podStore.refresh()
  }

  const toggleStatus = () => {
    const status = podStore.detail()?.pod.status
    if (!status) return
    void podStore.setStatus(status === "active" ? "idle" : "active")
  }

  return (
    <div class="mafw-pod-dock">
      <DockPanelHeader title={`鲸群${podStore.detail() ? ` · ${podStore.detail()!.pod.name}` : ""}`}>
        <Show when={podStore.detail()}>
          <ButtonV2 variant="ghost" size="small" disabled={podStore.busy()} onClick={() => void podStore.refresh()}>
            刷新
          </ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={toggleStatus}>
            {podStore.detail()!.pod.status === "active" ? "休眠" : "唤醒"}
          </ButtonV2>
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
                  hint="创建后会有 Lead / Builder / Reviewer 三人班底"
                  action={{ label: "创建鲸群", onClick: () => void podStore.create() }}
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

                <div class="mafw-pod-status">
                  <span class={`mafw-pod-status-badge mafw-pod-status-${detail().pod.status}`}>
                    {podStatusLabel(detail().pod.status)}
                  </span>
                  <Show when={detail().pod.activeGoalId}>
                    <span class="mafw-pod-status-goal">{detail().pod.activeGoalId}</span>
                  </Show>
                  <span class="mafw-pod-status-queue">
                    {detail().goals.filter((goal) => goal.status === "queued").length} 排队
                  </span>
                  <span class="mafw-pod-status-cost">{formatPodCost(podStore.cost())}</span>
                </div>

                <div class="mafw-pod-members">
                  <For each={detail().members}>
                    {(member) => {
                      const target = () => memberOpenTarget(detail(), member.id)
                      const count = () => memberTaskCount(detail(), member.id)
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
                          <span class="mafw-pod-member-agent">{member.agentName}</span>
                          <span class={`mafw-pod-member-status mafw-pod-member-${member.status}`}>
                            {podMemberStatusLabel(member.status)}
                          </span>
                          <span class="mafw-pod-member-count">
                            {count() > 0 ? `${count()} 任务` : target() ? (target()!.kind === "session" ? "打开会话" : "查看快照") : "空闲"}
                          </span>
                        </div>
                      )
                    }}
                  </For>
                </div>

                <PodGoalQueue goals={detail().goals} onOpenGoal={props.onOpenGoal} />
                <PodTaskBoard
                  tasks={detail().tasks}
                  members={detail().members}
                  busy={podStore.busy()}
                  onCreate={createTask}
                  onOpenGoal={props.onOpenGoal}
                />
                <PodInbox
                  detail={detail()}
                  messages={podStore.messages()}
                  busy={podStore.busy()}
                  onSend={sendMessage}
                  onRead={(id) => { void podStore.markRead(id) }}
                />
                <PodMemoryPanel podId={detail().pod.id} />
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
