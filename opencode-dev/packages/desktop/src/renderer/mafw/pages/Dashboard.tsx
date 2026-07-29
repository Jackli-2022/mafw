// @ts-nocheck
import { createSignal, createEffect, onCleanup } from "solid-js"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"

export function DashboardPage() {
  const [goals, setGoals] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)

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
      { label: "View Details", onSelect: () => window.api.mafw.goals.get(g.goalId).catch((e: any) => console.warn("[mafw]", e)) },
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
      <h2 class="mafw-page-title">Goals</h2>
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
          <div class="mafw-empty">No goals yet</div>
        ) : (
          goals().map(g => (
            <MafwContextMenu items={goalMenu(g)}>
              <div class="mafw-card">
                <div>
                  <div class="mafw-card-title">{g.goalId}</div>
                  <div class="mafw-card-meta">Wave {g.currentWave}/{g.totalWaves} · Loop {g.loop}</div>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: 8, "margin-left": "auto" }}>
                  <span class="mafw-badge" style={{
                    background: g.phase === "COMPLETED" || g.phase === "ARCHIVED" ? "rgba(43,201,74,0.12)" : g.phase === "FAILED" ? "rgba(232,99,107,0.12)" : "var(--surface-interactive-base)",
                    color: g.phase === "COMPLETED" || g.phase === "ARCHIVED" ? "#2bc94a" : g.phase === "FAILED" ? "#e8636b" : "var(--text-interactive-base)",
                  }}>{g.phase}</span>
                  <span style={{ "font-size": 11, color: "var(--text-base)" }}>{g.updatedAt ? new Date(g.updatedAt).toLocaleString() : ""}</span>
                </div>
              </div>
            </MafwContextMenu>
          ))
        )}
      </div>
    </div>
  )
}
