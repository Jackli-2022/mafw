import {
  ProcessTerminal, TuiAltScreen, VStack, Container, Text, SelectList, matchesKey, Key,
  type Component, type OverlayHandle, type TUI, type SelectItem,
} from '@earendil-works/pi-tui'
import { MafwClient } from '@mafw/sdk'
import { basename } from 'node:path'
import { TabStrip, TABS, type TabId } from './tab-strip.ts'
import { StatusBar, type StatusState } from './status-bar.ts'
import { AppModel } from './app-model.ts'
import { ConnectionStore, type ConnState } from '../store/connection.ts'
import { ChatStore } from '../store/chat-store.ts'
import { ChatTab, selectListTheme } from './chat-tab.ts'
import { createSlashHandler } from './slash-commands.ts'
import { defaultEditorCommand, editInExternalEditor } from '../external-editor.ts'
import { showPermissionOverlay } from './overlays.ts'
import { GoalsStore } from '../store/goals-store.ts'
import { GoalsTab } from './goals-tab.ts'
import { MemoryStore } from '../store/memory-store.ts'
import { MemoryTab } from './memory-tab.ts'
import { TriageStore } from '../store/triage-store.ts'
import { TriageTab } from './triage-tab.ts'
import { theme } from '../theme.ts'

export type Retriever = 'bm25' | 'hybrid'

export interface AppOptions {
  baseUrl: string
  retriever: Retriever
}

