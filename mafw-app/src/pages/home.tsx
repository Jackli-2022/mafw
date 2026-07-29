import { createSignal, createEffect } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { useGateway } from '../gateway/provider'

export function HomePage() {
  const gw = useGateway()
  const navigate = useNavigate()
  const [goals, setGoals] = createSignal<any[]>([])

  createEffect(() => {
    if (!gw.ready()) return
    gw.client().getGoals().then(setGoals).catch(() => {})
  })

  return (
    <div class="p-6 max-w-2xl mx-auto">
      <h1 class="text-lg font-semibold mb-6" style="color: var(--text-text-strong)">MAFW</h1>
      <div class="space-y-4">
        <div class="rounded-lg border p-4" style="background: var(--v2-background-bg-base); border-color: var(--border-border-secondary)">
          <div class="text-sm font-medium mb-3" style="color: var(--text-text-strong)">Active Goals ({goals().length})</div>
          {goals().length === 0 ? (
            <div class="text-sm" style="color: var(--text-text-muted)">No active goals</div>
          ) : (
            <div class="space-y-2">
              {goals().map(g => (
                <div class="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-white/5 cursor-pointer" onClick={() => navigate(`/chat`)}>
                  <span class="text-sm truncate mr-3" style="color: var(--text-text-strong)">{g.goalId}</span>
                  <span class="text-xs px-1.5 py-0.5 rounded-sm" style={{ background: g.phase === 'EXECUTING' ? 'rgba(118,152,253,0.15)' : 'rgba(255,255,255,0.08)', color: g.phase === 'EXECUTING' ? '#7698fd' : 'var(--text-text-muted)' }}>
                    {g.phase}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => navigate('/chat')}
          class="w-full rounded-lg border py-3 text-sm font-medium transition-colors hover:bg-white/5"
          style="background: var(--v2-background-bg-base); border-color: var(--border-border-secondary); color: var(--text-text-muted)"
        >
          + New Chat
        </button>
      </div>
    </div>
  )
}
