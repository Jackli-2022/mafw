import { createSignal, createEffect } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function AutomationsPage() {
  const gw = useGateway()
  const [rules, setRules] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)

  createEffect(() => {
    if (!gw.ready()) return
    gw.client().getAutomations().then(list => { setRules(list); setLoading(false) })
  })

  return (
    <div>
      <h2 class="text-13 font-medium mb-5" style="color: var(--text-strong)">Automations</h2>
      {loading() ? (
        <div class="text-13" style="color: var(--text-muted)">Loading...</div>
      ) : rules().length === 0 ? (
        <div class="text-13" style="color: var(--text-muted)">No automation rules configured</div>
      ) : (
        <div class="space-y-1.5">
          {rules().map(rule => (
            <div class="memory-card">
              <div class="flex items-center justify-between mb-1.5">
                <div class="text-13 font-medium" style="color: var(--text-strong)">{rule.id}</div>
                <span class="badge" style={{
                  background: rule.enabled ? 'var(--success-bg)' : 'var(--danger-bg)',
                  border: '0.5px solid rgba(255,255,255,0.08)',
                  color: rule.enabled ? 'var(--success)' : 'var(--danger)',
                }}>{rule.enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div class="text-11 space-y-0.5" style="color: var(--text-muted)">
                <div>Schedule: <span style="color: var(--text-base)">{rule.trigger?.schedule || '-'}</span></div>
                <div>Action: <span style="color: var(--text-base)">{rule.action?.type || rule.skill || '-'}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
