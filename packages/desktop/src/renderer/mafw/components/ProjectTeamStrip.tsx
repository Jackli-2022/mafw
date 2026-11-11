// 项目首页 › 团队条：Pod 是项目属性，不是平行工作空间。
// 只露出人会对话的 Lead / Tech Lead；成员、邮箱、共享记忆进执行抽屉的团队面板。
import { For, Show, createMemo } from "solid-js"
import type { PodDetail } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { buildPodContacts } from "../pod-contact-model"
import { podStatusLabel } from "../pod-model"

export function ProjectTeamStrip(props: {
  detail: PodDetail | null
  loading: boolean
  error: string | null
  unsupported: boolean
  isWorktree: boolean
  onRefresh: () => void
  onOpenLead: () => void
  onOpenTechLead: (goalId: string) => void
  onOpenPanel: (tab: "team" | "memory", target?: "members" | "inbox") => void
  onCreate: () => void
}) {
  const contacts = createMemo(() => buildPodContacts(props.detail))
  const emptyText = (): string => {
    if (props.loading && !props.detail) return "正在加载团队…"
    if (props.error) return props.error
    if (props.unsupported) return "当前 gateway 不支持团队"
    if (props.isWorktree) return "worktree 会话不绑定团队，请在主项目打开"
    return "这个项目还没有团队"
  }
  const canCreate = () =>
    !props.loading && !props.error && !props.unsupported && !props.isWorktree && !props.detail

  return (
    <section class="mafw-project-team-strip" aria-label="项目团队">
      <div class="mafw-project-team-main">
        <span class="mafw-project-team-label">团队</span>
        <Show when={props.detail} fallback={<span class="mafw-project-team-empty">{emptyText()}</span>}>
          {(detail) => (
            <>
              <span class="mafw-project-team-status">{podStatusLabel(detail().pod.status)}</span>
              <For each={contacts()}>
                {(row) => (
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-project-team-chip"
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
                    <span class="mafw-project-team-chip-name">{row.displayName}</span>
                    <span class="mafw-project-team-chip-state">
                      {row.role === "lead" ? "可对话" : row.canOpen ? "讨论中" : "待命"}
                    </span>
                  </ButtonV2>
                )}
              </For>
              <span class="mafw-project-team-count">{detail().members.length} 人</span>
            </>
          )}
        </Show>
      </div>

      <div class="mafw-project-team-actions">
        <Show when={canCreate()}>
          <ButtonV2 variant="outline" size="small" onClick={props.onCreate}>
            创建团队
          </ButtonV2>
        </Show>
        <Show when={props.detail}>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenPanel("team", "members")}>
            <Icon name="team-three" size="small" />
            团队
          </ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenPanel("team", "inbox")}>
            <Icon name="speech-bubble" size="small" />
            邮箱
          </ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenPanel("memory")}>
            <Icon name="bullet-list" size="small" />
            记忆
          </ButtonV2>
        </Show>
        <Show when={props.error}>
          <ButtonV2 variant="ghost" size="small" onClick={props.onRefresh}>
            重试
          </ButtonV2>
        </Show>
        <TooltipV2 value="刷新团队" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            icon="refresh"
            aria-label="刷新团队"
            onClick={props.onRefresh}
          />
        </TooltipV2>
      </div>
    </section>
  )
}
