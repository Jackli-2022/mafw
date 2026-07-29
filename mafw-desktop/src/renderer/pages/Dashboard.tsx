import { createSignal, createEffect } from 'solid-js'
import { useGateway } from '../gateway/provider'
import { Goal } from '../gateway/types'

export function DashboardPage() {
  const gw = useGateway()
  const [goals, setGoals] = createSignal<Goal[]>([])
  const [loading, setLoading] = createSignal(true)

  createEffect(() => {
    const fetch = async () => {
      if (!gw.ready()) return
      setLoading(true)
      const list = await gw.client().getGoals()
      setGoals(list)
      setLoading(false)
    }
    fetch()
    const interval = setInterval(fetch, 15000)
    return () => clearInterval(interval)
  })

  return (
    <div>
      <h2 class="text-13 font-medium mb-5" style="color: var(--text-strong)">Dashboard</h2>
      <div class="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Goals', value: goals().length },
          { label: 'Active', value: goals().filter(g => g.phase !== 'COMPLETED' && g.phase !== 'FAILED').length },
          { label: 'Completed', value: goals().filter(g => g.phase === 'COMPLETED').length },
          { label: 'Total Loops', value: goals().reduce((s, g) => s + g.loop, 0) },
        ].map(kpi => (
          <div class="kpi-card">
            <div class="text-lg font-semibold" style="color: var(--text-strong); font-variant-numeric: tabular-nums">{kpi.value}</div>
            <div class="text-11 mt-0.5" style="color: var(--text-muted)">{kpi.label}</div>
          </div>
        ))}
      </div>
      <div class="space-y-1">
        {loading() ? (
          <div class="text-13" style="color: var(--text-muted)">Loading...</div>
        ) : goals().length === 0 ? (
          <div class="text-13" style="color: var(--text-muted)">No goals yet</div>
        ) : (
          goals().map(g => (
            <div class="goal-row flex items-center justify-between">
              <div>
                <div class="text-13 font-medium" style="color: var(--text-strong)">{g.goalId}</div>
                <div class="text-11 mt-0.5" style="color: var(--text-muted)">Wave {g.currentWave}/{g.totalWaves} · Loop {g.loop}</div>
              </div>
              <div class="flex items-center gap-3">
                <span class="badge" style={{
                  background: g.phase === 'COMPLETED' || g.phase === 'ARCHIVED' ? 'var(--success-bg)' : g.phase === 'FAILED' ? 'var(--danger-bg)' : 'var(--accent-bg)',
                  border: '0.5px solid rgba(255,255,255,0.08)',
                  color: g.phase === 'COMPLETED' || g.phase === 'ARCHIVED' ? 'var(--success)' : g.phase === 'FAILED' ? 'var(--danger)' : 'var(--accent)',
                }}>{g.phase}</span>
                <span class="text-11" style="color: var(--text-muted)">{g.updatedAt ? new Date(g.updatedAt).toLocaleString() : ''}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
