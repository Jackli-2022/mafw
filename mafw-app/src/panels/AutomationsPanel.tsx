import { createSignal } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function AutomationsPanel() {
  const gw = useGateway()
  const [rules, setRules] = createSignal<any[]>([])

  if (gw.ready()) {
    gw.client().getAutomations().then(setRules).catch(() => {})
  }

  return (
    <div class="px-3 py-2 border-b" style="border-color: var(--border-border-secondary)">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-semibold" style="color: var(--text-text-strong)">AUTOMATIONS ({rules().length})</span>
      </div>
      {rules().length === 0 ? (
        <div class="text-xs" style="color: var(--text-text-muted)">None</div>
      ) : (
        <div class="space-y-1 max-h-[200px] overflow-auto">
          {rules().slice(0, 8).map((r: any) => (
            <div class="flex items-center justify-between px-1.5 py-1 rounded text-xs hover:bg-white/5" style="color: var(--text-text-muted)">
              <span class="truncate mr-2">{r.id}</span>
              <span class="text-[10px]" style={{ color: r.enabled ? '#2bc94a' : '#e8636b' }}>{r.enabled ? 'ON' : 'OFF'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
