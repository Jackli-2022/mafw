import { createStore } from 'solid-js/store'
import { useNavigate, useParams } from '@solidjs/router'

export interface TabItem {
  id: string
  title: string
}

export function TitlebarTabStrip() {
  const navigate = useNavigate()
  const params = useParams()
  const [tabs, setTabs] = createStore<TabItem[]>([])

  function switchTab(id: string) {
    navigate(`/chat/${id}`)
  }

  function closeTab(id: string, e: MouseEvent) {
    e.stopPropagation()
    const idx = tabs.findIndex(t => t.id === id)
    if (idx === -1) return
    setTabs(tabs => tabs.filter(t => t.id !== id))
    // Navigate to adjacent tab if current was closed
    if (params.sessionId === id && tabs.length > 1) {
      const nextIdx = Math.min(idx, tabs.length - 2)
      navigate(`/chat/${tabs[nextIdx === idx ? 0 : nextIdx].id}`)
    }
  }

  function addTab(id: string, title: string) {
    setTabs([...tabs, { id, title }])
    navigate(`/chat/${id}`)
  }

  // Expose addTab for external use
  ;(window as any).__mafwAddTab = addTab

  return (
    <div class="flex items-center h-full gap-0 px-2">
      {tabs.map(tab => (
        <div
          onClick={() => switchTab(tab.id)}
          class="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-sm cursor-pointer select-none transition-colors hover:bg-white/10"
          classList={{ 'bg-white/15': params.sessionId === tab.id }}
          style={{ color: params.sessionId === tab.id ? 'var(--text-text-strong)' : 'var(--text-text-muted)' }}
        >
          <span class="truncate max-w-[120px]">{tab.title || 'Untitled'}</span>
          <button
            onClick={(e) => closeTab(tab.id, e)}
            class="flex items-center justify-center w-4 h-4 rounded hover:bg-white/20 text-xs"
            style="color: var(--text-text-muted)"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={async () => {
          try {
            const { GatewayClient } = await import('../lib/gateway-sdk/client')
            const client = new GatewayClient()
            const session = await client.session.create({ directory: '.' })
            addTab(session.id, session.id.slice(0, 8))
          } catch {}
        }}
        class="flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 text-sm ml-1"
        style="color: var(--text-text-muted)"
      >
        +
      </button>
    </div>
  )
}
