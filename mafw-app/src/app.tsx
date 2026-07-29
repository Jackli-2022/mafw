import { Route, Router } from '@solidjs/router'
import { GatewayProvider } from './gateway/provider'
import { Titlebar } from './components/titlebar'
import { ProjectContext, GoalPanel, MemoryPanel, PendingPanel, AutomationsPanel, SessionPanel } from './panels'
import { HomePage } from './pages/home'
import { ChatPage } from './pages/chat'
import { useGateway } from './gateway/provider'

function Sidebar() {
  const gw = useGateway()
  return (
    <aside class="flex flex-col h-full w-[280px] shrink-0 border-r" style="border-color: var(--border-border-secondary); background: var(--v2-background-bg-deep)">
      <ProjectContext />
      <GoalPanel />
      <MemoryPanel />
      <PendingPanel />
      <AutomationsPanel />
      <div class="flex-1" />
      <SessionPanel />
      <div class="px-3 py-2 border-t flex items-center" style="border-color: var(--border-border-secondary)">
        <span class="flex-1 text-xs" style="color: var(--text-text-muted)">
          {gw.connected() ? '● Connected' : '○ Disconnected'}
        </span>
      </div>
    </aside>
  )
}

function Layout(props: { children: any }) {
  return (
    <div class="flex h-screen" style="background: var(--v2-background-bg-deep)">
      <Sidebar />
      <div class="flex-1 flex flex-col min-w-0">
        <Titlebar />
        <main class="flex-1 min-h-0 overflow-hidden">
          {props.children}
        </main>
      </div>
    </div>
  )
}

function Home() {
  return <Layout><HomePage /></Layout>
}

function Chat() {
  return <Layout><ChatPage /></Layout>
}

export function App() {
  return (
    <GatewayProvider>
      <Router>
        <Route path="/" component={Home} />
        <Route path="/chat/:sessionId?" component={Chat} />
      </Router>
    </GatewayProvider>
  )
}
