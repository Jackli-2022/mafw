import { createSignal, createEffect, For, Show } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function GoalPanel() {
  const gw = useGateway()
  const [goals, setGoals] = createSignal<any[]>([])
  const [expanded, setExpanded] = createSignal<string | null>(null)

  createEffect(() => {
    const fetch = async () => {
      if (!gw.ready()) return
      try { setGoals(await gw.client().getGoals()) } catch {}
    }
    fetch()
    const interval = setInterval(fetch, 15000)
    return () => clearInterval(interval)
  })

  const phaseColor = (p: string) => {
    if (p === 'COMPLETED' || p === 'ARCHIVED') return '#2bc94a'
    if (p === 'FAILED') return '#e8636b'
    return '#7698fd'
  }

  return (
    <div class="px-3 py-3 border-b" style="border-color: var(--border-border-secondary)">
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-xs font-semibold" style="color: var(--text-text-strong)">GOALS ({goals().length})</span>
      </div>
      <div class="space-y-0.5">
        <For each={goals()}>
          {(goal) => (
            <div>
              <button
                onClick={() => setExpanded(expanded() === goal.goalId ? null : goal.goalId)}
                class="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm hover:bg-white/10 transition-colors text-left"
                style="color: var(--text-text-muted)"
              >
                <span class="truncate mr-2">{goal.goalId}</span>
                <span class="text-xs px-1.5 py-0.5 rounded-sm" style={{ background: `${phaseColor(goal.phase)}20`, color: phaseColor(goal.phase) }}>
                  {goal.phase}
                </span>
              </button>
              <Show when={expanded() === goal.goalId}>
                <div class="pl-4 pr-2 pb-2">
                  <InlineGoalGraph goal={goal} />
                </div>
              </Show>
            </div>
          )}
        </For>
        <button class="w-full text-xs text-left px-2 py-1 rounded hover:bg-white/10 transition-colors" style="color: var(--accent-9)">+ New Goal</button>
      </div>
    </div>
  )
}

function InlineGoalGraph(props: { goal: any }) {
  const nodes = ['PLAN', 'EXECUTE', 'REVIEW', 'SUCCESS', 'FAIL']
  const labels: Record<string, string> = { PLAN: 'Plan', EXECUTE: 'Execute', REVIEW: 'Review', SUCCESS: '✓', FAIL: '✗' }
  const colors: Record<string, string> = { PLAN: '#7698fd', EXECUTE: '#a855f7', REVIEW: '#e8b84b', SUCCESS: '#2bc94a', FAIL: '#e8636b' }
  const idx = nodes.indexOf(props.goal.phase)
  const l = [{ x: 60, y: 8 }, { x: 30, y: 40 }, { x: 90, y: 40 }, { x: 30, y: 72 }, { x: 90, y: 72 }]

  return (
    <svg width="120" height="100" viewBox="0 0 120 100" class="w-full">
      {nodes.slice(0, -1).map((n, i) => {
        const f = l[i], t = l[i + 1]
        return <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke={i < idx ? '#2bc94a' : 'rgba(255,255,255,0.15)'} stroke-width="1.5" />
      })}
      {nodes.map((n, i) => {
        const p = l[i]
        return (
          <g>
            <circle cx={p.x} cy={p.y} r="6" fill={i <= idx ? colors[n] : 'var(--v2-background-bg-elevated)'} stroke={i <= idx ? colors[n] : 'rgba(255,255,255,0.15)'} stroke-width="1" />
            <text x={p.x + 10} y={p.y + 3} fill={i <= idx ? colors[n] : 'rgba(255,255,255,0.3)'} font-size="8" font-weight="500">{labels[n]}</text>
          </g>
        )
      })}
    </svg>
  )
}
