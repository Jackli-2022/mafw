import {
  ProcessTerminal, TuiAltScreen, VStack, Container, Text, matchesKey, Key,
  type Component, type OverlayHandle, type TUI,
} from '@earendil-works/pi-tui'
import { MafwClient } from '@mafw/sdk'
import { basename } from 'node:path'
import { TabStrip, TABS, type TabId } from './tab-strip.ts'
import { StatusBar, type StatusState } from './status-bar.ts'
import { AppModel } from './app-model.ts'
import { ConnectionStore, type ConnState } from '../store/connection.ts'
import { ChatStore } from '../store/chat-store.ts'
import { ChatTab } from './chat-tab.ts'
import { showPermissionOverlay } from './overlays.ts'
import { GoalsStore } from '../store/goals-store.ts'
import { GoalsTab } from './goals-tab.ts'
import { theme } from '../theme.ts'

export type Retriever = 'bm25' | 'hybrid'

export interface AppOptions {
  baseUrl: string
  retriever: Retriever
}

export interface AppContext {
  client: MafwClient
  tui: TUI
  model: AppModel
  managerSessionID: string | null
  projectDir: string | null
  opts: AppOptions
  setStatus: (patch: Partial<StatusState>) => void
  showHelp: () => void
}

export async function runApp(opts: AppOptions): Promise<void> {
  const client = new MafwClient(opts.baseUrl)
  const model = new AppModel()
  const terminal = new ProcessTerminal()
  const tui = new TuiAltScreen(terminal)
  const tabStrip = new TabStrip()
  const statusBar = new StatusBar()

  // manager session 定位（当前项目；拿不到时 chat tab 显示提示）
  const project = await client.project.current().catch(() => null)
  const projectDir = project?.worktree ?? null
  const mgr = projectDir
    ? await client.manager.session(projectDir).catch(() => null)
    : null
  const managerSessionID = mgr?.sessionId ?? null

  // ── 状态条（单一可变状态源）──
  const status: StatusState = {
    project: projectDir ? basename(projectDir) : undefined,
    session: managerSessionID ?? undefined,
    conn: 'ok',
  }
  const setStatus = (patch: Partial<StatusState>) => {
    Object.assign(status, patch)
    statusBar.setState(status)
    tui.requestRender()
  }
  statusBar.setState(status)
  tabStrip.setConnected(true)

  // ── Chat tab ──
  const chatStore = new ChatStore({
    session: client.session,
    sessionID: managerSessionID ?? 'none',
    onChange: () => tui.requestRender(),
    onError: (message) => setStatus({ hint: theme.err(`⚠ ${message.slice(0, 60)}`) }),
  })
  const chatTab = new ChatTab({ tui, store: chatStore, onSlash: (cmd, args) => handleSlash(cmd, args), onError: (m) => setStatus({ hint: theme.err(`⚠ ${m.slice(0, 60)}`) }) })

  // ── Goals tab ──
  const goalsStore = new GoalsStore({
    goals: client.goals,
    questions: client.questions,
    onChange: () => tui.requestRender(),
  })
  const goalsTab = new GoalsTab({ tui, store: goalsStore, client, setStatus })
  goalsStore.start()

  // ── 帮助 overlay ──
  let helpHandle: OverlayHandle | null = null
  function toggleHelp(): void {
    if (helpHandle) {
      helpHandle.hide()
      helpHandle = null
      return
    }
    const help = new Text([
      '快捷键',
      '',
      '  1-4 / Alt+1-4   切换 Chat / Goals / Memory / Triage',
      '  q               退出（非输入态）',
      '  Ctrl+C          强制退出',
      '  Esc             流式期间中止回合',
      '',
      'Chat slash 命令',
      '  /new            新话题（rotate manager session）',
      '  /btw <问题>     支线问答',
      '  /older          加载更早历史',
      '  /help           本帮助',
    ].join('\n'), 1, 1)
    helpHandle = tui.showOverlay(help, { width: 58, maxHeight: 16, anchor: 'center' })
  }

  async function handleSlash(cmd: string, args: string): Promise<string | null> {
    if (cmd === 'help') { toggleHelp(); return null }
    if (cmd === 'older') { await chatTab.loadOlder(); return null }
    if (cmd === 'new') {
      if (!projectDir) return '当前无项目上下文，无法 rotate'
      const r = await client.manager.rotate(projectDir, 'tui /new').catch((e: any) => ({ error: e.message }))
      if ('error' in (r as any)) return `rotate 失败: ${(r as any).error}`
      return '已开新话题（manager session 已轮换，重开 /new 后的对话走新会话）'
    }
    if (cmd === 'btw') {
      if (!args.trim()) return '用法: /btw <问题>'
      const r = await client.mafwCommands.run({ command: 'btw', args }).catch((e: any) => ({ error: e.message }))
      if ('error' in (r as any)) return `btw 失败: ${(r as any).error}`
      return null
    }
    return `未知命令 /${cmd}（可用: /new /btw /older /help）`
  }

  // ── 布局：TabStrip / 内容区(grow) / StatusBar ──
  const placeholder = (label: string) => {
    const c = new Container()
    c.addChild(new Text(theme.dim(label), 1, 0))
    return c
  }
  const bodies = new Map<TabId, Component>([
    ['chat', chatTab],
    ['goals', goalsTab],
    ['memory', placeholder('Memory tab: T9 接入')],
    ['triage', placeholder('Triage tab: T10 接入')],
  ])
  let currentBody: Component = bodies.get(model.active)!
  const contentHost = new VStack([])
  contentHost.addChild(currentBody, { basis: 0, grow: 1, minSize: 1 })

  tui.setLayoutRoot(new VStack([
    { component: tabStrip, basis: 'auto', minSize: 1 },
    { component: contentHost, basis: 0, grow: 1, minSize: 1 },
    { component: statusBar, basis: 'auto', minSize: 1 },
  ]))

  const ctx: AppContext = {
    client, tui, model, managerSessionID, projectDir, opts, setStatus, showHelp: () => toggleHelp(),
  }
  void ctx

  // ── 连接监督 + SSE 事件分发 ──
  const onEvent = (type: string, data: any) => {
    if (type === 'permission.asked') {
      const req: any = data?.properties ?? data
      if (req?.id) {
        showPermissionOverlay(tui, req, (r) => client.permissions.reply(req.id, r))
      }
    }
  }
  if (managerSessionID) {
    const conn = new ConnectionStore({
      sessionID: managerSessionID,
      subscribe: (sid) => client.event.subscribeToSession(sid),
      isConnected: () => {
        const ev = (client.event as any)
        return typeof ev.connected === 'function' ? ev.connected() : true
      },
      onEvent,
      onState: (s) => {
        setStatus({ conn: s })
        tabStrip.setConnected(s === 'ok')
      },
    })
    conn.start()
  }

  function applyTab(): void {
    contentHost.removeChild(currentBody)
    currentBody = bodies.get(model.active)!
    contentHost.addChild(currentBody, { basis: 0, grow: 1, minSize: 1 })
    model.editing = model.active === 'chat' && !model.helpVisible
    tabStrip.setActive(model.active)
    tui.requestRender()
  }

  // 滚动到顶自动加载更早历史（1s 轮询；chat tab 激活时）
  const topTimer = setInterval(() => {
    if (model.active === 'chat' && chatTab.atTop) void chatTab.loadOlder()
  }, 1000)

  tui.addInputListener((data) => {
    // Esc：流式中止回合（优先于焦点组件）
    if (matchesKey(data, Key.escape) && chatStore.streaming && !tui.hasOverlay()) {
      void chatStore.abort()
      return { consume: true }
    }
    const prevTab = model.active
    const prevHelp = model.helpVisible
    const r = model.handleKey(data)
    if (r === 'quit') {
      clearInterval(topTimer)
      goalsStore.stop()
      tui.stop()
      process.exit(0)
    }
    if (model.active !== prevTab || model.helpVisible !== prevHelp) {
      if (helpHandle && !model.helpVisible) { helpHandle.hide(); helpHandle = null }
      applyTab()
      return { consume: true }
    }
    // 非 chat tab 的 tab 级按键（上下/Enter/x）
    if (!model.editing && !tui.hasOverlay() && model.active !== 'chat') {
      const tab = currentBody as { handleTabKey?: (d: string) => boolean }
      if (typeof tab.handleTabKey === 'function' && tab.handleTabKey(data)) return { consume: true }
    }
    return undefined
  })

  tui.start()
}
