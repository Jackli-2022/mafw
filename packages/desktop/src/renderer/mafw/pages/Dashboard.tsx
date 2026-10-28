import { createSignal, createEffect, For, onCleanup } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { ConfirmOverlay } from "../components/ConfirmOverlay"
import { menuController } from "../context-menu/controller"
import { buildGoalCardMenu } from "../context-menu/builders/card"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { GoalDetailOverlay } from "../components/GoalDetailOverlay"
import { PageHeader } from "../components/PageHeader"
import { EmptyState } from "../components/EmptyState"
import { SkeletonRows } from "../components/Skeleton"
import { goalsRev } from "../goals-rev"
import { PAGE_LINKS } from "../page-links"
import type { NavTab } from "../components/nav-tab"

export function DashboardPage(props: { onOpenSession?: (sid: string) => void; onNavigate?: (tab: NavTab) => void }) {
  const [goals, setGoals] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)
  const [detailGoalId, setDetailGoalId] = createSignal<string | null>(null)

  async function fetchGoals() {
    setLoading(true)
    try {
      const list = await window.api.mafw.goals.list() as any[]
      setGoals(list)
    } catch (e) { console.warn("[mafw]", e) }
    setLoading(false)
  }

  createEffect(() => {
    void goalsRev() // SSE goal 事件 → 触发一次拉取
    fetchGoals()
    const interval = setInterval(fetchGoals, 15000)
    onCleanup(() => clearInterval(interval))
  })

  const [cancelConfirmId, setCancelConfirmId] = createSignal<string | null>(null)

  const isGoalRunning = (g: any) => g.phase !== "COMPLETED" && g.phase !== "FAILED" && g.phase !== "ARCHIVED"

  const requestGoalMenu = (g: any, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    const running = isGoalRunning(g)
    menuController.request(
      buildGoalCardMenu,
      { goalId: g.goalId, running, canPause: running },
      (id) => {
        if (id === "goal.details" || id === "goal.timeline") setDetailGoalId(g.goalId)
        else if (id === "goal.copyId") void navigator.clipboard.writeText(g.goalId)
        else if (id === "goal.pause") void window.api.mafw.goals.control({ goalId: g.goalId, action: "PAUSE" }).catch((e: any) => console.warn("[mafw]", e))
        else if (id === "goal.cancel") setCancelConfirmId(g.goalId)
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  const kpis = [
    { label: "Total Goals", value: goals().length },
    { label: "Active", value: goals().filter(g => g.phase !== "COMPLETED" && g.phase !== "FAILED").length },
    { label: "Completed", value: goals().filter(g => g.phase === "COMPLETED").length },
    { label: "Total Loops", value: goals().reduce((s, g) => s + (g.loop || 0), 0) },
  ]

  return (
    <div>
      <PageHeader title="Goals" subtitle="目标编排总览" />
      {/* 枢纽卡：五页面入口（spec D6） */}
      <div class="mafw-card" style={{ display: "flex", "align-items": "center", gap: "8px", "flex-wrap": "wrap", "margin-bottom": "16px" }}>
        <span style={{ color: "var(--text-3)", "font-size": "11px", "margin-right": "4px" }}>页面</span>
        <For each={PAGE_LINKS}>
          {(link) => (
            <ButtonV2 variant="ghost" size="small" onClick={() => props.onNavigate?.(link.id)}>
              <Icon name={link.icon as any} size="small" />
              <span style={{ "margin-left": "6px" }}>{link.label}</span>
            </ButtonV2>
          )}
        </For>
      </div>
      <div class="mafw-bento" style={{ "margin-bottom": "24px" }}>
        {kpis.map(kpi => (
          <div class="mafw-kpi-card">
            <div class="mafw-kpi-value">{kpi.value}</div>
            <div class="mafw-kpi-label">{kpi.label}</div>
          </div>
        ))}
      </div>
      <div>
        {loading() ? (
          <div>
            <div style={{ display: "grid", "grid-template-columns": "repeat(4, 1fr)", gap: "12px", "margin-bottom": "24px" }}>
              {[0, 1, 2, 3].map(() => <div class="mafw-skeleton" style={{ height: "64px", "border-radius": "var(--r-lg)" }} />)}
            </div>
            <SkeletonRows rows={3} h="52px" />
          </div>
        ) : goals().length === 0 ? (
          <EmptyState glyph="◎" title="还没有 Goal" hint="让 Manager 为你编排第一个目标，或从欢迎页快速创建" />
        ) : (
          goals().map(g => (
            <div class="mafw-card" onContextMenu={(event) => requestGoalMenu(g, event)}>
              <div>
                  <div class="mafw-card-title">{g.title || g.goalId}</div>
                  <div class="mafw-card-meta">Wave {g.currentWave}/{g.totalWaves} · Loop {g.loop}</div>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-left": "auto" }}>
                  <span class={`mafw-phase-badge ${
                    g.phase === "COMPLETED" || g.phase === "ARCHIVED" ? "mafw-phase-badge-ok"
                    : g.phase === "FAILED" ? "mafw-phase-badge-fail"
                    : "mafw-phase-badge-run"
                  }`}>{g.phase}</span>
                  <span style={{ "font-size": "11px", color: "var(--text-base)" }}>{g.updatedAt ? new Date(g.updatedAt).toLocaleString() : ""}</span>
                </div>
              </div>
          ))
        )}
      </div>
      <ConfirmOverlay
        open={cancelConfirmId() !== null}
        title="取消 Goal"
        message="取消后该 Goal 会进入终止状态，已产生的会话与产物仍会保留。"
        confirmLabel="取消 Goal"
        danger
        onConfirm={() => {
          const goalId = cancelConfirmId()
          setCancelConfirmId(null)
          if (goalId) void window.api.mafw.goals.control({ goalId, action: "ABORT" }).catch((e: any) => console.warn("[mafw]", e))
        }}
        onCancel={() => setCancelConfirmId(null)}
      />
      <GoalDetailOverlay
        goalId={detailGoalId()}
        onClose={() => setDetailGoalId(null)}
        onOpenSession={(sid) => { setDetailGoalId(null); props.onOpenSession?.(sid) }}
      />
    </div>
  )
}
