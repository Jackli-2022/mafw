import { render } from 'solid-js/web'
import { createSignal, Switch, Match, For } from 'solid-js'
import { GatewayProvider, useGateway } from './gateway/provider'
import { useSidebar } from './hooks/useSidebar'
import { DashboardPage } from './pages/Dashboard'
import { MemoryPage } from './pages/Memory'
import { GraphPage } from './pages/Graph'
import { ChatPage } from './pages/Chat'
import { ConfigPage } from './pages/Config'
import { AutomationsPage } from './pages/Automations'
import './styles.css'

declare global {
  interface Window {
    mafwAPI: {
      healthCheck(): Promise<boolean>
      getPort(): Promise<number>
      onHealth(callback: (connected: boolean) => void): () => void
    }
  }
}

type Tab = 'dashboard' | 'memory' | 'graph' | 'chat' | 'config' | 'automations'

const TAB_CONFIG: Record<Tab, { icon: string; label: string }> = {
  dashboard: { icon: '◉', label: 'Dashboard' },
  memory: { icon: '◇', label: 'Memory' },
  graph: { icon: '◎', label: 'Graph' },
  chat: { icon: '○', label: 'Chat' },
  config: { icon: '⚙', label: 'Config' },
  automations: { icon: '▶', label: 'Automations' },
}

function SidebarPanel() {
  const gw = useGateway()
  const { projects, currentProject, sessions, selectProject } = useSidebar()
  const [open, setOpen] = createSignal(false)

  return (
    <aside class="w-[240px] flex flex-col shrink-0 border-r" style="border-color: var(--border-base); background: var(--bg-base)">
      <div class="p-2 border-b" style="border-color: var(--border-base)">
        <div class="relative">
          <button
            class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs"
            style="background: var(--bg-raised); color: var(--text-strong)"
            onClick={() => setOpen(!open())}
          >
            {currentProject() ? (
              <>
                <span class="truncate">{currentProject()!.id.split('/').pop() || currentProject()!.id}</span>
                <span class="ml-auto text-10" style="color: var(--text-muted)">▼</span>
              </>
            ) : (
              <span style="color: var(--text-muted)">No project</span>
            )}
          </button>
          {open() && (
            <div class="absolute top-full left-0 right-0 mt-1 rounded border z-10 max-h-48 overflow-auto" style="background: var(--bg-raised); border-color: var(--border-base)">
              <For each={projects()}>
                {p => (
                  <button
                    class="w-full text-left px-2 py-1.5 text-xs truncate hover:opacity-80"
                    classList={{ 'font-medium': currentProject()?.id === p.id }}
                    style="color: var(--text-strong)"
                    onClick={() => { selectProject(p); setOpen(false) }}
                  >
                    {p.id.split('/').pop() || p.id}
                  </button>
                )}
              </For>
              {projects().length === 0 && (
                <div class="px-2 py-1.5 text-xs" style="color: var(--text-muted)">No projects registered</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div class="flex-1 overflow-auto p-2">
        <div class="text-10 font-medium mb-1 px-1" style="color: var(--text-muted)">Sessions</div>
        <For each={sessions()}>
          {s => (
            <div class="px-2 py-1 text-xs truncate rounded hover:opacity-80 cursor-pointer" style="color: var(--text-strong)">
              {s.title || s.id.slice(0, 8)}
            </div>
          )}
        </For>
        {sessions().length === 0 && (
          <div class="px-2 py-1 text-xs" style="color: var(--text-muted)">No sessions</div>
        )}
      </div>

      <div class="flex items-center justify-center py-2 gap-3 border-t" style="border-color: var(--border-base)">
        {(Object.keys(TAB_CONFIG) as Tab[]).map(tab => (
          <button
            class="text-xs sidebar-tab-btn"
            style="color: var(--icon-base)"
            title={TAB_CONFIG[tab].label}
          >
            {TAB_CONFIG[tab].icon}
          </button>
        ))}
      </div>
    </aside>
  )
}

function App() {
  const [activeTab, setActiveTab] = createSignal<Tab>('dashboard')
  const gw = useGateway()

  return (
    <div class="flex h-screen" style="background: var(--bg-deep)">
      <SidebarPanel />

      <main class="flex-1 flex flex-col min-w-0">
        <header class="h-9 flex items-center px-3 gap-2 shrink-0 select-none border-b" style="border-color: var(--border-base); background: var(--bg-base)">
          <span class="text-xs font-medium" style="color: var(--text-strong)">MAFW</span>
          <span style="color: var(--text-muted); font-size: 12px">/</span>
          <span class="text-xs" style="color: var(--icon-base)">{TAB_CONFIG[activeTab()].label}</span>
          <div class="flex-1" />
          <div class="flex items-center gap-1.5">
            <div class={`status-dot ${gw.connected() ? 'bg-success' : 'bg-danger'}`} />
            <span class="text-11" style="color: var(--text-muted)">{gw.connected() ? 'Connected' : 'Disconnected'}</span>
          </div>
        </header>

        <div class="flex-1 overflow-auto">
          <div class="p-5 max-w-4xl">
            {gw.ready() ? (
              <Switch>
                <Match when={activeTab() === 'dashboard'}><DashboardPage /></Match>
                <Match when={activeTab() === 'memory'}><MemoryPage /></Match>
                <Match when={activeTab() === 'graph'}><GraphPage /></Match>
                <Match when={activeTab() === 'chat'}><ChatPage /></Match>
                <Match when={activeTab() === 'config'}><ConfigPage /></Match>
                <Match when={activeTab() === 'automations'}><AutomationsPage /></Match>
              </Switch>
            ) : (
              <div class="flex items-center justify-center h-40">
                <div class="text-13" style="color: var(--text-muted)">Connecting to Gateway...</div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function AppShell() {
  return (
    <GatewayProvider>
      <App />
    </GatewayProvider>
  )
}

render(() => <AppShell />, document.getElementById('root')!)
