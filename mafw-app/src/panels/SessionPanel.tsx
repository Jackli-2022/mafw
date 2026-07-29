import { createSignal } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function SessionPanel() {
  const gw = useGateway()
  const [sessions, setSessions] = createSignal<any[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  if (gw.ready()) {
    gw.client().session.list().then(setSessions).catch(() => {})
  }

  return (
    <div class="px-3 py-2 flex-1 overflow-auto">
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-xs font-semibold" style="color: var(--text-text-strong)">SESSIONS</span>
      </div>
      <div class="space-y-0.5">
        {sessions().length === 0 ? (
          <div class="text-xs" style="color: var(--text-text-muted)">No sessions yet</div>
        ) : (
          sessions().slice(-10).reverse().map((s: any) => (
            <button
              onClick={() => setActiveId(s.id)}
              class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-white/10 transition-colors text-left"
              style={{ color: activeId() === s.id ? 'var(--text-text-strong)' : 'var(--text-text-muted)' }}
            >
              <span class="text-xs leading-none shrink-0">○</span>
              <span class="truncate flex-1">{s.title || s.id?.slice(0, 16) || 'Untitled'}</span>
            </button>
          ))
        )}
        <button
          onClick={() => {}}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-white/10 transition-colors text-left"
          style="color: var(--accent-9)"
        >
          + New Chat
        </button>
      </div>
    </div>
  )
}
