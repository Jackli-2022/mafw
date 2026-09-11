import {
  ProcessTerminal, TuiAltScreen, VStack, Container, Text, type Component, type OverlayHandle, type TUI,
} from '@earendil-works/pi-tui'
import { MafwClient } from '@mafw/sdk'
import { basename } from 'node:path'
import { TabStrip, TABS, type TabId } from './tab-strip.ts'
import { StatusBar, type StatusState } from './status-bar.ts'
import { AppModel } from './app-model.ts'
import { ConnectionStore, type ConnState } from '../store/connection.ts'
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
  setEditing: (editing: boolean) => void
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

  // ── 状态条（单一可变状态源，避免部分更新时重置其他字段）──
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

  // 内容区：每 tab 一个 Container；各面板由后续 task 接管
  const bodies = new Map<TabId, Container>()
  for (const t of TABS) bodies.set(t.id, new Container())
  bodies.get('chat')!.addChild(new Text(theme.dim('Chat tab: T6 接入'), 1, 0))
  bodies.get('goals')!.addChild(new Text(theme.dim('Goals tab: T8 接入'), 1, 0))
  bodies.get('memory')!.addChild(new Text(theme.dim('Memory tab: T9 接入'), 1, 0))
  bodies.get('triage')!.addChild(new Text(theme.dim('Triage tab: T10 接入'), 1, 0))

  let currentBody: Component = bodies.get(model.active)!
  const contentHost = new Container()
  contentHost.addChild(currentBody)

  tui.setLayoutRoot(new VStack([
    { component: tabStrip, basis: 'auto', minSize: 1 },
    { component: contentHost, basis: 0, grow: 1, minSize: 1 },
    { component: statusBar, basis: 'auto', minSize: 1 },
  ]))

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
      '  1-4      切换 Chat / Goals / Memory / Triage',
      '  q        退出（非输入态）',
      '  Ctrl+C   强制退出',
      '  Esc      流式期间中止回合 / 关闭弹窗',
      '',
      'Chat slash 命令',
      '  /new     新话题（rotate manager session）',
      '  /btw <问题>  支线问答',
      '  /older   加载更早历史',
      '  /help    本帮助',
    ].join('\n'), 1, 1)
    helpHandle = tui.showOverlay(help, { width: 56, maxHeight: 15, anchor: 'center' })
  }

  const ctx: AppContext = {
    client, tui, model, managerSessionID, projectDir, opts, setStatus,
    showHelp: () => toggleHelp(),
    setEditing: (editing) => { model.editing = editing },
  }

  // ── 连接监督（T7 在 onEvent 里挂 overlay 分发）──
  const onEvent = (_type: string, _data: any) => { /* T7: permission.asked overlay */ }
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
    contentHost.addChild(currentBody)
    tabStrip.setActive(model.active)
    tui.requestRender()
  }

  tui.addInputListener((data) => {
    const prevTab = model.active
    const prevHelp = model.helpVisible
    const r = model.handleKey(data)
    if (r === 'quit') {
      tui.stop()
      process.exit(0)
    }
    // 只消费本层真正处理的键（tab 切换 / help），其余放行给焦点组件（Editor 等）
    if (model.active !== prevTab || model.helpVisible !== prevHelp) return { consume: true }
    return undefined
  })

  tui.start()
}