export async function runApp(opts: AppOptions): Promise<void> {
  const client = new MafwClient(opts.baseUrl)
  const model = new AppModel()
  const terminal = new ProcessTerminal()
  const tui = new TuiAltScreen(terminal)
  const tabStrip = new TabStrip()
  const statusBar = new StatusBar()
  const appStart = Date.now()

  // manager session 定位（当前项目；拿不到时 chat tab 显示提示）
  const project = await client.project.current().catch(() => null)
  const projectDir = project?.worktree ?? null
  const projectID = project?.id ?? null
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

  // ── 模型选择（/model；null = 会话默认）──
  let modelSelection: { providerID: string; modelID: string } | null = null
  let defaultModelLabel = ''
  void client.providers.list().then((p) => {
    const d: any = (p as any)?.default
    if (d?.modelID) {
      defaultModelLabel = String(d.modelID)
      setStatus({ usage: { ...(status.usage ?? {}), model: defaultModelLabel } })
    }
  }).catch(() => {})

  // ── Chat tab ──
  const chatStore = new ChatStore({
    session: client.session,
    sessionID: managerSessionID ?? 'none',
    onChange: () => tui.requestRender(),
    onError: (message) => setStatus({ hint: theme.err(`⚠ ${message.slice(0, 60)}`) }),
    getModel: () => modelSelection,
  })
  const chatTab = new ChatTab({
    tui, store: chatStore,
    onSlash: (cmd, args) => slashHandler(cmd, args),
    onError: (m) => setStatus({ hint: theme.err(`⚠ ${m.slice(0, 60)}`) }),
  })

  // ── Goals tab ──
  const goalsStore = new GoalsStore({
    goals: client.goals,
    questions: client.questions,
    onChange: () => tui.requestRender(),
  })
  const goalsTab = new GoalsTab({ tui, store: goalsStore, client, setStatus })
  goalsStore.start()

  // ── Memory tab ──
  const memoryStore = new MemoryStore({
    memory: client.memory,
    onChange: () => memoryTab.refresh(),
    onError: (m) => setStatus({ hint: theme.err(`⚠ ${m.slice(0, 60)}`) }),
  })
  const memoryTab = new MemoryTab({ tui, store: memoryStore, client, setStatus, setEditing: (v) => { model.editing = v } })

  // ── Triage tab ──
  const triageStore = new TriageStore({
    approvals: client.approvals,
    triage: client.triage,
    onChange: () => tui.requestRender(),
  })
  const triageTab = new TriageTab({ tui, store: triageStore, client, setStatus })
  triageStore.start()

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
      '  Ctrl+G          外部编辑器编辑输入（$EDITOR）',
      '',
      'Chat 输入',
      '  ! <command>     本地 shell（零成本，不进对话）',
      '  @路径 / /命令   编辑器补全',
      '',
      'Chat slash 命令',
      '  /new            新话题（rotate manager session）',
      '  /sessions       会话列表/切换（/resume /switch）',
      '  /model          选择模型（作用于后续消息）',
      '  /compact        压缩当前会话上下文',
      '  /undo /redo     回退/恢复最后一轮',
      '  /btw <问题>     支线问答',
      '  /older          加载更早历史',
      '  /editor         外部编辑器（同 Ctrl+G）',
      '  /help           本帮助',
    ].join('\n'), 1, 1)
    helpHandle = tui.showOverlay(help, { width: 58, maxHeight: 28, anchor: 'center' })
  }

  // ── 会话切换（/sessions）──
  let conn: ConnectionStore | null = null
  function ensureConn(sessionID: string): ConnectionStore {
    if (conn) {
      conn.setSession(sessionID)
      return conn
    }
    conn = new ConnectionStore({
      sessionID,
      subscribe: (sid) => client.event.subscribeToSession(sid),
      isConnected: () => client.event.connected(),
      onEvent,
      onState: (s) => {
        setStatus({ conn: s })
        tabStrip.setConnected(s === 'ok')
      },
    })
    conn.start()
    return conn
  }

  async function switchToSession(sessionID: string): Promise<void> {
    await chatStore.switchSession(sessionID)
    chatTab.rebuild()
    ensureConn(sessionID)
    setStatus({ session: sessionID })
    void refreshUsage()
  }

  async function showSessionPicker(): Promise<void> {
    let sessions: any[]
    try {
      sessions = await client.session.list(projectID ? { query: { projectID } } : undefined)
    } catch (e: any) {
      setStatus({ hint: theme.err(`会话列表失败: ${String(e?.message ?? e).slice(0, 50)}`) })
      return
    }
    if (!sessions || sessions.length === 0) {
      setStatus({ hint: theme.dim('（当前项目无会话）') })
      return
    }
    const items: SelectItem[] = sessions.map((s: any) => ({
      value: s.id,
      label: `${s.title || String(s.id).slice(0, 20)}${s.id === managerSessionID ? theme.ok(' ★manager') : ''}`,
      description: s.time?.updated ? new Date(s.time.updated).toLocaleString() : '',
    }))
    const list = new SelectList(items, Math.min(items.length, 10), selectListTheme)
    const handle = tui.showOverlay(list, { width: '70%', maxHeight: 16, anchor: 'center' })
    const close = () => { off(); handle.hide() }
    const off = tui.addInputListener((data) => {
      if (matchesKey(data, Key.escape)) { close(); return { consume: true } }
      return undefined
    })
    list.onSelect = (item) => { close(); void switchToSession(String(item.value)) }
    list.onCancel = close
  }

  // ── 模型选择（/model）──
  async function showModelPicker(): Promise<void> {
    const p = await client.providers.list().catch(() => null)
    const all: any[] = p?.all ?? []
    const connected = new Set<string>(p?.connected ?? [])
    const items: SelectItem[] = []
    for (const prov of all) {
      if (connected.size > 0 && !connected.has(prov.id)) continue
      for (const [mid, m] of Object.entries<any>(prov.models ?? {})) {
        items.push({ value: `${prov.id}/${mid}`, label: m?.name || mid, description: prov.id })
      }
    }
    if (items.length === 0) {
      setStatus({ hint: theme.dim('（无可用模型——检查 provider 连接）') })
      return
    }
    const list = new SelectList(items, 10, selectListTheme)
    const handle = tui.showOverlay(list, { width: '60%', maxHeight: 16, anchor: 'center' })
    const close = () => { off(); handle.hide() }
    const off = tui.addInputListener((data) => {
      if (matchesKey(data, Key.escape)) { close(); return { consume: true } }
      return undefined
    })
    list.onSelect = (item) => {
      close()
      const slash = String(item.value).indexOf('/')
      if (slash <= 0) return
      modelSelection = {
        providerID: String(item.value).slice(0, slash),
        modelID: String(item.value).slice(slash + 1),
      }
      setStatus({ usage: { ...(status.usage ?? {}), model: modelSelection.modelID } })
      setStatus({ hint: theme.ok(`模型: ${modelSelection.providerID}/${modelSelection.modelID}`) })
    }
    list.onCancel = close
  }

  // ── 用量轮询（模型/token/成本/时长 → 状态栏）──
  async function refreshUsage(): Promise<void> {
    const sid = chatStore.sessionID
    if (!sid || sid === 'none') return
    try {
      const t = await client.session.tokenSummary({ path: { id: sid } })
      const total = t.totalTokens.input + t.totalTokens.output + t.totalTokens.reasoning
      setStatus({
        usage: {
          model: modelSelection?.modelID ?? defaultModelLabel,
          tokens: total,
          costUsd: t.totalCost ?? null,
          durationMs: Date.now() - appStart,
        },
      })
    } catch { /* fail-open */ }
  }
  setInterval(() => { if (model.active === 'chat') void refreshUsage() }, 15_000)
  void refreshUsage()

  // ── 外部编辑器（Ctrl+G / /editor）──
  async function openInExternalEditor(): Promise<void> {
    const command = defaultEditorCommand()
    tui.stop()
    try {
      const result = await editInExternalEditor({ command, content: chatTab.getEditorText() })
      if (result.status === 'complete' && result.content !== undefined) chatTab.setEditorText(result.content)
    } finally {
      tui.start()
      tui.requestRender(true)
    }
  }

  // ── slash 命令派发 ──
  const slashHandler = createSlashHandler({
    loadOlder: () => chatTab.loadOlder(),
    toggleHelp,
    rotateTopic: async () => {
      if (!projectDir) return '当前无项目上下文，无法 rotate'
      const r = await client.manager.rotate(projectDir, 'tui /new').catch((e: any) => ({ error: e.message }))
      if ('error' in (r as any)) return `rotate 失败: ${(r as any).error}`
      const next = await client.manager.session(projectDir).catch(() => null)
      if (next?.sessionId) await switchToSession(next.sessionId)
      return '已开新话题（manager session 已轮换并切换）'
    },
    btw: async (args) => {
      if (!args.trim()) return '用法: /btw <问题>'
      const r = await client.mafwCommands.run({ command: 'btw', args }).catch((e: any) => ({ error: e.message }))
      if ('error' in (r as any)) return `btw 失败: ${(r as any).error}`
      return null
    },
    showSessionPicker,
    showModelPicker,
    compact: async () => {
      const sid = chatStore.sessionID
      if (!sid || sid === 'none') return '当前无会话'
      try {
        await client.session.summarize({ path: { id: sid } })
        await chatStore.loadHistory()
        chatTab.rebuild()
        return null
      } catch (e: any) {
        return `compact 失败: ${String(e?.message ?? e).slice(0, 80)}`
      }
    },
    undo: () => chatStore.undo(),
    redo: () => chatStore.redo(),
    openExternalEditor: openInExternalEditor,
  })

  // ── 布局：TabStrip / 内容区(grow) / StatusBar ──
  const bodies = new Map<TabId, Component>([
    ['chat', chatTab],
    ['goals', goalsTab],
    ['memory', memoryTab],
    ['triage', triageTab],
  ])
  let currentBody: Component = bodies.get(model.active)!
  const contentHost = new VStack([])
  contentHost.addChild(currentBody, { basis: 0, grow: 1, minSize: 1 })

  tui.setLayoutRoot(new VStack([
    { component: tabStrip, basis: 'auto', minSize: 1 },
    { component: contentHost, basis: 0, grow: 1, minSize: 1 },
    { component: statusBar, basis: 'auto', minSize: 1 },
  ]))

  // ── 连接监督 + SSE 事件分发 ──
  const onEvent = (type: string, data: any) => {
    if (type === 'permission.asked') {
      const req: any = data?.properties ?? data
      if (req?.id) {
        showPermissionOverlay(tui, req, (r) => client.permissions.reply(req.id, r))
      }
    } else if (type === 'session.idle') {
      void refreshUsage()
    }
  }
  if (managerSessionID) ensureConn(managerSessionID)

  function applyTab(): void {
    contentHost.removeChild(currentBody)
    currentBody = bodies.get(model.active)!
    contentHost.addChild(currentBody, { basis: 0, grow: 1, minSize: 1 })
    model.editing = model.active === 'chat' && !model.helpVisible
    // 焦点切换：chat 聚焦编辑器链，memory 由其搜索框态决定，其余清焦
    if (model.active === 'chat') {
      tui.setFocus(chatTab)
      memoryTab.blurSearch()
    } else if (model.active === 'memory') {
      if (!memoryTab.inputFocused) tui.setFocus(null)
    } else {
      tui.setFocus(null)
      memoryTab.blurSearch()
    }
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
    // Ctrl+G：外部编辑器（chat 输入态）
    if (matchesKey(data, Key.ctrl('g')) && model.active === 'chat' && model.editing && !tui.hasOverlay()) {
      void openInExternalEditor()
      return { consume: true }
    }
    const prevTab = model.active
    const prevHelp = model.helpVisible
    const r = model.handleKey(data)
    if (r === 'quit') {
      clearInterval(topTimer)
      goalsStore.stop()
      triageStore.stop()
      tui.stop()
      process.exit(0)
    }
    if (model.active !== prevTab || model.helpVisible !== prevHelp) {
      if (helpHandle && !model.helpVisible) { helpHandle.hide(); helpHandle = null }
      applyTab()
      return { consume: true }
    }
    // 非 chat tab 的 tab 级按键（上下/Enter/x/u/i）
    if (!model.editing && !tui.hasOverlay() && model.active !== 'chat') {
      const tab = currentBody as { handleTabKey?: (d: string) => boolean }
      if (typeof tab.handleTabKey === 'function' && tab.handleTabKey(data)) return { consume: true }
    }
    // Esc：memory 搜索框失焦回列表
    if (matchesKey(data, Key.escape) && model.active === 'memory' && memoryTab.inputFocused) {
      memoryTab.blurSearch()
      return { consume: true }
    }
    return undefined
  })

  // 初始焦点：启动即 applyTab（聚焦 chat 编辑器链）。
  // pi-tui 无自动聚焦——focusedComponent 初始为 null，按键会无处去（"tui 没法输入"根因之一）。
  applyTab()

  tui.start()
}
