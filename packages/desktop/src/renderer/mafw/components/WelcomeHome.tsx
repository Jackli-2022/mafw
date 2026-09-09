// @ts-nocheck
import { createMemo, createSignal, Show, For, createEffect, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { Icon as IconV2 } from "@mafw/ui/v2/icon"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"

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
  openSessions: { id: string; title?: string }[]
  historySessions: { id: string; title?: string; time?: { updated?: number }; metadata?: { mafw?: { role?: string } } }[]
  onSelect: (sid: string) => void
  onCreate: () => void
  onNavigate: (tab: "chat" | "goals" | "memory" | "approvals" | "triage" | "automation") => void
  onNewGoal: (description: string) => Promise<boolean>
  onOpenManager: () => Promise<boolean>
}) {
  const [goals, setGoals] = createSignal<any[]>([])
  const [approvals, setApprovals] = createSignal<any[]>([])
  const [triage, setTriage] = createSignal<any[]>([])
  const [automations, setAutomations] = createSignal<any[]>([])
  const [connected, setConnected] = createSignal(true)
  const [loading, setLoading] = createSignal(true)
  const [goalDraft, setGoalDraft] = createSignal("")
  const [goalInputOpen, setGoalInputOpen] = createSignal(false)
  const [goalSubmitting, setGoalSubmitting] = createSignal(false)
  const [goalError, setGoalError] = createSignal("")

  async function fetchAll() {
    try {
      const [g, a, t, auto] = await Promise.all([
        window.api.mafw.goals.list().catch(() => []),
        window.api.mafw.approvals.list().catch(() => []),
        window.api.mafw.triage.list().catch(() => []),
        window.api.mafw.automations.list().catch(() => []),
      ])
      setGoals(Array.isArray(g) ? g : [])
      setApprovals(Array.isArray(a) ? a : [])
      setTriage(Array.isArray(t) ? t : [])
      setAutomations(Array.isArray(auto) ? auto : [])
      setConnected(true)
    } catch {
      setConnected(false)
    }
    setLoading(false)
  }

  createEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 15000)
    onCleanup(() => clearInterval(interval))
  })

  const activeGoals = createMemo(() =>
    (goals() || []).filter((g) => g?.phase && !["COMPLETED", "FAILED", "ARCHIVED"].includes(g.phase)),
  )
  const pendingApprovals = createMemo(() => (approvals() || []).filter((a) => a?.status === "pending").length)
  const triageCount = createMemo(() => (triage() || []).length)
  const enabledAutomations = createMemo(() => (automations() || []).filter((a) => a?.enabled).length)

  const recentSessions = createMemo(() => {
    const seen = new Set<string>()
    const merged: { id: string; title: string; time?: number }[] = []
    for (const s of props.openSessions) {
      if (!s?.id || seen.has(s.id)) continue
      if (s?.metadata?.mafw?.role === "manager") continue
      seen.add(s.id)
      merged.push({ id: s.id, title: s.title || s.id })
    }
    for (const s of props.historySessions) {
      if (!s?.id || seen.has(s.id)) continue
      if (s?.metadata?.mafw?.role === "manager") continue
      seen.add(s.id)
      merged.push({ id: s.id, title: s.title || s.id, time: s.time?.updated })
    }
    return merged.slice(0, 12)
  })

  async function submitGoal() {
    const desc = goalDraft().trim()
    if (!desc || goalSubmitting()) return
    setGoalSubmitting(true)
    setGoalError("")
    const ok = await props.onNewGoal(desc)
    if (!ok) setGoalError("未找到 Manager 会话，已跳转到 Goals 页；可稍后手动创建。")
    setGoalSubmitting(false)
  }

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
                <button
                  type="button"
                  class="mafw-welcome-project"
                  data-selected={props.currentProject === p.worktree ? "" : undefined}
                  onClick={() => props.onSelectProject(p.worktree)}
                >
                  {projectName(p)}
                </button>
              </TooltipV2>
            )}
          </For>
        </Show>
      </div>

      <h1 class="mafw-welcome-title">今天要做什么？</h1>

      {/* Quick actions */}
      <div class="mafw-welcome-actions">
        <ButtonV2 variant="contrast" icon="edit" onClick={props.onCreate}>新建会话</ButtonV2>
        <ButtonV2 variant="outline" icon="user" onClick={() => void props.onOpenManager()}>Manager 会话</ButtonV2>
        <ButtonV2 variant="outline" icon="target" onClick={() => { setGoalInputOpen(o => !o) }}>新建 Goal</ButtonV2>
        <ButtonV2 variant="outline" icon="check" onClick={() => props.onNavigate("approvals")}>
          待审批{`${pendingApprovals() > 0 ? ` (${pendingApprovals()})` : ""}`}
        </ButtonV2>
        <ButtonV2 variant="outline" icon="brain" onClick={() => props.onNavigate("memory")}>记忆回顾</ButtonV2>
      </div>

      {/* New Goal inline input */}
      <Show when={goalInputOpen()}>
        <div class="mafw-welcome-goal-input">
          <TextInputV2
            value={goalDraft()}
            onInput={setGoalDraft}
            placeholder="描述要创建的 Goal（例如：重构登录模块）…"
            onKeyDown={(e) => { if (e.key === "Enter") void submitGoal() }}
          />
          <div class="mafw-welcome-goal-input-actions">
            <ButtonV2 variant="contrast" size="small" disabled={goalSubmitting() || !goalDraft().trim()} onClick={() => void submitGoal()}>
              {goalSubmitting() ? "提交中…" : "提交"}
            </ButtonV2>
            <ButtonV2 variant="ghost" size="small" onClick={() => setGoalInputOpen(false)}>取消</ButtonV2>
          </div>
          <Show when={goalError()}><div class="mafw-welcome-goal-error">{goalError()}</div></Show>
        </div>
      </Show>

      {/* Active goals */}
      <Show when={activeGoals().length > 0}>
        <section class="mafw-welcome-section">
          <div class="mafw-welcome-section-title">活跃 Goal</div>
          <div class="mafw-welcome-goals">
            <For each={activeGoals()}>
              {(g) => (
                <ButtonV2 variant="ghost" size="small" class="mafw-welcome-goal" onClick={() => props.onNavigate("goals")}>
                  <span class="mafw-welcome-goal-title">{g.title || g.goalId}</span>
                  <span class="mafw-welcome-goal-meta">
                    {g.phase} · loop {g.loop || 0}
                  </span>
                </ButtonV2>
              )}
            </For>
          </div>
        </section>
      </Show>

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
