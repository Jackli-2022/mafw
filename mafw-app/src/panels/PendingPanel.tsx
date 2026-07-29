import { createSignal } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function PendingPanel() {
  const gw = useGateway()
  const [items, setItems] = createSignal<any[]>([])

  if (gw.ready()) {
    ;(gw.client() as any).getApprovals?.().then(setItems).catch(() => {})
  }

  return (
    <div class="px-3 py-2 border-b" style="border-color: var(--border-border-secondary)">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-semibold" style="color: var(--text-text-strong)">PENDING ({items().length})</span>
      </div>
      {items().length === 0 ? (
        <div class="text-xs" style="color: var(--text-text-muted)">None</div>
      ) : (
        <div class="space-y-1 max-h-[180px] overflow-auto">
          {items().slice(0, 5).map((item: any) => (
            <div class="px-1.5 py-1 rounded text-xs hover:bg-white/5" style="color: var(--text-text-muted)">
              <div class="truncate">{item.question || item.id}</div>
              <span class="text-[10px]" style={{ color: item.status === 'pending' ? '#e8b84b' : '#2bc94a' }}>{item.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
