// 团队与设置（Task 15）：从日常导航退役后，只保留团队会话、协作诊断、
// 邮箱与 Pod 记忆。Goal 创建/列表/任务板/结果都在右工作台「工作」与 Goal 详情。
import { For, Show, createEffect, createSignal, on } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type { PodDetail } from "@mafw/sdk"
import { DockBanner, DockEmpty, DockPanelHeader } from "./dock-panel"
import { PodInbox } from "./PodInbox"
import { PodMemoryPanel } from "./PodMemoryPanel"
import { PodTranscriptOverlay } from "./PodTranscriptOverlay"
import { podStore } from "../pod-store"
import { deliveryToast } from "../pod-rail-face-model"
import { requestPodTechLeadOpen } from "../pod-result-store"
import {
  memberFocus,
  podMemberStatusLabel,
  podRoleLabel,
  podStatusLabel,
  shouldCloseTranscript,
} from "../pod-model"

export function PodDock(props: {
  projectDir: string | null
  active: boolean
  onOpenSession: (sid: string, title?: string) => void
  panelRequest?: { tab: "team" | "memory"; seq: number; target?: "members" | "inbox" }
}) {
  const [transcriptSession, setTranscriptSession] = createSignal<string | null>(null)
  const [tab, setTab] = createSignal<"team" | "memory">("team")
  let transcriptPodId: string | null = null

  // Shell 的「团队/邮箱/Pod 记忆」入口通过 request 指定要打开的 tab；
  // 切换后再滚动到对应分区（tab 未渲染时滚动会找不到目标）。
  createEffect(() => {
    const request = props.panelRequest
    if (!request) return
    setTab(request.tab)
    if (request.seq <= 0) return
    setTimeout(() => {
      if (request.tab !== "team") return
      const selector = request.target === "inbox" ? ".mafw-pod-inbox" : ".mafw-pod-members"
      document.querySelector(selector)?.scrollIntoView({ block: "start" })
    }, 0)
  })

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

  const openMember = (detail: PodDetail, memberId: string) => {
    // 2026-11-04（spec techlead-goal-entry §3.3）：行 = 目录 + 当前焦点。
    // Tech Lead 行走 Goal 入口（ensure 讨论会话）；其余成员开 live 会话 / transcript。
    const target = memberFocus(detail, memberId).target
    if (!target) return
    if (target.kind === "techlead") {
      requestPodTechLeadOpen(target.goalId, null)
      return
    }
    if (target.kind === "transcript") {
      transcriptPodId = detail.pod.id
      setTranscriptSession(target.sessionId)
      return
    }
    props.onOpenSession(target.sessionId)
  }

  const sendMessage = async (input: { kind: string; toMemberId: string | null; body: string; notify: boolean }): Promise<string> => {
    const detail = podStore.detail()
    const podId = detail?.pod.id
    const lead = detail?.members.find((member) => member.role === "lead")
    if (!podId || !lead) return "团队未就绪"
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

  const toggleStatus = () => {
    const status = podStore.detail()?.pod.status
    if (!status || status === "archived") return
    void podStore.setStatus(status === "paused" ? "active" : "paused")
  }

  return (
    <div class="mafw-pod-dock">
      <DockPanelHeader title={`团队与设置${podStore.detail() ? ` · ${podStore.detail()!.pod.name}` : ""}`}>
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
        <DockEmpty text="先打开一个会话" hint="团队跟随当前项目；打开会话后会自动定位" />
      }>
        <Show when={!podStore.unsupported()} fallback={
          <DockBanner kind="warn" text="当前 gateway 不支持 Pod，请更新 gateway" />
        }>
          <Show when={podStore.detail()} fallback={
            <Show when={podStore.loading()} fallback={
              <Show when={podStore.error()} fallback={
                <DockEmpty
                  text="这个项目还没有团队"
                  hint="在项目资源里创建团队，然后从右工作台「工作」向 Lead 交代工作"
                  action={{ label: "创建团队", onClick: () => void podStore.create() }}
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
                  <span class="mafw-pod-status-queue">
                    {detail().goals.filter((goal) => goal.status === "active").length} 进行中
                  </span>
                </div>

                <div class="mafw-pod-tabs" role="tablist" aria-label="团队视图">
                  <ButtonV2 variant="ghost" size="small" aria-selected={tab() === "team"} onClick={() => setTab("team")}>团队</ButtonV2>
                  <ButtonV2 variant="ghost" size="small" aria-selected={tab() === "memory"} onClick={() => setTab("memory")}>记忆</ButtonV2>
                </div>

                <Show when={tab() === "team"}>
                  <div class="mafw-pod-members">
                    <For each={detail().members}>
                      {(member) => {
                        const focus = () => memberFocus(detail(), member.id)
                        const target = () => focus().target
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
                              {focus().focusText ?? (target() ? "查看快照" : "待命")}
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
