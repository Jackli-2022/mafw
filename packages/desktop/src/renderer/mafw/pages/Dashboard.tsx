// @ts-nocheck
import { createSignal, createEffect, onCleanup } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"
import { GoalDetailOverlay } from "../components/GoalDetailOverlay"
import { PageHeader } from "../components/PageHeader"
import { EmptyState } from "../components/EmptyState"

export function DashboardPage(props: { onOpenSession?: (sid: string) => void }) {
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
    fetchGoals()
    const interval = setInterval(fetchGoals, 15000)
    onCleanup(() => clearInterval(interval))
  })

  function goalMenu(g: any): ContextMenuItem[] {
    const isRunning = g.phase !== "COMPLETED" && g.phase !== "FAILED" && g.phase !== "ARCHIVED"
    return [
      { label: "View Details", onSelect: () => setDetailGoalId(g.goalId) },
      { separator: true },
      ...(isRunning
        ? [{ label: "Pause", onSelect: () => window.api.mafw.goals.control({ goalId: g.goalId, action: "PAUSE" }).catch((e: any) => console.warn("[mafw]", e)) }]
        : [{ label: "Resume", onSelect: () => window.api.mafw.goals.control({ goalId: g.goalId, action: "RESUME" }).catch((e: any) => console.warn("[mafw]", e)) }]),
      { label: "Cancel", danger: true, onSelect: () => window.api.mafw.goals.control({ goalId: g.goalId, action: "ABORT" }).catch((e: any) => console.warn("[mafw]", e)) },
    ]
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
      <div style={{ display: "grid", "grid-template-columns": "repeat(4, 1fr)", gap: 12, "margin-bottom": 24 }}>
        {kpis.map(kpi => (
          <div class="mafw-kpi-card">
            <div class="mafw-kpi-value">{kpi.value}</div>
            <div class="mafw-kpi-label">{kpi.label}</div>
          </div>
        ))}
      </div>
      <div>
        {loading() ? (
          <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "20px 0" }}>
            <LoaderV2 width={16} height={16} />
            <span class="mafw-empty">Loading...</span>
          </div>
        ) : goals().length === 0 ? (
          <EmptyState glyph="◎" title="还没有 Goal" hint="让 Manager 为你编排第一个目标，或从欢迎页快速创建" />
        ) : (
          goals().map(g => (
            <MafwContextMenu items={goalMenu(g)}>
              <div class="mafw-card">
                <div>
                  <div class="mafw-card-title">{g.title || g.goalId}</div>
                  <div class="mafw-card-meta">Wave {g.currentWave}/{g.totalWaves} · Loop {g.loop}</div>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: 8, "margin-left": "auto" }}>
                  <span class={`mafw-phase-badge ${
                    g.phase === "COMPLETED" || g.phase === "ARCHIVED" ? "mafw-phase-badge-ok"
                    : g.phase === "FAILED" ? "mafw-phase-badge-fail"
                    : "mafw-phase-badge-run"
                  }`}>{g.phase}</span>
                  <span style={{ "font-size": 11, color: "var(--text-base)" }}>{g.updatedAt ? new Date(g.updatedAt).toLocaleString() : ""}</span>
                </div>
              </div>
            </MafwContextMenu>
          ))
        )}
      </div>
      <GoalDetailOverlay
        goalId={detailGoalId()}
        onClose={() => setDetailGoalId(null)}
        onOpenSession={(sid) => { setDetailGoalId(null); props.onOpenSession?.(sid) }}
      />
    </div>
  )
}
