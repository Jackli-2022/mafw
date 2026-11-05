// 项目资源：团队 / 邮箱 / Pod 记忆 / 手工 notes 的唯一入口。
// 日常 Goal 工作在右工作台「工作」；这里不再充当 Memory/Approvals/Triage/Automation 工具目录。
import { For, Show, createMemo } from "solid-js"
import type { PodDetail, PodMessage } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { buildMemberRows, buildRecentMessages, podAttentionRow, podCounts, podEmptyState, type PodEmptyState } from "../pod-rail-face-model"
import { memberFocus, podStatusLabel } from "../pod-model"
import { requestPodTechLeadOpen } from "../pod-result-store"
import leadAvatar32 from "../assets/lore/lead-avatar-32.png"
import { memberAvatar } from "../lead-avatar"

export function ProjectResources(props: {
  detail: PodDetail | null
  messages: PodMessage[]
  loading: boolean
  error: string | null
  unsupported: boolean
  isWorktree: boolean
  selfMemberId: string | null
  sessionTitleOf?: (sessionId: string) => string | null
  attention: number
  onRefresh: () => void
  onOpenSession: (sessionId: string) => void
  onOpenWork: () => void
  onOpenPanel: (tab: "team" | "memory", target?: "members" | "inbox") => void
  onOpenNotes: () => void
  onCreate: () => void
}) {
  const emptyState = createMemo<PodEmptyState>(() =>
    podEmptyState({ hasPod: !!props.detail, unsupported: props.unsupported, isWorktree: props.isWorktree }))
  const rows = createMemo(() => (props.detail
    ? buildMemberRows(props.detail, (id) => props.sessionTitleOf?.(id) ?? null)
    : []))
  const counts = createMemo(() => (props.detail
    ? podCounts(props.detail, props.messages, props.selfMemberId)
    : { review: 0, todo: 0, inbox: 0 }))
  const attention = createMemo(() => podAttentionRow(props.attention))
  const recentMessages = createMemo(() => (props.detail
    ? buildRecentMessages(props.detail, props.messages, props.selfMemberId, Date.now(), 3)
    : []))

  return (
    <div class="mafw-resources">
      <div class="mafw-pod-rail-head">
        <span class="mafw-pod-rail-title">项目资源</span>
        <Show when={props.detail}>
          {(detail) => <span class="mafw-pod-rail-status">{podStatusLabel(detail().pod.status)}</span>}
        </Show>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            icon="refresh"
            aria-label="刷新项目资源"
            onClick={props.onRefresh}
          />
        </TooltipV2>
      </div>
      <div class="mafw-resources-subtitle">团队、邮箱与共享记忆；Goal 工作在右侧工作台「工作」。</div>

      <Show when={props.loading && !props.detail}>
        <div class="mafw-pod-rail-empty">加载中…</div>
      </Show>
      <Show when={props.error}>
        <div class="mafw-pod-rail-empty">
          <p>{props.error}</p>
          <ButtonV2 variant="ghost" size="small" onClick={props.onRefresh}>重试</ButtonV2>
        </div>
      </Show>
      <Show when={emptyState() === "unsupported" && !props.error}>
        <div class="mafw-pod-rail-empty">当前 gateway 不支持鲸群，请升级</div>
      </Show>
      <Show when={emptyState() === "worktree" && !props.error}>
        <div class="mafw-pod-rail-empty">worktree 会话不绑定鲸群，请在主项目打开</div>
      </Show>
      <Show when={emptyState() === "create" && !props.error}>
        <div class="mafw-pod-rail-empty">
          <p>这个项目还没有团队</p>
          <ButtonV2 variant="outline" size="small" onClick={props.onCreate}>创建团队</ButtonV2>
        </div>
      </Show>

      <Show when={emptyState() === "ready"}>
        <Show when={attention().visible}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-resources-row mafw-resources-attention"
            onClick={() => props.onOpenWork()}
          >
            <span class="mafw-resources-leading"><Icon name="status" size="small" /><span>{attention().label}</span></span>
            <span class="mafw-resources-meta accent">工作台处理</span>
            <Icon name="chevron-right" size="small" class="mafw-resources-chevron" />
          </ButtonV2>
        </Show>
        <div class="mafw-pod-rail-label">团队与设置</div>
        <div class="mafw-resources-list">
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-resources-row"
            onClick={() => props.onOpenPanel("team", "members")}
          >
            <span class="mafw-resources-leading"><Icon name="team-three" size="small" /><span>团队</span></span>
            <span class="mafw-resources-meta">{rows().length} 人</span>
            <Icon name="chevron-right" size="small" class="mafw-resources-chevron" />
          </ButtonV2>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-resources-row"
            onClick={() => props.onOpenPanel("team", "inbox")}
          >
            <span class="mafw-resources-leading"><Icon name="speech-bubble" size="small" /><span>邮箱</span></span>
            <span class="mafw-resources-meta" classList={{ accent: counts().inbox > 0 }}>
              {counts().inbox > 0 ? `${counts().inbox} 条未读` : "协作诊断"}
            </span>
            <Icon name="chevron-right" size="small" class="mafw-resources-chevron" />
          </ButtonV2>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-resources-row"
            onClick={() => props.onOpenPanel("memory")}
          >
            <span class="mafw-resources-leading"><Icon name="bullet-list" size="small" /><span>Pod 记忆</span></span>
            <span class="mafw-resources-meta">POD · MEMORY</span>
            <Icon name="chevron-right" size="small" class="mafw-resources-chevron" />
          </ButtonV2>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-resources-row"
            onClick={props.onOpenNotes}
          >
            <span class="mafw-resources-leading"><Icon name="sticky-note" size="small" /><span>便签</span></span>
            <span class="mafw-resources-meta">不计入工作</span>
            <Icon name="chevron-right" size="small" class="mafw-resources-chevron" />
          </ButtonV2>
        </div>

        <div class="mafw-pod-rail-label">班底</div>
        <div class="mafw-pod-rail-members">
          <For each={rows()}>
            {(row) => {
              const focus = () => (props.detail ? memberFocus(props.detail, row.id) : { focusText: null, target: null })
              const target = () => focus().target
              const avatar = () => memberAvatar(row.role, row.displayName)
              const avatarText = () => {
                const a = avatar()
                return a.kind === "initial" ? a.text : ""
              }
              const isLore = () => avatar().kind === "lore"
              const open = () => {
                // 2026-11-04（spec techlead-goal-entry §3.3）：Tech Lead 行走 Goal 入口
                // （requestPodTechLeadOpen → openTechLead ensure 讨论会话），其余开 live 会话。
                const hit = target()
                if (!hit) return
                if (hit.kind === "techlead") {
                  requestPodTechLeadOpen(hit.goalId, null)
                  return
                }
                props.onOpenSession(hit.sessionId)
              }
              return (
                <div
                  class="mafw-pod-rail-member"
                  classList={{ active: !!target() }}
                  role={target() ? "button" : undefined}
                  tabIndex={target() ? 0 : undefined}
                  aria-label={target() ? `打开 ${row.displayName}：${focus().focusText ?? "会话"}` : undefined}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (!target()) return
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    open()
                  }}
                >
                  <span class={`mafw-resource-avatar is-${row.role}`} aria-hidden="true">
                    <Show when={isLore()} fallback={avatarText()}>
                      <img src={leadAvatar32} alt="" />
                    </Show>
                  </span>
                  <span class={`mafw-pod-rail-dot ${row.dotClass}`} aria-hidden="true" />
                  <div class="mafw-pod-rail-member-main">
                    <div class="mafw-pod-rail-member-top">
                      <span class="mafw-pod-rail-member-name">{row.displayName}</span>
                    </div>
                    <div class="mafw-pod-rail-member-action">
                      {focus().focusText ?? (target() ? "查看快照" : "待命")}
                    </div>
                  </div>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    icon="square-arrow-top-right"
                    aria-label={target() ? `打开 ${row.displayName}：${focus().focusText ?? "会话"}` : undefined}
                    disabled={!target()}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      open()
                    }}
                  />
                </div>
              )
            }}
          </For>
        </div>
      </Show>

        <Show when={recentMessages().length > 0}>
          <div class="mafw-pod-rail-label">最近消息</div>
          <div class="mafw-pod-rail-recent">
            <For each={recentMessages()}>
              {(message) => (
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-pod-rail-message"
                  classList={{ unread: message.unread }}
                  onClick={() => props.onOpenPanel("team", "inbox")}
                >
                  <span class="mafw-pod-rail-message-route">{message.route}</span>
                  <span class="mafw-pod-rail-message-preview">{message.preview || "（空消息）"}</span>
                  <span class="mafw-pod-rail-message-time">{message.time}</span>
                </ButtonV2>
              )}
            </For>
          </div>
        </Show>
      </div>
  )
}
