// 项目资源（Task 15）：团队 / 邮箱 / Pod 记忆 / 手工 notes 的唯一入口。
// 日常 Goal 工作在工作空间；这里只保留协作诊断、团队会话与工具链接。
import { For, Show, createMemo } from "solid-js"
import type { PodDetail, PodMessage } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { buildMemberRows, podCounts, podEmptyState, type PodEmptyState } from "../pod-rail-face-model"
import { memberOpenTarget, podStatusLabel } from "../pod-model"
import { PAGE_LINKS } from "../page-links"
import type { NavTab } from "./nav-tab"

export function ProjectResources(props: {
  detail: PodDetail | null
  messages: PodMessage[]
  loading: boolean
  error: string | null
  unsupported: boolean
  isWorktree: boolean
  selfMemberId: string | null
  sessionTitleOf?: (sessionId: string) => string | null
  onRefresh: () => void
  onOpenSession: (sessionId: string) => void
  onOpenGoal: (goalId: string) => void
  onOpenPanel: (tab: "team" | "memory", target?: "members" | "inbox") => void
  onOpenNotes: () => void
  onNavigate: (tab: NavTab) => void
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
  const activeGoal = createMemo(() => props.detail?.goals.find((goal) => goal.status === "active") ?? null)
  const toolLinks = createMemo(() => PAGE_LINKS.filter((link) => link.id !== "goals"))

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
        <div class="mafw-pod-rail-label">团队与设置</div>
        <div class="mafw-resources-list">
          <ButtonV2 variant="ghost" size="small" class="mafw-resources-row" onClick={() => props.onOpenPanel("team", "members")}>
            <span>团队</span>
            <span class="mafw-resources-meta">{rows().length} 人</span>
          </ButtonV2>
          <ButtonV2 variant="ghost" size="small" class="mafw-resources-row" onClick={() => props.onOpenPanel("team", "inbox")}>
            <span>邮箱</span>
            <span class="mafw-resources-meta" classList={{ accent: counts().inbox > 0 }}>
              {counts().inbox > 0 ? `${counts().inbox} 条未读` : "协作诊断"}
            </span>
          </ButtonV2>
          <ButtonV2 variant="ghost" size="small" class="mafw-resources-row" onClick={() => props.onOpenPanel("memory")}>
            <span>Pod 记忆</span>
            <span class="mafw-resources-meta">POD · MEMORY · GLOSSARY</span>
          </ButtonV2>
          <ButtonV2 variant="ghost" size="small" class="mafw-resources-row" onClick={props.onOpenNotes}>
            <span>便签</span>
            <span class="mafw-resources-meta">手工记录，不计入工作</span>
          </ButtonV2>
        </div>

        <Show when={activeGoal()}>
          {(goal) => (
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-resources-row mafw-resources-goal"
              aria-label={`打开当前目标 ${goal().title}`}
              onClick={() => props.onOpenGoal(goal().goalId)}
            >
              <span>当前目标 · {goal().title}</span>
              <span class="mafw-resources-meta">打开详情</span>
            </ButtonV2>
          )}
        </Show>

        <div class="mafw-pod-rail-label">班底</div>
        <div class="mafw-pod-rail-members">
          <For each={rows()}>
            {(row) => {
              const target = () => (props.detail ? memberOpenTarget(props.detail, row.id) : null)
              const open = () => {
                const hit = target()
                if (hit) props.onOpenSession(hit.sessionId)
              }
              return (
                <div
                  class="mafw-pod-rail-member"
                  classList={{ active: !!target() }}
                  role={target() ? "button" : undefined}
                  tabIndex={target() ? 0 : undefined}
                  aria-label={target() ? `打开 ${row.displayName} 的会话` : undefined}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (!target()) return
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    open()
                  }}
                >
                  <span class={`mafw-pod-rail-dot ${row.dotClass}`} aria-hidden="true" />
                  <div class="mafw-pod-rail-member-main">
                    <div class="mafw-pod-rail-member-top">
                      <span class="mafw-pod-rail-member-name">{row.displayName}</span>
                    </div>
                    <div class="mafw-pod-rail-member-action">
                      {target()
                        ? (target()!.kind === "session" ? "打开会话" : "查看快照")
                        : row.action}
                    </div>
                  </div>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    icon="square-arrow-top-right"
                    aria-label={`打开 ${row.displayName} 的会话`}
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

      <div class="mafw-pod-rail-label">工具</div>
      <div class="mafw-resources-list">
        <For each={toolLinks()}>
          {(link) => (
            <ButtonV2 variant="ghost" size="small" class="mafw-resources-row" onClick={() => props.onNavigate(link.id)}>
              <span>{link.label}</span>
            </ButtonV2>
          )}
        </For>
      </div>
    </div>
  )
}
