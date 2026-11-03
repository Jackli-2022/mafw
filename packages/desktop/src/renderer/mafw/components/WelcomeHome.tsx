import { createMemo, createSignal, Show, For, createEffect, onCleanup } from "solid-js"
import { allWithFailureFlag } from "../connection-state"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon as IconV2 } from "@mafw/ui/v2/icon"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { formatRailTitle } from "./rail-display"
import { isLeadRole } from "../lead-session"

/**
 * Startup welcome pane ("今天要做什么？"). Rendered when the app launches
 * with no active chat session: project switcher (horizontal chips), quick
 * actions, active goals, pending-work overview and recent sessions.
 */

type WelcomeProject = { id: string; worktree: string }

export function WelcomeHome(props: {
  projects: WelcomeProject[]
  currentProject: string | null
  onSelectProject: (worktree: string) => void
  openSessions: { id: string; title?: string; metadata?: { mafw?: { role?: string } } }[]
  historySessions: { id: string; title?: string; time?: { updated?: number }; metadata?: { mafw?: { role?: string } } }[]
  onSelect: (sid: string) => void
  onCreate: () => void
  onNavigate: (tab: "chat" | "goals" | "memory" | "approvals" | "triage" | "automation") => void
  onOpenLead: () => Promise<boolean>
  onOpenGoalComposer: () => void
  /** plan-first 引导（切片 3）：能力门由 MafwShell 传（primaryAgents 含 plan） */
  hasPlanAgent?: boolean
  onStartWithPlan?: () => void
}) {
  const [approvals, setApprovals] = createSignal<any[]>([])
  const [triage, setTriage] = createSignal<any[]>([])
  const [automations, setAutomations] = createSignal<any[]>([])
  const [connected, setConnected] = createSignal(true)
  const [loading, setLoading] = createSignal(true)

  async function fetchAll() {
    // Per-item .catch(() => []) made the outer catch unreachable — the
    // "Gateway 服务未连接" banner below could never show. Track failures
    // explicitly instead (allWithFailureFlag).
    const { values, failed } = await allWithFailureFlag(
      [
        () => window.api.mafw.approvals.list(),
        () => window.api.mafw.triage.list(),
        () => window.api.mafw.automations.list(),
      ],
      [] as any[],
    )
    const [a, t, auto] = values
    setApprovals(Array.isArray(a) ? a : [])
    setTriage(Array.isArray(t) ? t : [])
    setAutomations(Array.isArray(auto) ? auto : [])
    setConnected(!failed)
    setLoading(false)
  }

  createEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 15000)
    onCleanup(() => clearInterval(interval))
  })

  const pendingApprovals = createMemo(() => (approvals() || []).filter((a) => a?.status === "pending").length)
  const triageCount = createMemo(() => (triage() || []).length)
  const enabledAutomations = createMemo(() => (automations() || []).filter((a) => a?.enabled).length)

  const recentSessions = createMemo(() => {
    const seen = new Set<string>()
    const merged: { id: string; title: string; time?: number }[] = []
    for (const s of props.openSessions) {
      if (!s?.id || seen.has(s.id)) continue
      // 协调会话（Lead，历史值 manager）不作为"最近会话"重复出现
      if (isLeadRole(s.metadata?.mafw?.role)) continue
      seen.add(s.id)
      merged.push({ id: s.id, title: formatRailTitle(s.title) })
    }
    for (const s of props.historySessions) {
      if (!s?.id || seen.has(s.id)) continue
      if (isLeadRole(s.metadata?.mafw?.role)) continue
      seen.add(s.id)
      merged.push({ id: s.id, title: formatRailTitle(s.title), time: s.time?.updated })
    }
    return merged.slice(0, 12)
  })

  const projectName = (p: WelcomeProject) => {
    const t = p.worktree.replace(/\\/g, "/")
    const parts = t.split("/").filter(Boolean)
    return parts[parts.length - 1] || t
  }

  return (
    <div class="mafw-welcome" onClick={(e) => e.stopPropagation()}>
      <Show when={!connected()}>
        <div class="mafw-welcome-banner">
          <span>Gateway 服务未连接</span>
          <ButtonV2 variant="outline" size="small" onClick={fetchAll}>重试</ButtonV2>
        </div>
      </Show>

      {/* Project switcher — horizontal chips */}
      <div class="mafw-welcome-projects">
        <Show when={props.projects.length > 0} fallback={<div class="mafw-welcome-projects-empty">未注册项目（在 gateway 侧 /register 注册）</div>}>
          <For each={props.projects}>
            {(p) => (
              <TooltipV2 placement="bottom" value={p.worktree}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-welcome-project"
                  data-selected={props.currentProject === p.worktree ? "" : undefined}
                  onClick={() => props.onSelectProject(p.worktree)}
                >
                  {projectName(p)}
                </ButtonV2>
              </TooltipV2>
            )}
          </For>
        </Show>
      </div>

      <h1 class="mafw-welcome-title">今天要做什么？</h1>

      {/* Quick actions */}
      <div class="mafw-welcome-actions">
        <ButtonV2 variant="contrast" icon="edit" onClick={props.onCreate}>新建会话</ButtonV2>
        <Show when={props.hasPlanAgent}>
          <ButtonV2 variant="outline" icon="file" onClick={() => props.onStartWithPlan?.()}>
            先规划，再执行
          </ButtonV2>
        </Show>
        <ButtonV2 variant="outline" icon="user" onClick={() => void props.onOpenLead()}>Lead 会话</ButtonV2>
        <ButtonV2 variant="outline" icon="layout-grid" onClick={() => props.onNavigate("goals")}>工作空间</ButtonV2>
        <ButtonV2 variant="outline" icon="target" onClick={() => props.onOpenGoalComposer()}>新建 Goal</ButtonV2>
        <ButtonV2 variant="outline" icon="check" onClick={() => props.onNavigate("approvals")}>
          待审批{`${pendingApprovals() > 0 ? ` (${pendingApprovals()})` : ""}`}
        </ButtonV2>
        <ButtonV2 variant="outline" icon="database" onClick={() => props.onNavigate("memory")}>记忆回顾</ButtonV2>
      </div>

      {/* Pending overview */}
      <Show when={pendingApprovals() > 0 || triageCount() > 0 || enabledAutomations() > 0}>
        <section class="mafw-welcome-section">
          <div class="mafw-welcome-section-title">待办概览</div>
          <div class="mafw-welcome-badges">
            <Show when={pendingApprovals() > 0}>
              <ButtonV2 variant="ghost" size="small" class="mafw-welcome-badge" onClick={() => props.onNavigate("approvals")}>
                {pendingApprovals()} 条待审批
              </ButtonV2>
            </Show>
            <Show when={triageCount() > 0}>
              <ButtonV2 variant="ghost" size="small" class="mafw-welcome-badge" onClick={() => props.onNavigate("triage")}>
                {triageCount()} 条 triage
              </ButtonV2>
            </Show>
            <Show when={enabledAutomations() > 0}>
              <span class="mafw-welcome-badge mafw-welcome-badge-static">
                {enabledAutomations()} 个自动化运行中
              </span>
            </Show>
          </div>
        </section>
      </Show>

      {/* Recent sessions */}
      <section class="mafw-welcome-section">
        <div class="mafw-welcome-section-title">最近会话</div>
        <Show when={recentSessions().length > 0} fallback={
          <div class="mafw-welcome-empty">
            {loading() ? "加载中…" : "暂无会话，点击「新建会话」开始"}
          </div>
        }>
          <div class="mafw-welcome-sessions">
            <For each={recentSessions()}>
              {(s) => (
                <ButtonV2 variant="ghost" size="small" class="mafw-welcome-session" onClick={() => props.onSelect(s.id)}>
                  <span class="mafw-welcome-session-title">{s.title}</span>
                </ButtonV2>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  )
}
