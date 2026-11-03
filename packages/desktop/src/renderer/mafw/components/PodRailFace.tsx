// 左 dock 的鲸群面（方案 B：待办优先，spec/research
// docs/research/2026-10-31-pod-rail-information-architecture.md）。
// 左栏只读：待我处理 / 班底 / goal / 最近；写信与「立即提醒」在右栏邮箱。
import { For, Show, createMemo, createSignal } from "solid-js"
import type { PodDetail, PodMessage } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import {
  buildMemberRows,
  buildRecentMessages,
  podCounts,
  podEmptyState,
  railView,
  type PodEmptyState,
} from "../pod-rail-face-model"
import { podGoalResultLabel, podStageLabel, podStatusLabel } from "../pod-model"

export function PodRailFace(props: {
  detail: PodDetail | null
  messages: PodMessage[]
  loading: boolean
  error: string | null
  unsupported: boolean
  isWorktree: boolean
  selfMemberId: string | null
  sessionTitleOf?: (sessionId: string) => string | null
  nowMs?: number
  onRefresh: () => void
  onOpenSession: (sessionId: string) => void
  onOpenGoal: (goalId: string) => void
  onOpenPanel: (panel: "tasks" | "inbox") => void
  onOpenMessage: (messageId: string) => void
  onCreate: () => void
}) {
  const [readingId, setReadingId] = createSignal<string | null>(null)

  const emptyState = createMemo<PodEmptyState>(() =>
    podEmptyState({ hasPod: !!props.detail, unsupported: props.unsupported, isWorktree: props.isWorktree }))
  const rows = createMemo(() => (props.detail
    ? buildMemberRows(props.detail, (id) => props.sessionTitleOf?.(id) ?? null)
    : []))
  const counts = createMemo(() => (props.detail
    ? podCounts(props.detail, props.messages, props.selfMemberId)
    : { review: 0, todo: 0, inbox: 0 }))
  const activeGoal = createMemo(() => props.detail?.goals.find((goal) => goal.status === "active") ?? null)
  const view = createMemo(() => (props.detail ? railView(props.detail) : { todoCount: 0, todoItems: [], reviewCount: 0, recentResults: [] }))
  const recent = createMemo(() => (props.detail
    ? buildRecentMessages(props.detail, props.messages, props.selfMemberId, props.nowMs ?? Date.now(), 5)
    : []))

  const openMessage = async (messageId: string) => {
    setReadingId(messageId)
    try {
      props.onOpenMessage(messageId)
    } finally {
      setReadingId(null)
    }
  }

  return (
    <div class="mafw-pod-rail-face">
      <div class="mafw-pod-rail-head">
        <span class="mafw-pod-rail-title">鲸群</span>
        <Show when={props.detail}>
          {(detail) => <span class="mafw-pod-rail-status">{podStatusLabel(detail().pod.status)}</span>}
        </Show>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            icon="refresh"
            aria-label="刷新鲸群"
            onClick={props.onRefresh}
          />
        </TooltipV2>
      </div>

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
          <p>这个项目还没有鲸群</p>
          <ButtonV2 variant="outline" size="small" onClick={props.onCreate}>创建鲸群</ButtonV2>
        </div>
      </Show>

      <Show when={emptyState() === "ready"}>
        <div class="mafw-pod-rail-label">需要你</div>
        <div class="mafw-pod-rail-counts">
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-pod-rail-count"
            classList={{ hot: (props.detail?.attention.length ?? 0) > 0 }}
            aria-label={`需要你 ${props.detail?.attention.length ?? 0} 项`}
            onClick={() => {
              const first = props.detail?.attention[0]
              if (first) props.onOpenGoal(first.goalId)
              else props.onOpenPanel("tasks")
            }}
          >
            需要你 <b>{props.detail?.attention.length ?? 0}</b>
          </ButtonV2>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-pod-rail-count"
            aria-label={`待办 ${view().todoCount} 项`}
            onClick={() => props.onOpenPanel("tasks")}
          >
            待办 <b>{view().todoCount}</b>
          </ButtonV2>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-pod-rail-count"
            classList={{ accent: counts().inbox > 0 }}
            aria-label={`邮箱 ${counts().inbox} 条未读`}
            onClick={() => props.onOpenPanel("inbox")}
          >
            邮箱 <b>{counts().inbox}</b>
          </ButtonV2>
        </div>
        <Show when={(props.detail?.attention.length ?? 0) > 0}>
          <div class="mafw-pod-rail-attention">
            <For each={props.detail!.attention}>
              {(item) => (
                <ButtonV2 variant="ghost" size="small" class="mafw-pod-rail-attention-row" onClick={() => props.onOpenGoal(item.action.goalId)}>
                  {item.kind === "plan_approval" ? "计划待批准" : item.kind === "question" ? "等待回答" : "需要处理"} · {item.title}
                </ButtonV2>
              )}
            </For>
          </div>
        </Show>

        <div class="mafw-pod-rail-label">班底</div>
        <div class="mafw-pod-rail-members">
          <For each={rows()}>
            {(row) => (
              <div
                class="mafw-pod-rail-member"
                classList={{ active: !!row.sessionId }}
                role={row.canOpen ? "button" : undefined}
                tabIndex={row.canOpen ? 0 : undefined}
                aria-label={row.canOpen ? `打开 ${row.displayName} 的会话` : undefined}
                onClick={() => { if (row.canOpen) props.onOpenSession(row.sessionId ?? "") }}
                onKeyDown={(event) => {
                  if (!row.canOpen) return
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  props.onOpenSession(row.sessionId ?? "")
                }}
              >
                <span class={`mafw-pod-rail-dot ${row.dotClass}`} aria-hidden="true" />
                <div class="mafw-pod-rail-member-main">
                  <div class="mafw-pod-rail-member-top">
                    <span class="mafw-pod-rail-member-name">{row.displayName}</span>
                  </div>
                  <div class="mafw-pod-rail-member-action">{row.action}</div>
                </div>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  icon="square-arrow-top-right"
                  aria-label={`打开 ${row.displayName} 的会话`}
                  disabled={!row.canOpen}
                  onClick={(event: MouseEvent) => {
                    event.stopPropagation()
                    if (row.canOpen) props.onOpenSession(row.sessionId ?? "")
                  }}
                />
              </div>
            )}
          </For>
        </div>

        <Show when={activeGoal()}>
          {(goal) => (
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-pod-rail-goal"
              aria-label={`打开当前目标 ${goal().title}`}
              onClick={() => props.onOpenGoal(goal().goalId)}
            >
              <span class="mafw-pod-rail-goal-label">当前目标</span>
              <span class="mafw-pod-rail-goal-id">{goal().title}</span>
              <span class="mafw-pod-rail-goal-state">{podStageLabel(goal().stage)}</span>
            </ButtonV2>
          )}
        </Show>

        <Show when={view().recentResults.length > 0}>
          <div class="mafw-pod-rail-label">最近结果</div>
          <For each={view().recentResults}>
            {(goal) => (
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-pod-rail-result"
                onClick={() => props.onOpenGoal(goal.goalId)}
              >
                <span>{goal.title}</span>
                <span>{podGoalResultLabel(goal.verdict)}</span>
              </ButtonV2>
            )}
          </For>
        </Show>

        <div class="mafw-pod-rail-label-row">
          <span class="mafw-pod-rail-label">最近消息</span>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-pod-rail-more"
            onClick={() => props.onOpenPanel("inbox")}
          >
            全部 ↗
          </ButtonV2>
        </div>
        <Show
          when={recent().length > 0}
          fallback={<div class="mafw-pod-rail-empty-line">还没有交接消息</div>}
        >
          <div class="mafw-pod-rail-recent">
            <For each={recent()}>
              {(item) => (
                <div
                  class="mafw-pod-rail-message"
                  classList={{ unread: item.unread }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.route}：${item.preview}`}
                  onClick={() => void openMessage(item.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    void openMessage(item.id)
                  }}
                >
                  <span class="mafw-pod-rail-message-dot" aria-hidden="true" />
                  <span class="mafw-pod-rail-message-route">{item.route}</span>
                  <Show when={item.protocol}>
                    <span class="mafw-pod-rail-message-protocol">{item.protocol}</span>
                  </Show>
                  <span class="mafw-pod-rail-message-preview">{item.preview}</span>
                  <span class="mafw-pod-rail-message-time">{item.time}</span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="mafw-pod-rail-foot">发送在右侧 › 执行 › 鲸群 › 邮箱</div>
      </Show>
    </div>
  )
}
