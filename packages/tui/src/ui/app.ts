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
import { enableClickDispatch } from './clickable-tui.ts'
import { ClickableSelectList } from './clickable-select-list.ts'
import { dispatchKey, type KeyDispatchContext } from './keymap.ts'
import { InteractionStateMachine } from './interaction-state.ts'
import { helpLines } from './command-registry.ts'
import { COMMAND_REGISTRY, resolveCommand } from './command-registry.ts'
import { mergeCommands, type RemoteCommand } from './gateway-commands.ts'
import { exportChat as exportChatToFile } from './export-chat.ts'
import { lastAssistantText, copyToClipboard } from './copy-text.ts'
import { QueueOverlay } from './queue-overlay.ts'
import { TranscriptSearchOverlay } from './transcript-search.ts'
import { ConfirmOverlay, type ConfirmAnswer } from './confirm-overlay.ts'
import { computeRecap, recapLines } from './session-recap.ts'
import { colorDiffLine } from './message-blocks.ts'
import { runShell } from '../shell-mode.ts'
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
  /** 启动即连接的会话（`mafw tui --session <id>`）；缺省 = 当前项目 manager session。 */
  sessionID?: string
}

export async function runApp(opts: AppOptions): Promise<void> {
  const client = new MafwClient(opts.baseUrl)
  const model = new AppModel()
  const terminal = new ProcessTerminal()
  const tui = new TuiAltScreen(terminal)
  // 组件级鼠标点击派发（tab 切换 / picker 行 / 列表行 / 编辑器聚焦；滚轮与拖选为 pi-tui 内建）
  enableClickDispatch(tui)
  const tabStrip = new TabStrip()
  const statusBar = new StatusBar()
  const appStart = Date.now()

  // manager session 定位（当前项目；拿不到时 chat tab 显示提示）。
  // --session <id> 显式指定时直接连接该会话。
  const project = await client.project.current().catch(() => null)
  const projectDir = project?.worktree ?? null
  const projectID = project?.id ?? null
  const mgr = !opts.sessionID && projectDir
    ? await client.manager.session(projectDir).catch(() => null)
    : null
  const managerSessionID = opts.sessionID ?? mgr?.sessionId ?? null

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
  const interaction = new InteractionStateMachine()
  const chatStore = new ChatStore({
    session: client.session,
    sessionID: managerSessionID ?? 'none',
    onChange: () => { tui.requestRender(); syncInteraction() },
    onError: (message) => setStatus({ hint: theme.err(`⚠ ${message.slice(0, 60)}`) }),
    getModel: () => modelSelection,
  })
  const chatTab = new ChatTab({
    tui, store: chatStore,
    onSlash: (cmd, args) => handleSlashWithConfirm(cmd, args),
    onError: (m) => setStatus({ hint: theme.err(`⚠ ${m.slice(0, 60)}`) }),
  })

  // ── gateway 命令注册表拉取（P0）：本地命令优先合并进补全；未命中本地时 fallback 派发 ──
  let gatewayCmds: RemoteCommand[] = []
  void client.mafwCommands.list().then((cmds) => {
    gatewayCmds = cmds
    chatTab.setAutocompleteExtra(mergeCommands([], cmds))
  }).catch(() => { /* fail-open：远端命令不可用不阻塞 */ })

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
  }, opts.retriever)
  const memoryTab = new MemoryTab({ tui, store: memoryStore, client, setStatus, setEditing: (v) => { model.editing = v } })

  // ── Triage tab ──
  const triageStore = new TriageStore({
    approvals: client.approvals,
    triage: client.triage,
    onChange: () => tui.requestRender(),
  })
  const triageTab = new TriageTab({ tui, store: triageStore, client, setStatus })
  triageStore.start()

  // ── 帮助 overlay（命令区由 COMMAND_REGISTRY 驱动；键位区静态）──
  let helpHandle: OverlayHandle | null = null
  function toggleHelp(): void {
    if (helpHandle) {
      helpHandle.hide()
      helpHandle = null
      model.helpVisible = false
      applyTab()
      return
    }
    const body = [
      '快捷键',
      '',
      '  1-4 / Alt+1-4   切换 Chat / Goals / Memory / Triage',
      '  q / Ctrl+C      退出（输入态归编辑器）',
      '  Esc             busy 时中止回合 / 关闭 overlay',
      '  Ctrl+G          外部编辑器编辑输入（$EDITOR）',
      '  ↑ / ↓           输入历史（提交过才有）',
      '',
      'Chat 输入',
      '  ! <command>     本地 shell（零成本，不进对话）',
      '  @路径 / /命令   编辑器补全',
      '',
      ...helpLines(),
      theme.dim('⚠ = 破坏性操作'),
    ].join('\n')
    model.helpVisible = true
    applyTab()
    helpHandle = tui.showOverlay(new Text(body, 1, 1), { width: 62, maxHeight: 32, anchor: 'center' })
  }

  // ── 会话切换（/sessions）──
  let conn: ConnectionStore | null = null
  function ensureConn(_sessionID: string): ConnectionStore {
    if (conn) {
      // Mode A 全局流无 per-session 维度（事件按 part.sessionID / message.complete.sessionID 客户端过滤）
      return conn
    }
    conn = new ConnectionStore({
      sessionID: 'global',
      subscribe: () => client.event.subscribe(),
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
    const handle = tui.showOverlay(new ClickableSelectList(list), { width: '70%', maxHeight: 16, anchor: 'center' })
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
    const handle = tui.showOverlay(new ClickableSelectList(list), { width: '60%', maxHeight: 16, anchor: 'center' })
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
  let promptStart: number | null = null
  let lastPromptMs = 0
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
          promptMs: promptStart !== null ? Date.now() - promptStart : lastPromptMs,
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

  // ── /queue 排队消息管理 ──
  function showQueueManager(): Promise<void> {
    const overlay = new QueueOverlay({
      getItems: () => chatStore.queuedTexts,
      onTakeBack: (i) => {
        const text = chatStore.dropQueuedAt(i)
        if (text !== null) chatTab.setEditorText(text)
      },
      onDrop: (i) => { chatStore.dropQueuedAt(i) },
      onClose: () => { handle.hide(); syncInteraction() },
      requestRender: () => tui.requestRender(),
    })
    const handle = tui.showOverlay(overlay, { width: '60%', maxHeight: 14, anchor: 'center' })
    syncInteraction()
    return Promise.resolve()
  }

  // ── Ctrl+O 会话内搜索（跳转滚动）──
  function openTranscriptSearch(): void {
    const overlay = new TranscriptSearchOverlay({
      getTurns: () => chatStore.turns,
      onJump: (turnIndex) => {
        const t = chatStore.turns[turnIndex]
        if (t) chatTab.scrollToTurn(t.messageID)
      },
      onClose: () => handle.hide(),
      requestRender: () => tui.requestRender(),
    })
    const handle = tui.showOverlay(overlay, { width: '70%', maxHeight: 14, anchor: 'center' })
  }

  // ── /diff git 变更视图 ──
  async function showDiff(scope: string): Promise<string | null> {
    const arg = scope === 'staged' ? ' --staged' : scope === 'all' ? ' HEAD' : ''
    const r = await runShell(`git diff${arg}`, { timeoutMs: 15_000 })
    if (r.exitCode !== 0 && r.stderr) return `git diff 失败: ${r.stderr.split('\n')[0].slice(0, 80)}`
    const raw = (r.stdout || '').split('\n')
    if (raw.length <= 1 && !r.stdout) { showDiffOverlay(['（无未提交变更）'], scope); return null }
    const MAX_DIFF_LINES = 150
    const lines = raw.slice(0, MAX_DIFF_LINES).map((l) => colorDiffLine(l))
    if (raw.length > MAX_DIFF_LINES) lines.push(theme.dim(`… 截断（共 ${raw.length} 行）`))
    showDiffOverlay(lines, scope)
    return null
  }

  function showDiffOverlay(lines: string[], scope: string): void {
    const title = theme.accent(`git diff${scope ? ` (${scope})` : ''}`) + theme.dim(' · Esc 关闭')
    const overlay = tui.showOverlay(new Text([title, '', ...lines].join('\n'), 1, 1), { width: '90%', maxHeight: '70%', anchor: 'center' })
    const close = () => { off(); overlay.hide() }
    const off = tui.addInputListener((data) => {
      if (matchesKey(data, Key.escape)) { close(); return { consume: true } }
      return undefined
    })
  }

  // ── 破坏性命令确认（Hermes 三选 + inline skip）──
  const sessionApproved = new Set<string>()
  function showConfirm(title: string, description?: string): Promise<ConfirmAnswer> {
    return new Promise((resolve) => {
      const overlay = new ConfirmOverlay({
        title, description,
        onAnswer: (mode) => { handle.hide(); resolve(mode) },
        requestRender: () => tui.requestRender(),
      })
      const handle = tui.showOverlay(overlay, { width: 52, maxHeight: 12, anchor: 'center' })
    })
  }

  async function handleSlashWithConfirm(rawCmd: string, args: string): Promise<string | null> {
    const name = resolveCommand(rawCmd)
    const def = COMMAND_REGISTRY.find((c) => c.name === name)
    const gwDef = gatewayCmds.find((c) => c.name === rawCmd || c.aliases?.includes(rawCmd))
    const inlineSkip = /^(now|--yes|-y)(\s|$)/i.test(args.trim())
    if ((def?.destructive || gwDef?.destructive) && !inlineSkip
      && !(def && sessionApproved.has(def.name)) && !(gwDef && sessionApproved.has(gwDef.name))) {
      const title = def?.name ?? gwDef?.name ?? rawCmd
      const desc = def?.description ?? gwDef?.description ?? ''
      const answer = await showConfirm(`确认执行 /${title}？`, desc)
      if (answer === 'cancel') return '已取消'
      if (answer === 'always') sessionApproved.add(title)
    }
    return slashHandler(rawCmd, inlineSkip ? args.trim().replace(/^(now|--yes|-y)\s+/i, '') : args)
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
    waitwhat: async () => {
      const sid = chatStore.sessionID
      if (!sid) return '当前无会话'
      const r = await client.mafwCommands.run({ command: 'waitwhat', sessionID: sid }).catch((e: any) => ({ error: e.message }))
      if ('error' in (r as any)) return `waitwhat 失败: ${(r as any).error}`
      if ((r as any).ok === false) return `waitwhat: ${(r as any).error ?? '没有可重述的回复'}`
      return null
    },
    showSessionPicker,
    showQueueManager,
    showModelPicker,
    cycleVerbosity: () => { const v = chatTab.cycleVerbosity(); setStatus({ focus: chatTab.display.focus }); return v },
    toggleFocus: () => { const f = chatTab.toggleFocus(); setStatus({ focus: f }); return f },
    showDiff,
    rename: async (args) => {
      const title = args.trim()
      if (!title) return '用法: /rename <标题>'
      try {
        await client.session.rename({ path: { id: chatStore.sessionID }, body: { title } })
        return `已命名: ${title}`
      } catch (e: any) {
        return `rename 失败: ${String(e?.message ?? e).slice(0, 80)}`
      }
    },
    fork: async () => {
      try {
        const r = await client.session.fork({ path: { id: chatStore.sessionID } })
        const newId = (r as any)?.session?.id
        if (!newId) return 'fork 失败: 无新会话返回'
        await switchToSession(String(newId))
        return `已分叉 → ${String(newId).slice(0, 16)}`
      } catch (e: any) {
        return `fork 失败: ${String(e?.message ?? e).slice(0, 80)}`
      }
    },
    showStatusRecap: () => {
      const body = recapLines(
        computeRecap(chatStore.turns),
        chatStore.sessionID,
        status.project ?? '-',
      ).join('\n')
      const overlay = tui.showOverlay(new Text(body, 1, 1), { width: '70%', maxHeight: 20, anchor: 'center' })
      const close = () => { off(); overlay.hide() }
      const off = tui.addInputListener((data) => {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) { close(); return { consume: true } }
        return undefined
      })
    },
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
    runGatewayCommand: async (name, args) => {
      const sid = chatStore.sessionID
      const r = await client.mafwCommands.run({ command: name, args, ...(sid ? { sessionID: sid } : {}) })
        .catch((e: any) => ({ error: e.message }))
      if ('error' in (r as any)) return `/${name} 失败: ${(r as any).error}`
      return (r as any).message || (r as any).text || null
    },
    gatewayCommands: () => gatewayCmds,
    exportChat: async () => {
      try {
        const file = await exportChatToFile(chatStore.turns, process.cwd())
        return `已导出: ${file}`
      } catch (e: any) {
        return `导出失败: ${String(e?.message ?? e).slice(0, 80)}`
      }
    },
    copyReply: (n) => {
      const text = lastAssistantText(chatStore.turns, n)
      if (!text) return '没有可复制的回复'
      copyToClipboard(text, (s) => tui.terminal.write(s))
      return `已复制第 ${n} 近回复（${text.length} 字符）`
    },
    quitApp: quitApp,
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

  // 鼠标点击 tab 切换（与键盘 1-4 / Alt+数字 同一条 applyTab 路径）
  tabStrip.onTabClick = (id) => {
    model.switchTab(id)
    applyTab()
  }

  // 滚动到顶自动加载更早历史（1s 轮询；chat tab 激活时）+ 交互状态同步（overlay 无事件钩子，轮询兜底）
  const topTimer = setInterval(() => {
    syncInteraction()
    if (model.active === 'chat' && chatTab.atTop) void chatTab.loadOlder()
  }, 1000)

  function syncInteraction(): void {
    const wasStreaming = chatStore.streaming
    interaction.update({ overlayOpen: tui.hasOverlay(), streaming: chatStore.streaming })
    setStatus({ busy: interaction.is('busy'), queued: chatStore.queuedCount, stashed: chatTab.stashCount })
    // 回合边界：⏱ 计时 + 完成响铃（MAFW_TUI_BELL=0 可关）
    if (chatStore.streaming && promptStart === null) promptStart = Date.now()
    if (!chatStore.streaming && promptStart !== null) {
      lastPromptMs = Date.now() - promptStart
      promptStart = null
      if (process.env.MAFW_TUI_BELL !== '0') tui.terminal.write('\x07')
    }
    void wasStreaming
  }

  function quitApp(): void {
    clearInterval(topTimer)
    goalsStore.stop()
    triageStore.stop()
    tui.stop()
    process.exit(0)
  }

  // ── 声明式键位派发（keymap.ts 单表；动作在此注入实现）──
  const keyCtx: KeyDispatchContext = {
    model,
    interaction,
    actions: {
      quit: quitApp,
      switchTab: (id) => { model.switchTab(id); applyTab() },
      toggleHelp: () => toggleHelp(),
      abortTurn: () => { void chatStore.abort() },
      openExternalEditor: () => { void openInExternalEditor() },
      blurMemorySearch: () => memoryTab.blurSearch(),
      openTranscriptSearch: () => openTranscriptSearch(),
    },
    queries: {
      activeTab: () => model.active,
      editing: () => model.editing,
      overlayOpen: () => tui.hasOverlay(),
      streaming: () => chatStore.streaming,
      memoryInputFocused: () => memoryTab.inputFocused,
    },
  }

  tui.addInputListener((data) => {
    if (dispatchKey(data, keyCtx)) return { consume: true }
    // 非 chat tab 的 tab 级按键（上下/Enter/x/u/i）
    if (!model.editing && !tui.hasOverlay() && model.active !== 'chat') {
      const tab = currentBody as { handleTabKey?: (d: string) => boolean }
      if (typeof tab.handleTabKey === 'function' && tab.handleTabKey(data)) return { consume: true }
    }
    return undefined
  })

  // 初始焦点：启动即 applyTab（聚焦 chat 编辑器链）。
  // pi-tui 无自动聚焦——focusedComponent 初始为 null，按键会无处去（"tui 没法输入"根因之一）。
  applyTab()

  tui.start()
}
