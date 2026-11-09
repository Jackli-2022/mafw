// 左侧 Pod：Lead / Tech Lead 两个普通会话入口；团队与设置收进次级区域。
import { For, Show, createMemo, createSignal } from "solid-js"
import type { PodDetail } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { podAttentionRow, podEmptyState, type PodEmptyState } from "../pod-rail-face-model"
import { buildPodContacts } from "../pod-contact-model"
import { podStatusLabel } from "../pod-model"

export function ProjectResources(props: {
  detail: PodDetail | null
  loading: boolean
  error: string | null
  unsupported: boolean
  isWorktree: boolean
  attention: number
  onRefresh: () => void
  onOpenLead: () => void
  onOpenTechLead: (goalId: string) => void
  onOpenWork: () => void
  onOpenPanel: (tab: "team" | "memory", target?: "members" | "inbox") => void
  onOpenNotes: () => void
  onCreate: () => void
}) {
  const [moreOpen, setMoreOpen] = createSignal(false)
  const emptyState = createMemo<PodEmptyState>(() =>
    podEmptyState({ hasPod: !!props.detail, unsupported: props.unsupported, isWorktree: props.isWorktree }))
  const attention = createMemo(() => podAttentionRow(props.attention))
  const contacts = createMemo(() => buildPodContacts(props.detail))

  return (
    <div class="mafw-resources">
      <div class="mafw-pod-rail-head">
        <span class="mafw-pod-rail-title">Pod</span>
        <Show when={props.detail}>
          {(detail) => <span class="mafw-pod-rail-status">{podStatusLabel(detail().pod.status)}</span>}
        </Show>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            icon="refresh"
            aria-label="刷新 Pod"
            onClick={props.onRefresh}
          />
        </TooltipV2>
      </div>
      <div class="mafw-resources-subtitle">和 Lead、Tech Lead 讨论；Goal 进展在右侧工作台「工作」。</div>

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
        <div class="mafw-pod-contacts">
          <For each={contacts()}>
            {(row) => (
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-pod-contact"
                classList={{ "is-lead": row.role === "lead" }}
                disabled={!row.canOpen}
                onClick={() => {
                  if (!row.canOpen) return
                  if (row.role === "lead") props.onOpenLead()
                  else if (row.goalId) props.onOpenTechLead(row.goalId)
                }}
              >
                <span class={`mafw-pod-contact-avatar is-${row.role}`} aria-hidden="true">
                  {row.role === "lead" ? "L" : "T"}
                </span>
                <span class="mafw-pod-contact-main">
                  <span class="mafw-pod-contact-top">
                    <span class="mafw-pod-contact-name">{row.displayName}</span>
                    <span class="mafw-pod-contact-state">
                      {row.role === "lead" ? "可对话" : row.canOpen ? "讨论中" : "待命"}
                    </span>
                  </span>
                  <span class="mafw-pod-contact-desc">{row.description}</span>
                  <Show when={row.role === "tech_lead" && row.focusText}>
                    {(text) => <span class="mafw-pod-contact-focus">当前 · {text()}</span>}
                  </Show>
                </span>
              </ButtonV2>
            )}
          </For>
        </div>

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

        <ButtonV2 variant="outline" size="small" class="mafw-pod-new-goal" onClick={props.onCreate}>
          新建 Goal
        </ButtonV2>

        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-resources-toggle"
          aria-expanded={moreOpen()}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span class="mafw-resources-leading">
            <Icon name="layout-grid" size="small" />
            <span>团队、邮箱与共享记忆</span>
          </span>
          <Icon name="chevron-down" size="small" class="mafw-resources-chevron" />
        </ButtonV2>
        <Show when={moreOpen()}>
          <div class="mafw-resources-list">
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-resources-row"
              onClick={() => props.onOpenPanel("team", "members")}
            >
              <span class="mafw-resources-leading"><Icon name="team-three" size="small" /><span>团队</span></span>
              <Icon name="chevron-right" size="small" class="mafw-resources-chevron" />
            </ButtonV2>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-resources-row"
              onClick={() => props.onOpenPanel("team", "inbox")}
            >
              <span class="mafw-resources-leading"><Icon name="speech-bubble" size="small" /><span>邮箱</span></span>
              <span class="mafw-resources-meta">协作记录</span>
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
        </Show>
      </Show>
    </div>
  )
}
