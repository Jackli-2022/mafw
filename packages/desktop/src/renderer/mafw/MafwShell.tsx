// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup, untrack, Show, For } from "solid-js"
import { createStore, reconcile } from "solid-js/store"


import { Icon } from "@mafw/ui/icon"
import { ResizeHandle } from "@mafw/ui/resize-handle"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { ToastV2, showToastV2 } from "@mafw/ui/v2/toast-v2"
import { DataProvider } from "@mafw/session-ui/context"
import { DialogProvider } from "@mafw/ui/context/dialog"
import { MarkedProvider } from "@mafw/ui/context/marked"
import { FileComponentProvider } from "@mafw/ui/context/file"
import { FileSSR } from "@mafw/session-ui/file-ssr"
import { IconRail } from "./components/IconRail"
import { LeftDock } from "./components/LeftDock"
import { clampLeftDockWidth, resolveLeftDockWidth, resolveMode, restoreLeftDockOpen, shouldCloseOnSelect, toggleFace, type LeftDockFace } from "./left-dock"
import { SessionStrip } from "./components/SessionStrip"
import { sessionStore } from "./session-store"
import { agentKey, isAgentKey, resolveSessionAgent } from "./agent-identity"
import { mergeHiddenTodos } from "./todo-presenter"
  import { traceEvent } from "./event-trace"
import { dispatchShellEvent, type ShellEventDeps } from "./sse/dispatcher"
import { bumpGoalsRev } from "./goals-rev"
import { ingestSubagentEvent, onSubagentTerminal, subagentRows } from "./subagent-store"
import { backgroundRows, ingestBackgroundEvent, ingestHydratedBackgroundEvents, onBackgroundTerminal } from "./background-store"
import { backgroundRestAvailable, resetBackgroundCapability } from "./background-capability"
import { normalizeToolPart } from "./tool-part"
import { scanHistoryForBackground } from "./background-detect"
import { reconcileBackgroundOnce } from "./background-reconcile"
import { buildBackgroundNotice } from "./background-notify"
import { childrenNeedingProbe, isTrackedChildSession } from "./subagent-tracker"
import { reconcileSubagentsOnce } from "./subagent-reconcile"
import { buildTerminalNotice, createNotifyGate, shouldNotifyIdle } from "./subagent-notify"
import { mapAskCard as mapAskCardPure } from "./sse/handlers/flow-cards"
import { EventInspector } from "./components/EventInspector"
import { conn, useConnPhase } from "./connection-state"
import { ConnBanner } from "./components/ConnBanner"
import { ChatPane, mergeLocalParts, type FlowCardRecord } from "./components/ChatPane"
import { TaskList } from "./components/TaskList"
import { WorkbenchShell } from "./components/WorkbenchShell"
import { ExecutionView } from "./components/ExecutionView"
import { readSavedTheme, nextTheme, applyTheme } from "./theme"
import { createPresence, SURFACE_MS } from "./components/presence"
import { taskRows, fetchTasks, ingestTask } from "./task-store"
import { fetchQueue, ingestQueueEvent } from "./queue-store"
import { setRun } from "./run-store"
import { requestOpenEditor } from "./editor-open"
import { ChangesDock } from "./components/ChangesDock"
import { addPending } from "./annotation-store"
import { getSessionTurnDiffs } from "./session-turn-diffs"
import { UsageDock } from "./components/UsageDock"
import { defaultDockOpen } from "./workbench-defaults"
import {
  workbenchStateFromStorage,
  type ExecutionSection,
  type WorkbenchSurface,
  type WorkbenchView,
} from "./workbench-views"
import { CHAT_PX_CEIL, CHAT_PX_FLOOR, WORKBENCH_DEFAULT_DETENT, WORKBENCH_MIN_WIDTH, chatPxForDetent, snapDetent, type WorkbenchDetent } from "./workbench-detents"
import { migrateDockKeys, workbenchColumns, workbenchShellHidden, formatResizePreview } from "./workbench-layout"
import { resolveWorkbenchRoot } from "./workbench-root"
import { PopoverShell } from "./components/pickers/PopoverShell"
import { type NavTab } from "./components/nav-tab"
import { WindowControls } from "./components/WindowControls"
import { registerMafwToolCards } from "./components/tool-cards"
import { registerUserPluginCards } from "./components/UserPluginCards"
import { registerThinkingBlock } from "./components/ThinkingBlock"
import { WelcomeHome } from "./components/WelcomeHome"
import { DashboardPage } from "./pages/Dashboard"
import { parseDeepLink } from "./deep-link"
import { ConfirmOverlay } from "./components/ConfirmOverlay"
import { CommandPalette, type PaletteItem } from "./components/CommandPalette"
import { nextMode as nextPermissionMode } from "./components/permission-card-mapping"
import { findPendingToolPart } from "./components/flow-card-placement"
import { saveLayout, loadLayout, pruneMissing } from "./layout-persist"
import { buildSessionMarkdown } from "./export-markdown"
import { MemoryPage } from "./pages/Memory"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { TriagePage } from "./pages/TriagePage"
import { AutomationsPage } from "./pages/Automations"
import { ConfigPage, isNavKey, type NavKey } from "./pages/Config"
import { QuestionWidget, type QuestionData } from "./components/QuestionWidget"
import type { AskCardData } from "./components/AskCard"
import type { PermissionCardData } from "./components/PermissionCard"
import { mapPermissionCard as mapPermissionCardPure } from "./components/permission-card-mapping"
import type { ModelEntry } from "./components/pickers/ModelPicker"
import { messageModel } from "./message-model"
import { workspace, type ChatSession } from "./workspace/session-workspace"
import { countUserTurns, shouldKeepPaging } from "./components/history-paging"

type ModelSel = { providerID: string; modelID: string; label: string }
import type { AgentEntry } from "./components/pickers/AgentPicker"
import "./mafw.css"

export function MafwShell() {
  const [activeTab, setActiveTab] = createSignal<NavTab>("chat")
  const [showConfig, setShowConfig] = createSignal(false)
  const [configSection, setConfigSection] = createSignal<NavKey | undefined>(undefined)
  const [gwStatus, setGwStatus] = createSignal<{ state: string; port: number | null } | null>(null)
  const [theme, setTheme] = createSignal<string | null>(null)

  // Model selection is per-session: user picks live in modelPicks (in-memory),
  // resolution order in sessionModel() below is pick → session history → recent default.
  const [modelPicks, setModelPicks] = createSignal<Record<string, ModelSel>>({})
  const [defaultModel, setDefaultModel] = createSignal<ModelSel | null>(null)

  // Reactive data store for SessionTurn (SolidJS store Proxy for fine-grained tracking)
  // 会话工作区状态收敛为模块单例（workspace/session-workspace.ts）；
  // 以下别名为同一 signal/store 对象，全部调用点保持原语法零改动。
  const store = workspace.store
  const setStore = workspace.setStore

  // Question widget state
  const [activeQuestion, setActiveQuestion] = createSignal<QuestionData | null>(null)

  // Chat sessions (tabs)
  const sessions = workspace.sessions
  const setSessions = workspace.setSessions
  const activeSessionId = workspace.activeId
  const setActiveSessionId = workspace.setActiveId
  // Session list refresh: shared sessionStore.invalidate() (see SSE onopen and
  // session create/close flows). The old sessionRefreshKey signal is removed.

  // Subagent navigation: childID → parentID. Entering a subagent session only
  // switches the content pane (no tab change); this map powers the back button.
  const [subagentStack, setSubagentStack] = createStore<Record<string, string>>({})

  // Open a subagent session inside the current tab (no tab-list mutation, no
  // view/tab highlight change). Loads its data into the store so the pane
  // renders history; readOnly follows from store.session[child].parentID.
  const openSubagentSession = async (childID: string) => {
    setShowConfig(false)
    setActiveTab("chat")
    setShowWelcome(false)
    const parentID = activeSessionId()
    try {
      const s = await window.api.mafw.sessions.get(childID)
      if (s?.parentID) setSubagentStack(childID, s.parentID)
      else if (parentID) setSubagentStack(childID, parentID)
      if (s) {
        setStore(prev => ({
          ...prev,
          session: prev.session.some(x => x.id === childID)
            ? prev.session.map(x => x.id === childID ? { ...x, title: s.title || x.title, parentID: s.parentID } : x)
            : [...prev.session, { ...s, directory: s.directory || ".", projectID: s.projectID || "." }],
          session_status: { ...prev.session_status, [childID]: { type: "idle" } },
          message: prev.message[childID] ? prev.message : { ...prev.message, [childID]: [] },
        }))
      }
    } catch (e) { console.warn("[mafw] open subagent failed:", e) }
    setActiveSessionId(childID)
  }

  // Return from a subagent session to its parent (content pane only).
  const backToParent = (childID: string) => {
    const parentID = subagentStack[childID] || store.session.find((s: any) => s.id === childID)?.parentID
    if (parentID) {
      setSubagentStack(childID, undefined as any)
      setActiveSessionId(parentID)
    }
  }

  // Startup welcome pane ("今天要做什么？"): shown on launch until the user
  // picks a session, creates one, or navigates into the chat.
  const [showWelcome, setShowWelcome] = createSignal(true)

  // All project sessions. Served by the shared session store
  // (cached, invalidated on SSE reconnect / mutations).
  const [historySessions, setHistorySessions] = createSignal<{ id: string; title?: string; agent?: string; time?: { updated?: number }; metadata?: { mafw?: { role?: string } } }[]>([])
  createEffect(() => {
    const pd = currentProject()
    if (gwStatus()?.state !== "ready") return
    setHistorySessions(sessionStore.sessionsFor(pd) as any)
  })

  // Registered projects + current selection (welcome pane project switcher).
  const [projects, setProjects] = createSignal<{ id: string; worktree: string }[]>([])
  const [currentProject, setCurrentProject] = createSignal<string | null>(null)
  // Bumped by gateway project_registered broadcasts so once-only project
  // fetches (here + Rail) refetch when a new project registers.
  const [projectsRev, setProjectsRev] = createSignal(0)

  // Authoritative per-project manager session (from the gateway DB kv store).
  // Orphan/stale role=manager sessions from the pre-fix era are ignored.
  const [managerSessionId, setManagerSessionId] = createSignal<string | null>(null)
  // Re-fetchable: the kv entry is invalidated by the gateway on runtime
  // switch (session ids belong to the active runtime's storage), so the SSE
  // runtime_switched handler re-runs this to drop the stale id immediately.
  // Monotonic token: latest call wins (rapid project switches / SSE refetch
  // must not be overwritten by an older in-flight response).
  let managerSessionFetchId = 0
  const reloadManagerSession = (pd: string): void => {
    if (!pd) { setManagerSessionId(null); return }
    const fetchId = ++managerSessionFetchId
    window.api.mafw.manager.session(pd).then((info: any) => {
      if (fetchId === managerSessionFetchId) setManagerSessionId(info?.sessionId || null)
    }).catch(() => { if (fetchId === managerSessionFetchId) setManagerSessionId(null) })
  }
  createEffect(() => {
    const pd = currentProject()
    if (!pd) { setManagerSessionId(null); return }
    reloadManagerSession(pd)
  })
  createEffect(() => {
    if (gwStatus()?.state !== "ready") return
    projectsRev() // gateway announces project_registered → refetch the list
    let cancelled = false
    const load = async () => {
      try {
        const [list, cur] = await Promise.all([
          window.api.mafw.projects.list().catch(() => []),
          window.api.mafw.projects.current().catch(() => null),
        ])
        if (cancelled) return
        setProjects(Array.isArray(list) ? list.map((p: any) => ({ id: p.id || p.worktree, worktree: p.worktree || p.id })) : [])
        setCurrentProject(cur?.worktree ?? cur?.id ?? null)
      } catch { /* gateway not ready */ }
    }
    void load()
    onCleanup(() => { cancelled = true })
  })

  // Switch the current project: gateway register + refresh sessions for it.
  const handleSelectProject = async (worktree: string) => {
    setCurrentProject(worktree)
    try {
      await window.api.mafw.projects.setCurrent(worktree)
    } catch (e) { console.warn("[mafw] setCurrent failed:", e) }
    const list = await window.api.mafw.sessions.list(worktree).catch(() => [])
    setHistorySessions(Array.isArray(list) ? list : [])
  }

  // Open a session as a tab (single pane; v6 removed the split-view model).
  // Welcome-page entries (manager / new session / recent session) go through here.
  const openSessionTab = (sid: string, title?: string, manager?: boolean, metadata?: any) => {
    setShowConfig(false)
    setActiveTab("chat")
    setShowWelcome(false)
    if (!sessions().some(s => s.id === sid)) {
      const tabTitle = title || `Chat ${sessions().length + 1}`
      setSessions(prev => [...prev, { id: sid, title: tabTitle, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false, manager, metadata }])
      setStore(prev => ({
        ...prev,
        session: [...prev.session, { id: sid, title: tabTitle, directory: ".", time: { created: Date.now() }, projectID: "." }],
        session_status: { ...prev.session_status, [sid]: { type: "idle" } },
        message: { ...prev.message, [sid]: [] },
      }))
    }
    setActiveSessionId(sid)
    setActiveViewId(sid)
    syncPermissionMode(sid) // 🛡 徽标初始态（kv 真相源拉取）
    closeLeftDockIfOverlay()
  }

  // Single resolution path for the manager session: authoritative gateway DB
  // id first, role fallback only when the authoritative id is missing.
  const resolveManager = () => {
    const authId = managerSessionId()
    return (authId && historySessions().find(s => s.id === authId))
      || historySessions().find((s: any) => s?.metadata?.mafw?.role === "manager")
  }

  const handleOpenManager = async (): Promise<boolean> => {
    const manager = resolveManager()
    if (!manager) {
      setActiveTab("goals")
      return false
    }
    openSessionTab(manager.id, manager.title || "Manager", true, manager.metadata)
    return true
  }
  // "新建 Goal": jump to the manager session and send a create-goal message.
  // planReview (default on) asks the manager to pause after planning and
  // confirm the approach via mafw_ask_user before executing (Cowork-style
  // review-then-run); the question surfaces in the QuestionWidget overlay.
  const handleNewGoal = async (description: string, opts?: { planReview?: boolean }): Promise<boolean> => {
    if (!await handleOpenManager()) return false
    const manager = resolveManager()
    if (!manager) return false
    const planReview = opts?.planReview !== false
    const message = planReview
      ? `创建新 Goal：${description}\n\n（流程要求：完成规划（PLANNING_COMPLETE）后，先用 mafw_ask_user 工具把方案要点（目标、步骤、风险）发给我确认，得到我的确认答复后再开始执行。）`
      : `创建新 Goal：${description}`
    // Optimistic insert (matches sendMessage's store pattern).
    const userMsgId = `user-${Date.now()}`
    const ts = Date.now()
    setSessions(prev => prev.map(s => s.id === manager.id ? { ...s, userMsgId } : s))
    setStore(prev => {
      const msgs = { ...prev.message }
      const sessionMsgs = [...(msgs[manager.id] || [])]
      sessionMsgs.push({ id: userMsgId, sessionID: manager.id, role: "user", parentID: null, time: { created: Date.now() }, text: message, agent: "general", model: { providerID: "opencode", modelID: "" } })
      msgs[manager.id] = sessionMsgs
      return { ...prev, message: msgs, part: { ...prev.part, [userMsgId]: [{ type: "text", text: message, id: `${userMsgId}-text`, sessionID: manager.id, messageID: userMsgId }] } }
    })
    try {
      await window.api.mafw.chat.sendEnriched({ message, sessionID: manager.id })
      return true
    } catch (e) {
      console.warn("[mafw] send goal message failed:", e)
      return true
    }
  }

  // "新话题": rotate the manager session (old one sinks into history).
  const handleNewTopic = async (): Promise<void> => {
    const pd = currentProject()
    if (!pd) return
    setConfirmReq({
      title: "开新话题？",
      message: "当前 manager 会话将归档为历史会话，新会话成为活跃 manager。",
      confirmLabel: "开新话题",
      onConfirm: () => void doRotateTopic(pd),
    })
  }

  const doRotateTopic = async (pd: string): Promise<void> => {
    try {
      const res = await window.api.mafw.manager.rotate(pd)
      setManagerSessionId(res.sessionId)
      const list = await window.api.mafw.sessions.list(pd).catch(() => [])
      setHistorySessions(Array.isArray(list) ? list : [])
      showToastV2({ description: "已开启新话题", duration: 3000 })
    } catch (e: any) {
      showToastV2({ description: `新话题开启失败: ${e?.message || e}`, duration: 4000 })
    }
  }

  // Lazy-load pagination state per session (older messages via `before` cursor)
  const [pageState, setPageState] = createStore<Record<string, { cursor: string | null; hasMore: boolean; loading: boolean }>>({})

  // Todo list per session (drives the TaskList; updated live via SSE todo.updated)
  const [todos, setTodos] = createStore<Record<string, any[]>>({})
  // 整表重写时被"藏掉"的未完成项（只做提示，不改模型当前列表）
  const [hiddenTodos, setHiddenTodos] = createStore<Record<string, any[]>>({})
  const applyTodos = (sid: string, list: any[]) => {
    const next = Array.isArray(list) ? list : []
    const prev = todos[sid] || []
    setTodos(sid, next)
    setHiddenTodos(sid, mergeHiddenTodos(hiddenTodos[sid] || [], prev, next))
  }
  const clearHiddenTodos = (sid: string) => setHiddenTodos(sid, [])

  // Scroll anchors / sending-reset per session, keyed by sid. Used by
  // loadHistory to scroll the pane showing a session, and by the SSE lifecycle
  // to clear a pane's "stop" button state.
  // 回调注册表收敛于 workspace（Record 形态保留，兼容 registry[sid]?.() 调用点）
  const anchorRegistry = workspace.records.anchor
  const sendingResetters = workspace.records.sendingReset
  const queueFlushers = workspace.records.queueFlush

  // OS notification only when the window is hidden (tray/minimized); the
  // in-app toasts remain the primary feedback while the window is visible.
  const notifyIfHidden = (title: string, body: string) => {
    if (!document.hidden) return
    void window.api.mafw.notify?.({ title, body }).catch(() => { /* fail-open */ })
  }
  const lastIdleNotify: Record<string, number> = {}

  // Per-session approval mode (Manual/Auto-lite)。真相源在 gateway（kv perm-mode，
  // 25 次预算 + 危险正则判定）；desktop 只缓存 UI 态：开 tab 拉取 + SSE
  // permission_mode 事件驱动 + toggle 乐观更新失败回滚。
  const [permissionModes, setPermissionModes] = createStore<Record<string, "read-only" | "auto" | "full-access">>({})
  const syncPermissionMode = (sid: string) => {
    void window.api.mafw.permissions.getMode(sid)
      .then((m: any) => { if (m?.mode === "manual" || m?.mode === "auto") setPermissionModes(sid, m.mode) })
      .catch(() => {})
  }

  // Shared destructive confirmation request (ConfirmOverlay) — replaces the
  // blocking window.confirm for in-shell actions.
  const [confirmReq, setConfirmReq] = createSignal<{ title: string; message?: string; confirmLabel?: string; onConfirm: () => void } | null>(null)

  // Global command palette (Ctrl+P).
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const paletteItems = (): PaletteItem[] => {
    const nav = (id: NavTab, label: string, hint: string): PaletteItem => ({
      id: `tab-${id}`, label, hint, group: "导航",
      run: () => { setShowConfig(false); setShowWelcome(false); setActiveTab(id) },
    })
    return [
      nav("chat", "聊天", "Chat"),
      nav("goals", "Goals", "编排总览"),
      nav("memory", "记忆", "Memory"),
      nav("approvals", "审批", "Approvals"),
      nav("triage", "分诊", "Triage"),
      nav("automation", "自动化", "Automations"),
      {
        id: "new-session", label: "新建会话", hint: "New session", group: "会话",
        run: () => { setShowConfig(false); void createSession().then(sid => { if (sid) openSessionTab(sid) }) },
      },
      {
        id: "new-window", label: "新建窗口", hint: "New window", group: "会话",
        run: () => { void window.api.mafw.windows.create().catch(e => showToastV2({ description: `新建窗口失败: ${e?.message || e}`, duration: 3000 })) },
      },
      {
        id: "export-session", label: "导出当前会话为 Markdown", hint: "Export", group: "会话",
        run: () => { const sid = activeSessionId(); if (sid) void exportSession(sid) },
      },
      {
        id: "open-settings", label: "打开设置", hint: "Settings", group: "导航",
        run: () => setShowConfig(true),
      },
      {
        id: "toggle-rightdock", label: "切换右侧面板", hint: "RightDock (Ctrl+T)", group: "导航",
        run: () => applyRightDock(!rightDockOpen()),
      },
      {
        id: "toggle-theme", label: "切换主题", hint: "Theme", group: "导航",
        run: () => toggleTheme(),
      },
    ]
  }

  // Export a session to Markdown via the OS save dialog (main process).
  const exportSession = async (sid: string) => {
    const msgs = store.message[sid] || []
    const turns = msgs.map((m: any) => ({
      role: m.role || "user",
      text: [m.text, ...(store.part[m.id] || []).map((p: any) => (typeof p.text === "string" ? p.text : ""))].join(" "),
      time: m.time?.created,
    }))
    const title = sessions().find(s => s.id === sid)?.title || sid
    const markdown = buildSessionMarkdown({ title, turns })
    try {
      const res = await window.api.mafw.exportSession({ filename: title, markdown })
      if (res?.ok) showToastV2({ description: `已导出到 ${res.path}`, duration: 4000 })
      else if (res?.canceled) { /* user canceled */ }
      else showToastV2({ description: `导出失败: ${res?.error || "unknown"}`, duration: 3000 })
    } catch (e: any) {
      showToastV2({ description: `导出失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  // Deep link routing (mafw://session/<id>, mafw://tab/<name>) — main
  // registers the protocol and forwards URLs here.
  onMount(() => {
    const off = (window.api as any).onDeepLink?.((urls: string[]) => {
      for (const u of urls || []) {
        const link = parseDeepLink(u)
        if (!link) continue
        if (link.kind === "session") {
          setShowConfig(false)
          setActiveTab("chat")
          setShowWelcome(false)
          openSessionTab(link.id)
        } else if (link.kind === "tab") {
          setShowConfig(false)
          setShowWelcome(false)
          setActiveTab(link.id as any)
        }
      }
    })
    if (typeof off === "function") onCleanup(() => off())
  })

  // Quick entry (global Ctrl+Shift+M): main shows+focuses the window and
  // pings us — jump to the chat tab and focus the composer.
  onMount(() => {
    const off = (window.api as any).onQuickEntry?.(() => {
      setShowConfig(false)
      setShowWelcome(false)
      setActiveTab("chat")
      queueMicrotask(() => {
        const ta = document.querySelector(".mafw-input") as HTMLTextAreaElement | null
        ta?.focus()
      })
    })
    if (typeof off === "function") onCleanup(() => off())
  })

  // Compaction boundary marks per session (session.compacted SSE events) —
  // rendered by ChatPane as a divider above the surviving context.
  const [compactionMarks, setCompactionMarks] = createSignal<Record<string, { at: number; summary?: string }>>({})
  const phaseUpdaters = workspace.records.phase
  // mafw_media_speak 工具事件 → 对应会话 ChatPane 的流式播放回调
  const mediaSpeakHandlers = workspace.records.mediaSpeak

  const [activeViewId, setActiveViewId] = createSignal<string | null>(null)


  // ── Layout persistence: session tabs + active view survive restarts ──
  const layoutIO = { getItem: (k: string) => localStorage.getItem(k), setItem: (k: string, v: string) => localStorage.setItem(k, v), removeItem: (k: string) => localStorage.removeItem(k) }
  let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    sessions()
    activeViewId()
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer)
    layoutSaveTimer = setTimeout(() => {
      saveLayout(layoutIO, {
        tabs: sessions().map(s => ({ id: s.id, title: s.title })),
        activeViewId: activeViewId(),
      })
    }, 500)
  })

  // Restore once the history list is loaded (prune tabs whose sessions died).
  const [layoutRestored, setLayoutRestored] = createSignal(false)
  createEffect(() => {
    if (layoutRestored()) return
    if (gwStatus()?.state !== "ready") return
    const hist = historySessions()
    if (!hist || hist.length === 0) return
    setLayoutRestored(true)
    const snap = loadLayout(layoutIO)
    if (!snap) return
    const existing = new Set(hist.map(s => s.id))
    const pruned = pruneMissing(snap, existing)
    if (!pruned) return
    for (const t of pruned.tabs) openSessionTab(t.id, t.title)
    if (pruned.activeViewId) {
      setShowWelcome(false)
      setActiveSessionId(pruned.activeViewId)
      setActiveViewId(pruned.activeViewId)
    }
    console.log("[mafw] layout restored:", pruned.tabs.length, "tabs")
  })



  // AskCard / PermissionCard per session (in-chat flow cards)
  const [flowCards, setFlowCards] = createSignal<Record<string, FlowCardRecord[]>>({})

  const upsertCard = (sid: string, rec: FlowCardRecord) => {
    // permission.asked 的 properties.tool 是可选字段（pi runtime 恒缺）——缺链接的
    // 卡永远内联不了，堆在回合底部。反查 store 中 pending 的同名 ToolPart 恢复
    // 锚点；store reactive，晚到的 part 也会随下一次 upsert/reconcile 自动补上。
    if (rec.kind === "permission" && !(rec.data.messageID && rec.data.callID) && rec.data.status === "pending") {
      const msgs = store.message[sid] || []
      const assistantIds = msgs.filter((m: any) => m.role === "assistant").map((m: any) => m.id)
      const usedCallIDs = (flowCards()[sid] || [])
        .filter((c) => c.kind === "permission" && c.data.callID)
        .map((c) => c.data.callID as string)
      const link = findPendingToolPart(
        String(rec.data.toolName || ""),
        (mid) => (store.part[mid] as any[]) || [],
        assistantIds,
        usedCallIDs,
      )
      if (link) rec = { ...rec, data: { ...rec.data, ...link } }
    }
    setFlowCards(prev => {
      const list = prev[sid] || []
      const existing = list.find(c => c.data.id === rec.data.id)
      if (existing) {
        return { ...prev, [sid]: list.map(c => (c.data.id === rec.data.id ? rec : c)) }
      }
      return { ...prev, [sid]: [...list, rec] }
    })
  }

  const resolveCard = (sid: string, id: string, patch: Partial<AskCardData> & Partial<PermissionCardData>) => {
    setFlowCards(prev => {
      const list = (prev[sid] || []).map(c => (c.data.id === id ? { ...c, data: { ...c.data, ...patch } } : c))
      return { ...prev, [sid]: list }
    })
  }

  const expireSessionCards = (sid: string) => {
    setFlowCards(prev => {
      const list = (prev[sid] || []).map(c => {
        if (c.data.status !== "pending") return c
        return { ...c, data: { ...c.data, status: "expired" } }
      })
      return { ...prev, [sid]: list }
    })
  }

  // mapAskCard/mapPermissionCard 均为纯函数模块（sse/handlers/flow-cards.ts、
  // components/permission-card-mapping.ts），agentTitle 经参数注入。
  const agentTitleOf = (sid: string) => sessions().find(s => s.id === sid)?.title || "Agent"

  const mapAskCard = (req: any, createdAt: number): AskCardData =>
    mapAskCardPure(req, createdAt, agentTitleOf(req.sessionID))

  const mapPermissionCard = (req: any, createdAt: number): PermissionCardData =>
    mapPermissionCardPure(req, createdAt, agentTitleOf(req.sessionID))

  // Reconcile flow cards against server truth. Pending cards the server no
  // longer knows about were resolved elsewhere (approval-bridge timeout,
  // session end) while an SSE gap swallowed the reply event — without this,
  // ghost pending cards inflate the approvals badge forever.
  // 2.1 forms are location-scoped. Use the active session's directory so
  // questions created in C:/work are not hidden behind the default location.
  const questionsDirectory = () => {
    const sid = activeSessionId()
    const dir = store.session.find((s: any) => s.id === sid)?.directory
    return dir && dir !== "." ? dir : (currentProject() || undefined)
  }

  const reconcileFlowCards = () => {
    void fetchTasks()
    const activeSid = activeSessionId()
    if (activeSid) void fetchQueue(activeSid)
    // 顺带补拉各会话审批模式（覆盖非 tab 打开路径，如全局 Approvals 页；60s 对账周期）
    for (const sid of Object.keys(flowCards())) syncPermissionMode(sid)
    window.api.mafw.permissions.list().then((items: any[]) => {
      const live = new Set<string>((items || []).map((r: any) => String(r.id)))
      for (const req of items || []) upsertCard(req.sessionID, { kind: "permission", data: mapPermissionCard(req, Date.now()) })
      setFlowCards(prev => {
        let changed = false
        const next: Record<string, FlowCardRecord[]> = {}
        for (const [sid, list] of Object.entries(prev)) {
          next[sid] = list.map(c => {
            if (c.kind === "permission" && c.data.status === "pending" && !live.has(String(c.data.id))) {
              changed = true
              return { ...c, data: { ...c.data, status: "expired" } }
            }
            return c
          })
        }
        return changed ? next : prev
      })
    }).catch(e => console.warn("[mafw] permissions reconcile:", e))
    window.api.mafw.questions.list(questionsDirectory()).then((items: any[]) => {
      const live = new Set<string>((items || []).map((r: any) => String(r.id)))
      for (const req of items || []) upsertCard(req.sessionID, { kind: "ask", data: mapAskCard(req, Date.now()) })
      setFlowCards(prev => {
        let changed = false
        const next: Record<string, FlowCardRecord[]> = {}
        for (const [sid, list] of Object.entries(prev)) {
          next[sid] = list.map(c => {
            if (c.kind === "ask" && c.data.status === "pending" && !live.has(String(c.data.id))) {
              changed = true
              return { ...c, data: { ...c.data, status: "expired" } }
            }
            return c
          })
        }
        return changed ? next : prev
      })
    }).catch(e => console.warn("[mafw] questions reconcile:", e))
  }

  // ── Subagent reconcile（spec §4.1/§4.6）：编排在 subagent-reconcile.ts（可测），
  // 这里只注入真实 fetchers。children 快照补历史行 + running 行探针收敛漏终态。fail-open。
  async function reconcileSubagents(): Promise<void> {
    await reconcileSubagentsOnce({
      activeSessionId: activeSessionId(),
      runningChildIDs: childrenNeedingProbe(subagentRows()),
      fetchers: {
        children: (parentID) => window.api.mafw.sessions.children(parentID),
        messages: (childID, limit) => window.api.mafw.sessions.messages(childID, limit),
        getSession: (childID) => window.api.mafw.sessions.get(childID),
      },
      ingest: (ev) => ingestSubagentEvent(ev),
    })
  }

  // ── Background reconcile（spec §5）：REST 三件是可选能力（Gate Ruling A）——
  // /api/shell 经 gateway 反代，401/不可达时整轮 fail-open（不建假行、不误杀）。
  // location-scoped：探针带当前会话 directory，只收敛该会话的行（reviewer Important 5）。
  async function reconcileBackground(): Promise<void> {
    const sid = activeSessionId()
    const directory = store.session.find((s: any) => s.id === sid)?.directory
    await reconcileBackgroundOnce({
      fetchers: {
        listShells: (dir) => window.api.mafw.shells.list(dir),
        getShell: (id, dir) => window.api.mafw.shells.get(id, dir),
      },
      directory,
      trackedRunningShellIds: () => backgroundRows()
        .filter(r => r.type === "shell" && r.status === "running" && r.sessionID === sid)
        .map(r => r.id),
      ingest: (ev) => ingestBackgroundEvent(ev),
    })
  }

  // ── Flow card actions ──

  const askSubmit = async (card: AskCardData, answers: Record<string, string[]>, customText: Record<string, string>) => {
    const ordered: string[][] = card.questions.map(q => answers[q.id] || [])
    try {
      await window.api.mafw.questions.reply(card.id, ordered)
      resolveCard(card.sessionID, card.id, { status: "answered", answers, customText })
    } catch (e) {
      console.warn("[mafw] question reply failed:", e)
      showToastV2({ description: "提交失败", duration: 2000 })
    }
  }

  const askCancel = async (card: AskCardData) => {
    try {
      await window.api.mafw.questions.reject(card.id)
      resolveCard(card.sessionID, card.id, { status: "cancelled" })
    } catch (e) {
      console.warn("[mafw] question reject failed:", e)
      showToastV2({ description: "取消失败", duration: 2000 })
    }
  }

  const permReply = async (card: PermissionCardData, reply: "once" | "always" | "reject", message?: string, persist?: boolean | "tool" | "prefix") => {
    try {
      await window.api.mafw.permissions.reply(card.id, reply, message, persist)
      resolveCard(card.sessionID, card.id, {
        status: reply === "always" ? "allowed-always" : reply === "reject" ? "denied" : "allowed-once",
      })
    } catch (e) {
      console.warn("[mafw] permission reply failed:", e)
      showToastV2({ description: "操作失败", duration: 2000 })
    }
  }

  // Visible cards for a session: permission cards first (serial queue — only the
  // first pending is shown interactively), then ask cards, both in creation order.
  // keyboardOwnerId = the single card allowed to capture global keys (first pending).
  const sessionCards = (sid: string) => {
    const list = flowCards()[sid] || []
    const byTime = (a: FlowCardRecord, b: FlowCardRecord) => a.data.createdAt - b.data.createdAt
    const perms = list.filter(c => c.kind === "permission").sort(byTime) as { kind: "permission"; data: PermissionCardData }[]
    const asks = list.filter(c => c.kind === "ask").sort(byTime) as { kind: "ask"; data: AskCardData }[]
    const pendingPerms = perms.filter(p => p.data.status === "pending")
    const queueLength = Math.max(0, pendingPerms.length - 1)
    const visiblePerms = [
      ...(pendingPerms[0] ? [pendingPerms[0]] : []),
      ...perms.filter(p => p.data.status !== "pending"),
    ]
    const visible = [...visiblePerms, ...asks]
    const firstPending = visible.find(c => c.data.status === "pending")
    return { visible, queueLength, keyboardOwnerId: firstPending?.data.id ?? null }
  }

  const pendingPermissionCount = createMemo(() => {
    let n = 0
    for (const list of Object.values(flowCards())) {
      for (const c of list) if (c.kind === "permission" && c.data.status === "pending") n++
    }
    // Goal-level user questions (QuestionWidget) count toward the approvals
    // badge too — they need an answer just as urgently.
    if (activeQuestion()) n++
    return n
  })

  const pendingPermissionCards = createMemo(() => {
    const out: any[] = []
    for (const list of Object.values(flowCards())) {
      for (const c of list) if (c.kind === "permission" && c.data.status === "pending") out.push(c.data)
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  })

  const sessionPending = (sid: string) => {
    const list = flowCards()[sid] || []
    return list.filter(c => c.data.status === "pending").length
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToastV2({ description: "Copied", duration: 2000 })
    } catch (e) {
      console.warn("[mafw] clipboard failed", e)
    }
  }

  onMount(() => {
    registerMafwToolCards()
    registerUserPluginCards() // 必须在 registerMafwToolCards 之后（捕获 original）
    registerThinkingBlock()   // reasoning part → dsh 式可折叠思考块
    // Use the modern session-ui rendering branch (rounded bubbles, v2 tokens).
    document.body.setAttribute("data-new-layout", "")
  })

  // Listen for UsageDock "go to Config > Usage" link. ConfigPage also listens
  // for this event to switch sections while already mounted; MafwShell only
  // opens the page and records the initial section for the closed→open flow.
  onMount(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail
      setConfigSection(isNavKey(section) ? section : undefined)
      setShowConfig(true)
    }
    window.addEventListener('mafw:open-config', handler)
    onCleanup(() => window.removeEventListener('mafw:open-config', handler))
  })

  // Reset configSection when config page closes to prevent stale section leaking
  // to other entry points (Rail settings / nav, etc.).
  createEffect(() => {
    if (!showConfig()) setConfigSection(undefined)
  })

  // Theme: 逻辑在 ./theme.ts（与 preload 同源的 mafw-theme 键契约见其文件头注释）。
  onMount(() => {
    const root = document.documentElement
    const saved = readSavedTheme(localStorage)
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    applyTheme(root, saved, mq.matches)
    if (saved) setTheme(saved)
    else {
      const onMq = () => {
        const cur = readSavedTheme(localStorage)
        if (cur) return
        root.dataset.colorScheme = mq.matches ? 'light' : 'dark'
      }
      mq.addEventListener('change', onMq)
      onCleanup(() => mq.removeEventListener('change', onMq))
    }
  })
  const toggleTheme = () => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const root = document.documentElement
    const cur = root.dataset.theme === 'light' ? 'light' : root.dataset.theme === 'dark' ? 'dark' : (mq.matches ? 'light' : 'dark')
    const next = nextTheme(cur)
    applyTheme(root, next, mq.matches)
    localStorage.setItem('mafw-theme', next)
    setTheme(next)
  }

  // ── Gateway connection awareness ──
  // SSE (renderer, immediate) + main-process state pushes (process-level) are
  // folded into one phase machine; transitions drive the reconnect/recovery
  // toasts below. Without this, a gateway restart was completely silent.
  // `conn` is the module-level singleton (connection-state.ts); components
  // read the same phase via useConnPhase().
  const connPhase = useConnPhase()
  const connDown = () => connPhase() === "down"
  const [showInspector, setShowInspector] = createSignal(false)
  // worktree 并行隔离（切片 4）：runtime 能力缓存 + 创建入口
  const [rtCaps, setRtCaps] = createSignal<Record<string, boolean>>({})
  const [rtName, setRtName] = createSignal("")
  const loadRuntimeInfo = () => {
    void window.api.mafw.runtime.get().then((r: any) => {
      setRtCaps(r?.active?.capabilities ?? {})
      setRtName(r?.active?.name ?? "")
    }).catch(() => {})
  }
  createEffect(() => {
    if (gwStatus()?.state !== "ready") return
    loadRuntimeInfo()
  })
  const worktreeEnabled = () => rtCaps().worktreeApi === true
  const revertUndoEnabled = () => rtCaps().revertUndoApi === true
  const createWorktreeSession = () => {
    const dir = currentProject()
    if (!dir) { showToastV2({ description: "未选择项目，无法开并行任务", duration: 2500 }); return }
    void window.api.mafw.sessions.create({ directory: dir, worktree: true })
      .then((r: any) => {
        if (r?.id) {
          openSessionTab(r.id)
          showToastV2({ description: `已开并行任务（worktree：${r.worktree?.dir ?? dir}）`, duration: 3500 })
        }
      })
      .catch((e: any) => showToastV2({ description: `创建失败：${String(e?.message ?? e).slice(0, 80)}`, duration: 4000 }))
  }
  let es: EventSource | null = null
  let esRetry: ReturnType<typeof setTimeout> | null = null
  const scheduleEsRetry = (delayMs = 5000) => {
    if (esRetry) return
    esRetry = setTimeout(() => { esRetry = null; void connectSse() }, delayMs)
  }

  onMount(() => {
    const unsubConn = conn.subscribe((ev) => {
      if (ev.phase === "reconnecting" && ev.prev === "connected") {
        showToastV2({ description: "Gateway 连接中断，正在重连…", duration: 3000 })
      } else if (ev.phase === "down") {
        showToastV2({ description: "Gateway 已断开，正在自动重启…", duration: 4000 })
      } else if (ev.phase === "connected" && ev.recovered) {
        showToastV2({ description: "Gateway 已恢复", duration: 2500 })
      }
    })
    onCleanup(unsubConn)
  })

  // SSE 事件副作用经 dispatcher 的 deps 注入（纯路由可单测）；
  // 各分支语义与 onmessage 原实现逐字对应。
  const sseDeps: ShellEventDeps = {
    core: {
      trace: traceEvent,
      notify: notifyIfHidden,
      warn: (m) => console.warn(m),
      setActiveQuestion: (q) => setActiveQuestion(q as QuestionData),
      bumpProjectsRev: () => setProjectsRev(v => v + 1),
      onGoalEvent: () => bumpGoalsRev(),
      onRuntimeSwitched: () => {
        sessionStore.invalidate()
        void refreshMenus()
        resetChatWorkspace()
        resetBackgroundCapability()
        loadRuntimeInfo()
        if (currentProject()) reloadManagerSession(currentProject()!)
      },
    },
    lifecycle: {
      invalidate: () => sessionStore.invalidate(),
      patch: (id, patch) => sessionStore.patch(id, patch),
      retitleOpenTab: (id, title) => {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s))
        setStore(prev => ({ ...prev, session: prev.session.map((x: any) => x.id === id ? { ...x, title } : x) }))
      },
      remove: (id) => sessionStore.remove(id),
      closeIfOpen: (id) => { if (sessions().some(s => s.id === id)) closeSession(id) },
    },
    flowCards: {
      upsertCard,
      resolveCard,
      setPermissionMode: (sid, mode) => setPermissionModes(sid, mode),
      setCompactionMark: (sid, mark) => setCompactionMarks(prev => ({ ...prev, [sid]: mark })),
      notify: notifyIfHidden,
      trace: traceEvent,
      scheduleReconcile: (delayMs) => { setTimeout(() => reconcileFlowCards(), delayMs) },
      agentTitleOf,
      getAskCard: (sid, id) => (flowCards()[sid] || []).find(c => c.kind === "ask" && c.data.id === id)?.data as AskCardData | undefined,
    },
    dock: {
      trace: traceEvent,
      getTrajectoryEvents: (sid) => trajectoryLive()[sid] || [],
      setTrajectoryEvents: (sid, events) => setTrajectoryLive({ ...trajectoryLive(), [sid]: events }),
      setTrajectoryTurn: (sid, turn) => setTrajectoryTurnLive({ ...trajectoryTurnLive(), [sid]: turn }),
      setTodos: (sid, list) => applyTodos(sid, list),
    },
    chat: {
      trace: traceEvent,
      getStore: () => store,
      patchStore: (p) => setStore(prev => ({ ...prev, ...p })),
      setSessionStatus: (sid, s) => setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: s } })),
      markSessionDone: (sid) => setSessions(prev => prev.map(x => x.id === sid ? { ...x, done: true } : x)),
      setUserMsgId: (sid, msgId) => setSessions(prev => prev.map(x => x.id === sid ? { ...x, userMsgId: msgId } : x)),
      parentFallback: (sid) => sessions().find(x => x.id === sid)?.userMsgId || null,
      phase: (sid, p) => phaseUpdaters[sid]?.(p),
      onTurnSettled: (sid, o) => {
        sendingResetters[sid]?.()
        if (o.expireCards) expireSessionCards(sid)
        queueFlushers[sid]?.()
      },
      notifyIdle: (sid) => {
        // 决策抽 shouldNotifyIdle（spec §4.5 rev2：被追踪子会话让位给 subagents 新通道）
        if (!shouldNotifyIdle({
          trackedChild: isTrackedChildSession(subagentRows(), sid),
          hidden: document.hidden,
          lastNotifyAt: lastIdleNotify[sid] || 0,
          now: Date.now(),
        })) return
        lastIdleNotify[sid] = Date.now()
        const title = sessions().find(x => x.id === sid)?.title || "会话"
        notifyIfHidden("MAFW：回合完成", `「${title}」已回复`)
      },
      mediaSpeak: (sid, text, voice) => mediaSpeakHandlers[sid]?.(text, voice),
    },
    diff: {
      trace: traceEvent,
      setSessionDiff: (sid, files) => setStore(prev => ({ ...prev, session_diff: { ...prev.session_diff, [sid]: files } })),
    },
    // 子代理 tracker：既有事件旁路入 store（渲染与通知在后续接线消费）。
    subagents: {
      onEvent: (ev) => ingestSubagentEvent(ev),
    },
    // 后台任务 tracker：既有事件旁路入 store（work bar / dock / 通知消费）。
    background: {
      onEvent: (ev) => ingestBackgroundEvent(ev),
    },
    tasks: {
      onEvent: (task) => ingestTask(task as any),
    },
    queue: {
      onEvent: (sid, event) => ingestQueueEvent(sid, event),
    },
    run: {
      onEvent: (run) => setRun(run as any),
    },
  }

  async function connectSse() {
    if (es) return
    const info = await window.api.mafw.gateway.info()
    if (!info?.url) {
      console.log("[mafw] SSE: no gateway URL yet, will retry")
      scheduleEsRetry()
      return
    }
    console.log("[mafw] SSE connecting to", info.url)
    // URL 契约归 SDK（event.url）；EventSource 传输保持 renderer 直连。
    const source = new EventSource(await window.api.mafw.event.url())
    es = source
    // onopen fires on initial connect AND after every EventSource auto-reconnect:
    // a gateway restart breaks SSE but keeps the same port, so the reconnect is
    // the only reliable signal that in-memory lists (session history) are stale.
    source.onopen = () => {
      console.log("[mafw] SSE connected")
      conn.report("sse-open")
      // Gateway restarts keep the same port; reconnect is the only reliable
      // signal that the cached session list is stale.
      sessionStore.invalidate()
      reconcileFlowCards()
      void reconcileSubagents()
      resetBackgroundCapability()
      void reconcileBackground()
    }
    source.onerror = () => {
      console.log("[mafw] SSE error (will auto-reconnect)")
      conn.report("sse-error")
      if (source.readyState === EventSource.CLOSED) {
        // Fatal close (server gone / non-SSE response): EventSource won't
        // retry on its own — recreate on a short delay.
        es = null
        source.close()
        scheduleEsRetry()
      }
    }
    // Seed flow cards that arrived before the SSE connection (native APIs return pending only).
    window.api.mafw.permissions.list().then((items: any[]) => {
      for (const req of items || []) upsertCard(req.sessionID, { kind: "permission", data: mapPermissionCard(req, Date.now()) })
    }).catch(e => console.warn("[mafw] permissions.list seed:", e))
    window.api.mafw.questions.list(questionsDirectory()).then((items: any[]) => {
      for (const req of items || []) upsertCard(req.sessionID, { kind: "ask", data: mapAskCard(req, Date.now()) })
    }).catch(e => console.warn("[mafw] questions.list seed:", e))
    es.onmessage = (e: MessageEvent) => {
      let raw: any
      try { raw = JSON.parse(e.data) } catch { return }
      // 全部事件经 dispatcher 纯路由分发（sse/dispatcher.ts + sse/handlers/*，
      // 分支语义见各 handler 注释；漏接线检测在 dispatcher 尾部 missTrace）。
      dispatchShellEvent(raw?.data || raw, sseDeps)
    }
  }

  // SSE lifecycle: connect now, close on unmount, reconnect if the gateway
  // only becomes available after this window loaded.
  onMount(() => {
    const reconcileTimer = setInterval(reconcileFlowCards, 60000)
    // 子代理 + 后台任务终态通知（spec §4.5/§6.3）：toast 恒发；OS 通知共享同一个
    // 10s 全局门（两类合计限频，防 #11716 洪泛）
    const bgWorkNotifyGate = createNotifyGate(10_000)
    const offSubagentNotify = onSubagentTerminal((row) => {
      const notice = buildTerminalNotice(row, { hidden: document.hidden })
      if (!notice) return
      showToastV2({ description: notice.toast, duration: 3000 })
      if (notice.os && bgWorkNotifyGate(Date.now())) notifyIfHidden(notice.os.title, notice.os.body)
    })
    // 后台任务终态通知：只发 shell 类——subagent 终态归 P0-1 子代理通道（防双响）
    const offBackgroundNotify = onBackgroundTerminal((row) => {
      if (row.type !== "shell") return
      const notice = buildBackgroundNotice(row, { hidden: document.hidden })
      if (!notice) return
      showToastV2({ description: notice.toast, duration: 3000 })
      if (notice.os && bgWorkNotifyGate(Date.now())) notifyIfHidden(notice.os.title, notice.os.body)
    })
    // 子代理对账轮询（spec §4.6）：有 running 行或面板开着才跑
    const subagentTimer = setInterval(() => {
      if ((workbenchView() === "execution" && executionSection() === "subagents") || subagentRows().some(r => r.status === "running")) void reconcileSubagents()
    }, 15_000)
    // 后台任务对账轮询（spec §5）：后台 tab 开着或 shell 行还在跑才跑；
    // REST 不可达（Gate Ruling A）时跳过，不空转打网关（reviewer Important 6）
    const backgroundTimer = setInterval(() => {
      if (!((workbenchView() === "execution" && executionSection() === "background") || backgroundRows().some(r => r.type === "shell" && r.status === "running"))) return
      void backgroundRestAvailable().then(ok => { if (ok) void reconcileBackground() })
    }, 15_000)
    // Dev 事件检查器开关：Ctrl+Shift+E（SSE trace 浮层，漏接线事件红色高亮）
    const onInspectorKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && ev.shiftKey && (ev.key === "E" || ev.key === "e")) {
        ev.preventDefault()
        setShowInspector(v => !v)
      }
    }
    window.addEventListener("keydown", onInspectorKey)
    onCleanup(() => {
      window.removeEventListener("keydown", onInspectorKey)
      clearInterval(reconcileTimer)
      clearInterval(subagentTimer)
      clearInterval(backgroundTimer)
      offSubagentNotify()
      offBackgroundNotify()
      if (esRetry) { clearTimeout(esRetry); esRetry = null }
      if (es) { console.log("[mafw] SSE closing"); es.close(); es = null }
    })
    void connectSse()
  })

  // Load history when active session changes (skip if already loaded)
  createEffect(() => {
    const sid = activeSessionId()
    if (!sid) return
    if (store.message[sid]?.length > 0) return
    loadSessionHistory(sid)
  })

  // 会话切换即时 bootstrap 子代理/后台任务历史行（fetch 廉价、fail-open）
  createEffect(() => {
    activeSessionId()
    void reconcileSubagents()
    void reconcileBackground()
  })

  // Load session message history from the gateway
  async function loadSessionHistory(sessionID: string) {
    console.log("[mafw] loadSessionHistory", sessionID)
    try {
      const [data, sessionData] = await Promise.all([
        window.api.mafw.sessions.messages(sessionID, 100) as any, // [perf] first paint: newest 100 raw; backfill loop below tops up to ≥10 user turns; scroll-up pages older via pageState.cursor
        window.api.mafw.sessions.get(sessionID).catch(() => null),
      ]) as [any, any]
      // Fetch the todo list for the TaskList (also updated live via SSE)
      window.api.mafw.sessions.todo(sessionID).then((t: any) => {
        const arr = Array.isArray(t) ? t : t?.data
        if (Array.isArray(arr)) applyTodos(sessionID, arr)
      }).catch(() => {})
      const rawItems = Array.isArray(data) ? data : data?.data
      let nextCursor: string | null = data?.nextCursor ?? null
      if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        setPageState(sessionID, { cursor: nextCursor, hasMore: !!nextCursor, loading: false })
        return
      }

      // Merge with any existing in-store messages by id (preserve object identity so
      // <For>-keyed SessionTurn list doesn't fully remount on reload; avoids clobbering
      // live SSE / optimistic messages that arrived while the fetch was in flight).
      const mergeRaw = (pageItems: any[]) => {
        // 水合摄取（spec §5 双摄取点）：历史 parts/synthetic → 后台任务 tracker。
        // 回放期间静默（不因历史完成发通知）；tracker 幂等，与 live SSE 竞争安全。
        ingestHydratedBackgroundEvents(scanHistoryForBackground(pageItems, sessionID))
        const rawExisting = store.message[sessionID]
        const existing = Array.isArray(rawExisting) ? rawExisting : []
        if (!Array.isArray(rawExisting)) console.warn("[mafw] store.message non-array for", sessionID, typeof rawExisting)
        const existingById = new Map(existing.map(m => [m.id, m]))
        const msgs: any[] = [...existing]
        const parts: Record<string, any[]> = {}
        for (const item of pageItems) {
          const info = item.info || item
          const msgId = info.id || `msg-${Date.now()}-${Math.random()}`
          if (existingById.has(msgId)) continue
          // Preserve all API fields — spread entire info object
          const msg = { ...info, id: msgId, sessionID, time: info.time || { created: Date.now() } }
          msgs.push(msg)
          let itemParts = Array.isArray(item.parts) ? item.parts : (Array.isArray(info.parts) ? info.parts : [])
          if (Array.isArray(itemParts) && itemParts.length > 0) {
            parts[msgId] = mergeLocalParts(store.part[msgId], itemParts.map((p: any) => normalizeToolPart({ ...p, id: p.id || `p-${Date.now()}-${Math.random()}`, sessionID, messageID: msgId })))
          }
        }
        if (msgs.length > 0) {
          msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))
          // Orphan fallback: assistant messages with a missing/invalid parentID are
          // grouped under the most recent preceding user message (time-based), so
          // older/broken sessions still render their replies.
          const byId = new Map(msgs.map(m => [m.id, m]))
          let lastUserId: string | null = null
          for (const m of msgs) {
            if (m.role === "user") { lastUserId = m.id; continue }
            if (m.role !== "assistant") continue
            if (m.parentID && byId.has(m.parentID)) continue
            if (lastUserId) m.parentID = lastUserId
          }
          setStore(prev => ({
            ...prev,
            session: sessionData ? [...prev.session.filter(s => s.id !== sessionID), sessionData] : prev.session,
            message: { ...prev.message, [sessionID]: msgs },
            part: { ...prev.part, ...parts },
            session_status: { ...prev.session_status, [sessionID]: { type: "idle" } },
          }))
        }
        return msgs
      }

      const msgs = mergeRaw(rawItems)
      // Set userMsgId to the first user message
      const userMsg = msgs.findLast(m => m.role === "user") // [perf] windowed: anchor live messages to the newest user turn
      if (userMsg) {
        setSessions(prev => prev.map(s => s.id === sessionID ? { ...s, userMsgId: userMsg.id } : s))
        console.log("[mafw] set userMsgId:", userMsg.id, "found in msgs:", msgs.some(m => m.id === userMsg.id))
      } else {
        console.warn("[mafw] no user message found, first msg role:", msgs[0]?.role, "id:", msgs[0]?.id)
      }
      // Assistant-dense backfill: 一页 100 条原始消息可能只有 0~4 个 user turn
      //（自治长跑会话 10:1），首窗空 → 只见「加载更早」按钮。首屏已渲染第一页，
      // 这里后台继续按 user turn 补齐（≤4 页封顶），密度无关（mem_1789616908701）。
      let pageCount = 1
      while (shouldKeepPaging({ collected: countUserTurns(store.message[sessionID] || []), target: 10, nextCursor, pageCount, maxPages: 4 })) {
        const data2 = await window.api.mafw.sessions.messages(sessionID, 100, nextCursor) as any
        const items2 = Array.isArray(data2) ? data2 : data2?.data
        nextCursor = data2?.nextCursor ?? null
        pageCount++
        if (!Array.isArray(items2) || items2.length === 0) { nextCursor = null; break }
        mergeRaw(items2)
      }
      setPageState(sessionID, { cursor: nextCursor, hasMore: !!nextCursor, loading: false })
      anchorRegistry[sessionID]?.()
    } catch (e) { console.warn("[mafw] loadHistory failed", e); showToastV2({ description: "Failed to load session history", duration: 5000 }) }
  }

  // Active session
  const active = () => sessions().find(s => s.id === activeSessionId()) || null

  async function createSession(opts?: { noReveal?: boolean }) {
    console.log("[mafw] createSession")
    setShowWelcome(false)
    setShowConfig(false)
    setActiveTab("chat")
    try {
      const result = await window.api.mafw.sessions.create() as any
      const id = result.id || result.sessionID || `sess-${Date.now()}`
      console.log("[mafw] createSession result id:", id)
      const userMsgId = `user-${Date.now()}`
      const sess: ChatSession = { id, title: `Chat ${sessions().length + 1}`, userMsgId, assistantMsgId: null, done: false }
      setSessions(prev => [...prev, sess])
      setActiveSessionId(id)

      // Add session to store
      setStore(prev => ({
        ...prev,
        session: [...prev.session, { id, title: sess.title, directory: ".", time: { created: Date.now() }, projectID: "." }],
        session_status: { ...prev.session_status, [id]: { type: "idle" } },
        message: { ...prev.message, [id]: [] },
      }))
      sessionStore.invalidate()
      if (!opts?.noReveal) {
        setActiveViewId(id)
      }
      return id
    } catch {
      const id = `local-${Date.now()}`
      setSessions(prev => [...prev, { id, title: `Chat ${sessions().length + 1}`, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false }])
      setActiveSessionId(id)
      sessionStore.invalidate()
      if (!opts?.noReveal) {
        setActiveViewId(id)
      }
      return id
    }
  }

  function closeSession(id: string) {
    setSessions(prev => prev.filter(s => s.id !== id))
    const wasActive = activeSessionId() === id
    const wasActiveView = activeViewId() === id
    if (wasActiveView) {
      const firstSession = sessions()[0]
      setActiveViewId(firstSession?.id ?? null)
      if (wasActive) setActiveSessionId(firstSession?.id ?? null)
    } else if (wasActive) {
      const remaining = sessions().filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
    // Last tab closed → return to the Welcome home board.
    if (sessions().length === 0) {
      setShowWelcome(true)
      setActiveViewId(null)
      setActiveSessionId(null)
    }
    sessionStore.invalidate()
  }

  // Interrupt the in-flight conversation (ESC / Ctrl+C / stop button) lives in
  // ChatPane per-pane now.

  // Current rendering state for SessionTurn
  const currentSessionID = () => active()?.id || ""

  // Composer menus: agents (@ mention) + providers/models (model pill)
  const gwReadyForMenus = createMemo(() => gwStatus()?.state === "ready")
  const [agentsData, setAgentsData] = createSignal<any[]>([])
  const [providersData, setProvidersData] = createSignal<any>(null)
  const [providersRetry, setProvidersRetry] = createSignal(0)
  let providersRetryTimer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => { if (providersRetryTimer) clearTimeout(providersRetryTimer) })
  const refreshMenus = () => {
    window.api.mafw.agents.list().then((list: any[]) => {
      setAgentsData(Array.isArray(list) ? list : [])
    }).catch(e => console.warn("[mafw] agents.list:", e))
    window.api.mafw.providers.list().then((p: any) => {
      setProvidersData(p)
      // Default the model pill to the most recently used model (first entry of
      // localStorage mafw-recent-models) — only when we have no default yet.
      if (defaultModel() === null) {
        try {
          const recent: string[] = JSON.parse(localStorage.getItem("mafw-recent-models") || "[]")
          const first = recent[0]
          if (first) {
            const findModel = (prov: any, mid: string) => {
              const m: any = prov.models?.[mid]
              return m ? { providerID: prov.id, modelID: mid, label: m.name || mid } : null
            }
            let found: { providerID: string; modelID: string; label: string } | null = null
            const slash = first.indexOf("/")
            if (slash > 0) {
              // Composite key: providerID/modelID
              const pid = first.slice(0, slash)
              const mid = first.slice(slash + 1)
              const prov = (p?.all || []).find((x: any) => x.id === pid)
              found = prov ? findModel(prov, mid) : null
            } else {
              // Legacy plain id: match the first provider that has it
              for (const prov of p?.all || []) {
                found = findModel(prov, first)
                if (found) break
              }
            }
            if (found) setDefaultModel(found)
          }
        } catch { /* ignore */ }
      }
    }).catch(e => {
      // Serve/gateway may still be starting (or briefly down): retry with a
      // bounded schedule instead of leaving an empty model picker forever.
      console.warn("[mafw] providers.list:", e)
      const attempt = providersRetry() + 1
      if (attempt <= 12 && providersRetryTimer === null) {
        providersRetryTimer = setTimeout(() => {
          providersRetryTimer = null
          setProvidersRetry(attempt)
        }, 10_000)
      }
    })
  }

  createEffect(() => {
    if (!gwReadyForMenus()) return
    providersRetry() // re-run when a failed providers fetch schedules a retry
    refreshMenus()
  })

  // Runtime switch swaps the storage backend: open tabs reference sessions
  // that do not exist under the new runtime (sending would 404, SSE delivers
  // no events for them). Reset to the fresh-launch state — welcome page,
  // empty caches. createStore fields MUST clear via reconcile (object args
  // deep-merge, {} would be a silent no-op).
  const resetChatWorkspace = () => {
    setShowWelcome(true)
    setSessions([])
    setActiveViewId(null)
    setActiveSessionId(null)
    setSubagentStack(reconcile({}))
    setTodos(reconcile({}))
    setHiddenTodos(reconcile({}))
    setModelPicks({})
    setDefaultModel(null)
    setStore("message", reconcile({}))
    setStore("part", reconcile({}))
    setStore("session_status", reconcile({}))
    setStore("session_diff", reconcile({}))
    // Pending approvals/asks belong to dead old-runtime sessions — without
    // clearing, the Approvals badge stays lit on unresolvable cards.
    setFlowCards({})
    setPageState(reconcile({}))
    setCompactionMarks({})
    setAgentPicks(reconcile({}))
  }

  // Primary agents (switchable driver) vs subagent agents (mentionable too).
  // The `manager` primary agent ships with the gateway install (global opencode
  // config), so it appears here as a regular primary agent.
  const primaryAgents = createMemo(() =>
    (agentsData() || []).filter((a: any) => !a.hidden && a.mode === "primary")
  )
  const subagentAgents = createMemo(() =>
    (agentsData() || []).filter((a: any) => !a.hidden && a.mode === "subagent")
  )

  const modelGroups = createMemo(() => {
    const p = providersData()
    const all = p?.all || []
    const connected = new Set(p?.connected || [])
    const groups: { provider: string; providerID: string; models: ModelEntry[] }[] = []
    for (const prov of all) {
      if (!connected.has(prov.id)) continue
      const models: ModelEntry[] = Object.values(prov.models || {}).map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        providerID: prov.id,
        provider: prov.name || prov.id,
        contextK: m.limit?.context ? Math.round(m.limit.context / 1000) : undefined,
        vision: !!(m.capabilities?.input?.image || m.capabilities?.output?.image),
        thinking: !!m.capabilities?.reasoning,
      }))
      if (models.length === 0) continue
      groups.push({ provider: prov.name || prov.id, providerID: prov.id, models })
    }
    return groups
  })

  // Per-session model resolution: user pick → session's last assistant message
  // model → global recent default. All reads are reactive sources, so memo/JSX
  // consumers re-evaluate on history or pick changes.
  const sessionModel = (sid: string): ModelSel | null => {
    const pick = modelPicks()[sid]
    if (pick) return pick
    const msgs = sid ? (store.message[sid] || []) : []
    const last = [...msgs].reverse().find((m: any) => m.role === "assistant")
    const m = messageModel(last)
    if (m) {
      const group = modelGroups().find((g) => g.providerID === m.providerID)
      const entry = group?.models.find((em) => em.id === m.modelID)
      return { providerID: m.providerID, modelID: m.modelID, label: entry?.name || m.modelID }
    }
    return defaultModel()
  }

  // ── Pickers: agent selection (shared), per-pane picker state lives in ChatPane ──
  // Per-session agent pick（切片 3：agentSel 全局单值 → per-session，对齐 modelPicks 模式）。
  // 值 = agent name（null/缺省 = runtime 默认）；plan/build 快捷切换写这里。
  const [agentPicks, setAgentPicks] = createStore<Record<string, string>>({})
  const [switchLogs, setSwitchLogs] = createSignal<Record<string, string[]>>({})
  const [taskListOpen, setTaskListOpen] = createSignal(false)
  const [viewportWidth, setViewportWidth] = createSignal(window.innerWidth)
  const [titlebarRef, setTitlebarRef] = createSignal<HTMLElement | null>(null)
  const [winMaximized, setWinMaximized] = createSignal(false)
  onMount(() => {
    void window.api.windowControls.isExpanded().then(setWinMaximized)
    const unsub = window.api.windowControls.onExpandedChange(setWinMaximized)
    onCleanup(unsub)
  })
  // Anchor for the TaskList popover: the titlebar of the pane whose TaskBar the
  // user clicked (per-pane titlebar ref).
  const [taskAnchor, setTaskAnchor] = createSignal<HTMLElement | null>(null)
  // Session whose todos the TaskList popover shows.
  const [taskListSid, setTaskListSid] = createSignal<string | null>(null)
  // Hover-intent for the TaskList popover: opening on TaskBar hover, closing a
  // short delay after the mouse leaves (canceled while inside the popover).
  const [taskHover, setTaskHover] = createSignal(false)
  let taskHoverTimer: ReturnType<typeof setTimeout> | null = null
  const openTasks = (el: HTMLElement | null, sid?: string | null) => {
    if (sid) setTaskListSid(sid)
    setTaskAnchor(el)
    setTaskListOpen(true)
  }
  const openTasksHover = (el: HTMLElement | null, sid?: string | null) => {
    setTaskHover(true)
    if (taskHoverTimer) { clearTimeout(taskHoverTimer); taskHoverTimer = null }
    openTasks(el, sid)
  }
  const scheduleTaskClose = () => {
    if (!taskHover()) return
    if (taskHoverTimer) clearTimeout(taskHoverTimer)
    taskHoverTimer = setTimeout(() => {
      taskHoverTimer = null
      setTaskHover(false)
      setTaskListOpen(false)
    }, 250)
  }
  const cancelTaskClose = () => {
    if (taskHoverTimer) { clearTimeout(taskHoverTimer); taskHoverTimer = null }
  }
  const closeTaskHover = () => {
    if (!taskHover()) return
    setTaskHover(false)
    if (taskHoverTimer) { clearTimeout(taskHoverTimer); taskHoverTimer = null }
    setTaskListOpen(false)
  }
  const toggleTasks = (el: HTMLElement | null, sid?: string | null) => {
    setTaskHover(false)
    if (taskHoverTimer) { clearTimeout(taskHoverTimer); taskHoverTimer = null }
    if (sid) setTaskListSid(sid)
    setTaskAnchor(el)
    setTaskListOpen(o => !o)
  }

  // ── Workbench + 会话图标轨（spec 2026-10-26-workbench-merge-design）──
  // 旧键一次性迁移：写新档位键、清旧宽度键、旧 workbench tab 映射（新键优先）
  const workbenchBoot = migrateDockKeys(
    (k) => { try { return localStorage.getItem(k) } catch { return null } },
    (k) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
    window.innerWidth - 46,
  )
  try { localStorage.setItem("mafw-workbench-detent", String(workbenchBoot.detent)) } catch { /* ignore */ }
  const [rightDockOpen, setRightDockOpen] = createSignal(defaultDockOpen(localStorage.getItem("mafw-right-dock-open")))
  const bootView = workbenchStateFromStorage((k) => {
    try { return localStorage.getItem(k) } catch { return null }
  })
  const [workbenchView, setWorkbenchView] = createSignal<WorkbenchView>(bootView.view)
  const [workbenchSurface, setWorkbenchSurface] = createSignal<WorkbenchSurface>(bootView.surface)
  const [executionSection, setExecutionSection] = createSignal<ExecutionSection>(bootView.executionSection)
  try {
    localStorage.setItem("mafw-workbench-view", bootView.view)
    localStorage.setItem("mafw-workbench-surface", bootView.surface)
    localStorage.setItem("mafw-execution-section", bootView.executionSection)
  } catch { /* ignore */ }
  const storedTerminal = (() => { try { return localStorage.getItem("mafw-workbench-terminal") } catch { return null } })()
  const [workbenchTerminalOpen, setWorkbenchTerminalOpen] = createSignal(
    storedTerminal !== null ? storedTerminal !== "0" : workbenchBoot.terminalOpen,
  )
  // 绝对 px 三档（520/640/760，默认 640）
  const [detent, setDetent] = createSignal<WorkbenchDetent>(workbenchBoot.detent)
  /** 拖动中的连续预览（松手吸附后清空）。 */
  const [chatPreview, setChatPreview] = createSignal<number | null>(null)
  const availableWidth = () => Math.max(0, window.innerWidth - 46 - (leftDockMode() === "push" ? leftDockWidth() : 0))
  const chatPx = () => chatPreview() ?? chatPxForDetent(detent(), availableWidth())
  const applyDetent = (d: WorkbenchDetent) => {
    setDetent(d)
    setChatPreview(null)
    try {
      localStorage.setItem("mafw-workbench-detent", String(d))
      localStorage.removeItem("mafw-chat-width")
    } catch { /* ignore */ }
  }
  // 松手吸附（ResizeHandle 无 release 钩子，window pointerup 统一收口）
  onMount(() => {
    const onUp = () => {
      const preview = chatPreview()
      if (preview === null) return
      applyDetent(snapDetent(preview, availableWidth()))
    }
    window.addEventListener("pointerup", onUp)
    onCleanup(() => window.removeEventListener("pointerup", onUp))
  })
  // Per-turn diff data for the B2 changes/editor docks (B3.1). The overlay owns
  // its own fetch; this memo is only for the dock consumers.
  const sessionMessages = createMemo(() => (store.message as any)[currentSessionID()] || [])
  const sessionBusy = () => {
    const sid = currentSessionID()
    return !!(sid && store.session_status?.[sid]?.type === "busy")
  }
  const mergedSessionDiffs = createMemo(() =>
    getSessionTurnDiffs().entries(currentSessionID() || "", sessionMessages()),
  )
  createEffect(() => {
    const sid = currentSessionID()
    if (!sid) return
    // 始终为活动会话预热 per-turn 数据：composer badge 与 changes tree 共用同一份合并结果。
    getSessionTurnDiffs().ensure({
      sid,
      messages: sessionMessages(),
      runtimeName: rtName(),
      busy: sessionBusy(),
      diffApi: rtCaps().diffApi === true,
    })
  })
  const welcomeFull = () => activeTab() === "chat" && !showConfig() && (showWelcome() || !activeSessionId())
  const chatActive = () => activeTab() === "chat" && !showConfig() && !welcomeFull()
  const chatSplit = () => chatActive() && rightDockOpen()
  const bodyColumns = () =>
    workbenchColumns({
      leftPx: leftDockMode() === "push" ? leftDockWidth() : 0,
      chatPx: chatPx(),
      split: chatSplit(),
    })

  const applyRightDock = (open: boolean) => {
    setRightDockOpen(open)
    try { localStorage.setItem("mafw-right-dock-open", open ? "1" : "0") } catch { /* ignore */ }
  }
  const applyWorkbenchView = (view: WorkbenchView) => {
    setWorkbenchView(view)
    try { localStorage.setItem("mafw-workbench-view", view) } catch { /* ignore */ }
  }
  const applyWorkbenchSurface = (surface: WorkbenchSurface) => {
    setWorkbenchSurface(surface)
    applyWorkbenchView("workbench")
    try { localStorage.setItem("mafw-workbench-surface", surface) } catch { /* ignore */ }
  }
  const applyExecutionSection = (section: ExecutionSection) => {
    setExecutionSection(section)
    applyWorkbenchView("execution")
    try { localStorage.setItem("mafw-execution-section", section) } catch { /* ignore */ }
  }
  const openWorkbench = (view: WorkbenchView, section?: ExecutionSection) => {
    if (section) applyExecutionSection(section)
    else applyWorkbenchView(view)
    setRightDockOpen(true)
    try { localStorage.setItem("mafw-right-dock-open", "1") } catch { /* ignore */ }
  }
  const openWorkbenchSurface = (surface: WorkbenchSurface) => {
    applyWorkbenchSurface(surface)
    setRightDockOpen(true)
    try { localStorage.setItem("mafw-right-dock-open", "1") } catch { /* ignore */ }
  }
  const toggleWorkbenchTerminal = () => {
    const next = !workbenchTerminalOpen()
    setWorkbenchTerminalOpen(next)
    try { localStorage.setItem("mafw-workbench-terminal", next ? "1" : "0") } catch { /* ignore */ }
  }
  // 文件/编辑器根：会话目录属于项目（含 worktree）才采用，否则回退项目目录
  // （manager 会话的 directory 可能指向 home 等外部目录，实证 2026-10-22）
  const benchRoot = () =>
    resolveWorkbenchRoot(currentProject(), store.session.find((s: any) => s.id === currentSessionID())?.directory ?? null)

  // SSE live trajectory signals
  const [trajectoryLive, setTrajectoryLive] = createSignal<Record<string, any[]>>({})
  const [trajectoryTurnLive, setTrajectoryTurnLive] = createSignal<Record<string, any>>({})

  // 左栏：IconRail（46px 常驻）+ LeftDock（会话/搜索两面，spec 2026-10-22-workbench-layout）。
  // 双模态：窗口化=浮层覆盖；最大化/全屏且非窄=推挤列。旧 Rail 键一次性迁宽度。
  const initialLeftDockWidth = resolveLeftDockWidth(
    localStorage.getItem("mafw-left-dock-width"),
    localStorage.getItem("mafw-rail-width"),
  )
  const [leftDockWidth, setLeftDockWidth] = createSignal(initialLeftDockWidth.width)
  if (initialLeftDockWidth.migrated) {
    // 严格一次性：写入新键后删除旧键，之后启动不再读取。
    try {
      localStorage.setItem("mafw-left-dock-width", String(initialLeftDockWidth.width))
      localStorage.removeItem("mafw-rail-width")
    } catch { /* ignore */ }
  }
  const [leftDock, setLeftDock] = createSignal<{ face: LeftDockFace; open: boolean }>({
    face: (localStorage.getItem("mafw-left-dock-face") as LeftDockFace | null) ?? "sessions",
    open: restoreLeftDockOpen(localStorage.getItem("mafw-left-dock-open"), window.innerWidth),
  })
  const leftDockMode = () => resolveMode(leftDock().open, viewportWidth())
  const toggleLeftDock = (face: LeftDockFace) => {
    const next = toggleFace(leftDock(), face)
    setLeftDock(next)
    try {
      localStorage.setItem("mafw-left-dock-open", next.open ? "1" : "0")
      localStorage.setItem("mafw-left-dock-face", next.face)
    } catch { /* ignore */ }
  }
  const closeLeftDock = () => {
    setLeftDock(s => ({ ...s, open: false }))
    try { localStorage.setItem("mafw-left-dock-open", "0") } catch { /* ignore */ }
  }
  // 浮层模式下，选中会话/导航离开 chat 时自动关；推挤列保持。
  const closeLeftDockIfOverlay = () => {
    if (shouldCloseOnSelect(leftDockMode())) closeLeftDock()
  }
  const applyLeftDockWidth = (w: number) => {
    const clamped = clampLeftDockWidth(w)
    setLeftDockWidth(clamped)
    try { localStorage.setItem("mafw-left-dock-width", String(clamped)) } catch { /* ignore */ }
  }
  // 会话选中统一走 openSessionTab（含 syncPermissionMode 与浮层关闭）。
  const connPhaseLabel = () =>
    connPhase() === "connected" ? "connected"
    : connPhase() === "reconnecting" ? "reconnecting"
    : connPhase() === "down" ? "down"
    : "initial"
  const dockPresent = createPresence(() => rightDockOpen(), SURFACE_MS)

  // Ctrl/Cmd+J: toggle the TaskBar popover. Skip when typing.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "j") return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      e.preventDefault()
      setTaskListOpen(o => !o)
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // 布局开关快捷键（VS Code 惯例）：Ctrl+B 侧边栏、Ctrl+Alt+B 面板。skip when typing.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      if (e.key !== "b" && e.key !== "B") return
      e.preventDefault()
      if (e.altKey) applyRightDock(!rightDockOpen())
      else toggleLeftDock("sessions")
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Ctrl/Cmd+K: 打开左栏搜索面（全局搜索入口）。
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return
      // composer 聚焦时 Ctrl+K 归 readline（kill 到行尾）；Meta/Cmd 保持全局搜索。
      if (e.ctrlKey && !e.metaKey && (e.target as HTMLElement | null)?.closest?.(".mafw-composer")) return
      e.preventDefault()
      toggleLeftDock("search")
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Ctrl/Cmd+T: toggle unified right dock. Skip when typing.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "t") return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      e.preventDefault()
      applyRightDock(!rightDockOpen())
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // 宽度跟踪：左 dock 的 push/overlay 由 viewportWidth 决定。
  createEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })
  // 浮层模式：Esc 关闭（点外关闭由 backdrop 承担）。
  createEffect(() => {
    if (leftDockMode() !== "overlay") return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeLeftDock() }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const subagentRunning = (id: string) => store.session_status[id]?.type === "busy"

  const onModelSelect = (m: ModelEntry, sid?: string) => {
    const target = sid || currentSessionID()
    if (!target) return
    const prev = modelPicks()[target]
    setModelPicks({ ...modelPicks(), [target]: { providerID: m.providerID, modelID: m.id, label: m.name } })
    // 2.1 sticky 即时切换：不等待下一条消息；失败回滚本地 pick，防假状态。
    void window.api.mafw.sessions.switchModel(target, { providerID: m.providerID, modelID: m.id }).catch(() => {
      const next = { ...modelPicks() }
      if (prev) next[target] = prev
      else delete next[target]
      setModelPicks(next)
      showToastV2({ description: "切换模型失败", duration: 2000 })
    })
  }

  // Manager sessions are locked to the manager agent — switching to another
  // primary agent is not allowed there.
  // isManager 判定已收敛进 ChatPane（workspace.sessionRole per-session）

  const applyAgentSwitch = (a: AgentEntry, sidOverride?: string) => {
    const sid = sidOverride ?? currentSessionID()
    if (sid) {
      // 2.1.0：稳定键是 id（build/plan），显示名只用于展示
      const prev = agentPicks[sid]
      setAgentPicks(sid, agentKey(a))
      setSwitchLogs(prev => ({ ...prev, [sid]: [...(prev[sid] || []), `已切换到 ${a.name}`] }))
      // sticky 即时切换：失败回滚本地 pick，防“显示已切换但服务端没切”。
      void window.api.mafw.sessions.switchAgent(sid, agentKey(a)).catch(() => {
        setAgentPicks(sid, prev as any)
        showToastV2({ description: "切换 agent 失败", duration: 2000 })
      })
    }
  }

  /** 当前会话（或指定 sid）解析后的 agent：picks → 查 primaryAgents → null（runtime 默认）。 */
  const sessionAgent = (sid: string | null | undefined): AgentEntry | null => {
    if (!sid) return null
    const name = agentPicks[sid]
    if (!name) return null
    return primaryAgents().find(a => agentKey(a) === name) ?? null
  }

  // 2.1.0 sticky agent：session.agent 是运行时真值（build/plan/…）——
  // 应用重启后用它把 agent 药丸补回来；本地已有选择时不覆盖
  // （用户刚点的选择先于服务端旧值，直到下一条消息把切换写入会话）。
  createEffect(() => {
    const list = historySessions() as Array<{ id?: string; agent?: string }>
    const agents = primaryAgents()
    if (!Array.isArray(list) || list.length === 0 || agents.length === 0) return
    for (const s of list) {
      if (!s?.id || !s.agent) continue
      if (agentPicks[s.id]) continue
      const hit = resolveSessionAgent(agents, s.agent)
      if (hit) setAgentPicks(s.id, agentKey(hit))
    }
  })

  // TaskList metrics: tokens + start time of the current (last) turn
  const taskMetrics = (sid: string) => {
    if (!sid) return { tokens: 0, started: 0 }
    const msgs = store.message[sid] || []
    const userMsgs = msgs.filter(m => m.role === "user")
    const userMsg = userMsgs[userMsgs.length - 1]
    if (!userMsg) return { tokens: 0, started: 0 }
    const assistants = msgs.filter(m => m.role === "assistant" && m.parentID === userMsg.id)
    const last = assistants[assistants.length - 1]
    const tokens = last?.tokens?.total || last?.tokens?.output || 0
    return { tokens, started: userMsg.time?.created || 0 }
  }

  // All todos completed → header accent line/badge collapse ("细线收起", spec §2).
  const tasksAllDone = (sid: string) => {
    const ts = todos[sid] || []
    return ts.length > 0 && ts.every(t => t.status === "completed")
  }

  // Gateway status
  onMount(() => {
    window.api.mafw.gateway.info().then(setGwStatus)
    const unsub = window.api.mafw.gateway.onStateChange(s => {
      setGwStatus(s)
      // Fold process-level transitions into the connection phase machine and
      // (re)establish SSE when the gateway (re)appears after this window
      // loaded — e.g. self-update relay restarts.
      if (s?.state === "failed") conn.report("gateway-failed")
      else if (s?.state === "ready") conn.report("gateway-ready")
      if (s?.state === "ready" && !es) void connectSse()
    })
    onCleanup(unsub)
    // Optional chain: a stale preload (renderer HMR outpaces preload rebuild)
    // must degrade to "no health toasts", not crash the whole shell.
    const unsubHealth = window.api.mafw.gateway.onHealthChange?.((h: { healthy: boolean }) => {
      if (!h.healthy && conn.phase === "initial") {
        showToastV2({ description: "Gateway 健康检查失败，后台将自动重试", duration: 3000 })
      }
    })
    if (unsubHealth) onCleanup(unsubHealth)
    // Global drag guard: dropping a file anywhere must not navigate the window.
    const preventGlobal = (e: DragEvent) => e.preventDefault()
    document.addEventListener("dragover", preventGlobal)
    document.addEventListener("drop", preventGlobal)
    onCleanup(() => {
      document.removeEventListener("dragover", preventGlobal)
      document.removeEventListener("drop", preventGlobal)
    })
  })

  return (
      <DialogProvider>
        <MarkedProvider>
          <FileComponentProvider component={FileSSR}>
            <DataProvider data={store} directory="." onNavigateToSession={(id) => void openSubagentSession(id)}>
              <div class="mafw-shell" classList={{ maximized: winMaximized() }}>
      <ToastV2.Region />
      <CommandPalette
        open={paletteOpen()}
        items={paletteItems()}
        onClose={() => setPaletteOpen(false)}
      />
      <ConfirmOverlay
        open={confirmReq() !== null}
        title={confirmReq()?.title || ""}
        message={confirmReq()?.message}
        confirmLabel={confirmReq()?.confirmLabel}
        onConfirm={() => { const req = confirmReq(); setConfirmReq(null); req?.onConfirm() }}
        onCancel={() => setConfirmReq(null)}
      />
      {/* 左列：IconRail 通高（grid-row 1/-1），常驻 46px */}
      <div class="mafw-rail-col">
        <IconRail
          face={leftDock().open ? leftDock().face : null}
          onToggleFace={toggleLeftDock}
          onDashboard={() => { closeLeftDockIfOverlay(); setShowConfig(false); setActiveTab("goals") }}
          onConfig={() => { closeLeftDockIfOverlay(); setConfigSection(undefined); setShowConfig(true) }}
          onToggleTheme={toggleTheme}
          approvals={pendingPermissionCount()}
          connPhase={connPhaseLabel()}
          gatewayState={gwStatus()?.state ?? null}
          dashboardActive={activeTab() === "goals" && !showConfig()}
          configActive={showConfig()}
          theme={theme()}
        />
      </div>
      {/* 顶行：strip（会话 tab 恒显）+ dock 图标组 + 窗口控制 */}
      <div
        class="mafw-topstrip"
        onDblClick={(e) => {
          if (window.api.platform !== "win32") return
          if ((e.target as HTMLElement).closest("button,input,[data-component],a,.mafw-session-tab")) return
          void window.api.windowControls.toggleMaximize()
        }}
      >
        <SessionStrip
          sessions={sessions}
          activeViewId={activeViewId}
          onSelect={(id) => { closeLeftDockIfOverlay(); setShowConfig(false); setActiveTab("chat"); setShowWelcome(false); setActiveSessionId(id); setActiveViewId(id) }}
          onClose={closeSession}
          onRename={(id, next) => {
            setSessions(prev => prev.map(x => x.id === id ? { ...x, title: next } : x))
            setStore(prev => ({ ...prev, session: prev.session.map((x: any) => x.id === id ? { ...x, title: next } : x) }))
            window.api.mafw.sessions.rename(id, next)
              .catch((err: any) => showToastV2({ description: `重命名失败: ${err?.message || err}`, duration: 3000 }))
          }}
          onExport={(id) => void exportSession(id)}
          onCopyId={copyText}
          onNew={createSession}
          onHome={() => {
            closeLeftDockIfOverlay()
            setShowConfig(false)
            setActiveTab("chat")
            setShowWelcome(true)
          }}
        />
        <div class="mafw-topstrip-spacer" />
        <Show when={chatActive()}>
          <TooltipV2 value={`${rightDockOpen() ? "隐藏" : "显示"}面板 (Ctrl+Alt+B)`} openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-layout-toggle"
              aria-label="切换面板"
              aria-pressed={rightDockOpen()}
              onClick={() => applyRightDock(!rightDockOpen())}
            >
              <Icon name={rightDockOpen() ? "layout-right-full" : "layout-right-partial"} size="small" />
            </ButtonV2>
          </TooltipV2>
        </Show>
        <WindowControls />
      </div>
      {/* 右列下行：left dock(push 列) | main | dock */}
      <div class="mafw-body" style={{ "grid-template-columns": bodyColumns() }}>
        <Show when={leftDockMode() !== "closed"}>
          <Show when={leftDockMode() === "overlay"}>
            <div class="mafw-left-dock-backdrop" onClick={closeLeftDock} />
          </Show>
          <LeftDock
            mode={leftDockMode()}
            face={leftDock().face}
            width={leftDockWidth()}
            onClose={closeLeftDock}
            onResize={applyLeftDockWidth}
            activeSessionId={activeSessionId()}
            managerSessionId={managerSessionId()}
            projectsRev={projectsRev}
            onNewSession={() => { closeLeftDockIfOverlay(); void createSession().then(sid => { if (sid) openSessionTab(sid) }) }}
            onSelectSession={openSessionTab}
            onSessionDeleted={closeSession}
          />
        </Show>
        <div class="mafw-main">
          <div class="mafw-content" classList={{ "mafw-chat-content": activeTab() === "chat" }}>
            <Show when={connDown()}><ConnBanner /></Show>
            {showConfig() ? (
              <ConfigPage onBack={() => { setShowConfig(false); setConfigSection(undefined) }} initialSection={configSection()} />
            ) : connDown() && activeTab() !== "chat" ? (
              <div class="mafw-rail-empty" style={{ padding: "48px 0" }}>Gateway 已断开——数据将在恢复后自动刷新</div>
            ) : activeTab() === "chat" ? (
              <div class="mafw-chat">
                {/* Single ChatPane for the active session */}
                <Show
                  when={showWelcome() || !activeSessionId()}
                  fallback={
                    <div class="mafw-chat-panes">
                        <ChatPane
                          sessionID={activeSessionId()!}
                          focused
                          canClosePane={false}
                          todos={todos}
                          hiddenTodos={hiddenTodos}
                          switchLogs={switchLogs}
                          sessionCards={sessionCards}
                          sessionPending={sessionPending}
                          taskMetrics={taskMetrics}
                          tasksAllDone={tasksAllDone}
                          gwReady={gwStatus()?.state === "ready"}
                          agentSel={() => sessionAgent(activeSessionId()!)}
                          model={() => sessionModel(activeSessionId()!)}
                          modelGroups={modelGroups}
                          primaryAgents={primaryAgents}
                          subagentAgents={subagentAgents}
                          subagentRunning={subagentRunning}
                          onNewTopic={() => void handleNewTopic()}
                          readOnly={!!store.session.find((s: any) => s.id === activeSessionId()!)?.parentID}
                          parentID={store.session.find((s: any) => s.id === activeSessionId()!)?.parentID ?? null}
                          onBackToParent={() => backToParent(activeSessionId()!)}
                          onOpenSubagent={(id) => void openSubagentSession(id)}
                          onOpenBackgroundDock={() => openWorkbench("execution", "background")}
                          currentProject={currentProject()}
                          onNavigateTab={(t) => { setActiveTab(t as any); setShowConfig(false) }}
                          onToggleTheme={toggleTheme}
                          onOpenSettings={() => { setConfigSection(undefined); setShowConfig(true) }}
                          onModelSelect={onModelSelect}
                          onApplyAgentSwitch={applyAgentSwitch}
                          onPermReply={permReply}
                          onAskSubmit={askSubmit}
                          onAskCancel={askCancel}
                          onTitlebarRef={(el) => setTitlebarRef(el)}
                          taskListOpen={taskListOpen()}
                          onTaskToggle={(el, sid) => toggleTasks(el, sid ?? null)}
                          onTaskHoverOpen={(el, sid) => openTasksHover(el, sid ?? null)}
                          onTaskHoverLeave={scheduleTaskClose}
                          onFocus={() => { setShowConfig(false); setActiveTab("chat") }}
                          onOpenForkedSession={(forkedSid) => openSessionTab(forkedSid)}
                          onOpenDiffReview={() => openWorkbench("review")}
                          worktreeEnabled={worktreeEnabled()}
                          revertUndoEnabled={revertUndoEnabled()}
                          runtimeName={rtName()}
                          runtimeCaps={rtCaps()}
                          onCreateWorktreeSession={createWorktreeSession}
                          projectDirectory={currentProject()}
                          onPlanBuildToggle={(next) => {
                            if (next === "default") {
                              const sid = activeSessionId()
                              if (!sid) return
                              const prev = agentPicks[sid]
                              setAgentPicks(sid, undefined as any)
                              // 2.1 没有“清除回默认”的端点；默认 driver 是 build。
                              const fallback = primaryAgents().find(a => isAgentKey(a, "build"))
                              if (fallback) {
                                void window.api.mafw.sessions.switchAgent(sid, agentKey(fallback)).catch(() => {
                                  setAgentPicks(sid, prev as any)
                                  showToastV2({ description: "切换 agent 失败", duration: 2000 })
                                })
                              }
                              return
                            }
                            const entry = primaryAgents().find(a => isAgentKey(a, next))
                            if (entry) applyAgentSwitch(entry, activeSessionId()!)
                          }}
                          onCreateSession={createSession}
                          onSetUserMsgId={(sid2, userMsgId2) => setSessions(prev => prev.map(s => s.id === sid2 ? { ...s, userMsgId: userMsgId2 } : s))}
                          compactionMark={compactionMarks()[activeSessionId()!] || null}
                          permissionMode={permissionModes[activeSessionId()!] || "read-only"}
                          onTogglePermissionMode={() => {
                            const prev = permissionModes[activeSessionId()!] || "read-only"
                            const next = nextPermissionMode(prev)
                            setPermissionModes(activeSessionId()!, next) // 乐观更新
                            window.api.mafw.permissions.setMode(activeSessionId()!, next).catch(() => {
                              setPermissionModes(activeSessionId()!, prev) // 回滚
                              showToastV2({ description: "切换审批模式失败", duration: 2000 })
                            })
                          }}
                          pageState={pageState}
                          setPageState={setPageState as any}
                        />
                    </div>
                  }
                >
                   <WelcomeHome
                     projects={projects()}
                     currentProject={currentProject()}
                     onSelectProject={(w) => void handleSelectProject(w)}
                     openSessions={sessions()}
                     historySessions={historySessions()}
                     onSelect={(sid) => { const h = historySessions().find(x => x.id === sid); openSessionTab(sid, h?.title) }}
                     onCreate={() => void createSession()}
                     onNavigate={(t) => { setActiveTab(t); setShowConfig(false) }}
                     onNewGoal={handleNewGoal}
                     onOpenManager={handleOpenManager}
                     hasPlanAgent={primaryAgents().some(a => isAgentKey(a, "plan"))}
                     onStartWithPlan={() => {
                       const planEntry = primaryAgents().find(a => isAgentKey(a, "plan"))
                       if (!planEntry) return
                       void createSession().then((sid) => { if (sid) applyAgentSwitch(planEntry, sid) })
                     }}
                   />
                </Show>
                {/* TaskList: inline TaskBar popover */}
                <Show when={taskListOpen()}>
                  <PopoverShell
                    open={taskListOpen()}
                    trigger={taskAnchor()}
                    anchor="below-center"
                    onClose={() => setTaskListOpen(false)}
                    onHoverEnter={cancelTaskClose}
                    onHoverExit={closeTaskHover}
                    width={560}
                  >
                    <TaskList
                      todos={todos[taskListSid() ?? currentSessionID()] || []}
                      hiddenTodos={hiddenTodos[taskListSid() ?? currentSessionID()] || []}
                      onClearHidden={() => clearHiddenTodos(taskListSid() ?? currentSessionID())}
                      tokens={taskMetrics(taskListSid() ?? currentSessionID()).tokens}
                      started={taskMetrics(taskListSid() ?? currentSessionID()).started}
                      placement="popover"
                      onClose={() => setTaskListOpen(false)}
                      onPin={() => { setTaskListOpen(false); openWorkbench("execution", "todos") }}
                    />
                  </PopoverShell>
                </Show>
              </div>
            ) : activeTab() === "goals" ? (
              <DashboardPage onOpenSession={openSessionTab} onNavigate={(t) => { setActiveTab(t); setShowConfig(false) }} />
            ) : activeTab() === "memory" ? (
              <MemoryPage />
            ) : activeTab() === "approvals" ? (
              <ApprovalsPage permissionCards={pendingPermissionCards} onPermissionReply={permReply} />
            ) : activeTab() === "triage" ? (
              <TriagePage />
            ) : activeTab() === "automation" ? (
              <AutomationsPage />
            ) : null}
          </div>
          <Show when={chatSplit()}>
            <div
              class="mafw-chat-resize-wrap"
              onDblClick={() => applyDetent(WORKBENCH_DEFAULT_DETENT)}
              title="拖动调宽（松手吸附 520/640/760）；双击回默认档 640"
            >
              <ResizeHandle
                direction="horizontal"
                edge="end"
                class="mafw-chat-resize"
                size={chatPx()}
                min={CHAT_PX_FLOOR}
                max={Math.max(CHAT_PX_FLOOR, Math.min(CHAT_PX_CEIL, availableWidth() - WORKBENCH_MIN_WIDTH))}
                onResize={(px) => setChatPreview(px)}
                onCollapse={() => applyRightDock(false)}
              />
              <Show when={chatPreview() !== null}>
                <span class="mafw-chat-resize-badge">
                  {formatResizePreview(chatPreview()!, availableWidth())}
                </span>
              </Show>
            </div>
          </Show>
        </div>
        {/* B1 右工作台：工作台/执行/审阅 + 常驻终端 */}
        <div class="mafw-dock-slot">
          <Show when={dockPresent()}>
            <Show when={connDown()}><ConnBanner /></Show>
            {connDown() ? (
              <div class="mafw-rail-empty" style={{ padding: "48px 0" }}>Gateway 已断开——数据将在恢复后自动刷新</div>
            ) : (
              <div class="mafw-dock-shell" classList={{ "is-hidden": workbenchShellHidden(chatActive()) }}>
                <WorkbenchShell
                  open={dockPresent() && chatActive()}
                  view={workbenchView()}
                  surface={workbenchSurface()}
                  executionSection={executionSection()}
                  onView={applyWorkbenchView}
                  onSurface={applyWorkbenchSurface}
                  onExecutionSection={applyExecutionSection}
                  sessionID={currentSessionID() || null}
                  sessionDirectory={benchRoot()}
                  diffs={mergedSessionDiffs()}
                  terminalOpen={workbenchTerminalOpen()}
                  onToggleTerminal={toggleWorkbenchTerminal}
                  onOpenFile={(rel) => {
                    const root = benchRoot()
                    if (!root) return
                    requestOpenEditor(root, rel)
                    openWorkbenchSurface("code")
                  }}
                  onSendAnnotation={(text) => {
                    const sid = currentSessionID()
                    if (!sid) return
                    void window.api.mafw.sessions.promptAsync({ sessionID: sid, message: text })
                      .then(() => showToastV2({ description: "批注已发送给 agent", duration: 2000 } as any))
                      .catch((e: any) => showToastV2({ description: `发送失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 4000 } as any))
                  }}
                  onAddAnnotation={(a) => {
                    const sid = currentSessionID()
                    if (!sid) return
                    addPending({ sessionID: sid, ...a })
                    showToastV2({ description: "已加入批注", duration: 1600 } as any)
                  }}
                  onSendComment={(sid, text) => {
                    void window.api.mafw.sessions.promptAsync({ sessionID: sid, message: text })
                      .then(() => showToastV2({ description: "评论已发送给 agent", duration: 2000 } as any))
                      .catch((e: any) => showToastV2({ description: `发送失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 4000 } as any))
                  }}
                  executionView={
                    <ExecutionView
                      section={executionSection()}
                      sessionID={currentSessionID() || null}
                      sessionDirectory={store.session.find((s: any) => s.id === currentSessionID())?.directory ?? null}
                      todos={todos[currentSessionID()] || []}
                      hiddenTodos={hiddenTodos[currentSessionID()] || []}
                      tokens={taskMetrics(currentSessionID()).tokens}
                      started={taskMetrics(currentSessionID()).started}
                      onClearHidden={() => clearHiddenTodos(currentSessionID())}
                      onClosePanel={() => applyRightDock(false)}
                      onOpenSubagent={(id) => void openSubagentSession(id)}
                      onOpenSection={applyExecutionSection}
                      trajectoryLive={trajectoryLive()[currentSessionID()] || []}
                      trajectoryTurnLive={trajectoryTurnLive()[currentSessionID()] || null}
                      usage={
                        <UsageDock
                          sessionID={currentSessionID()}
                          projectID={currentProject()}
                          store={store}
                          model={() => sessionModel(currentSessionID())}
                          modelGroups={modelGroups}
                        />
                      }
                    />
                  }
                  reviewView={
                    <ChangesDock
                      sessionID={currentSessionID() || null}
                      diffs={mergedSessionDiffs()}
                      liveDiffs={store.session_diff?.[currentSessionID() ?? ""]}
                      onSendComment={(sid, text) => {
                        void window.api.mafw.sessions.promptAsync({ sessionID: sid, message: text })
                          .then(() => showToastV2({ description: "评论已发送给 agent", duration: 2000 } as any))
                          .catch((e: any) => showToastV2({ description: `发送失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 4000 } as any))
                      }}
                      onAddAnnotation={(a) => {
                        const sid = currentSessionID()
                        if (!sid) return
                        addPending({ sessionID: sid, ...a })
                        showToastV2({ description: "已加入批注", duration: 1600 } as any)
                      }}
                    />
                  }
                />
              </div>
            )}
          </Show>
        </div>
      </div>
      <Show when={activeQuestion()}>
        <QuestionWidget
          question={activeQuestion()!}
          onDismiss={() => setActiveQuestion(null)}
        />
      </Show>
      <Show when={showInspector()}>
        <EventInspector onClose={() => setShowInspector(false)} />
      </Show>
    </div>
            </DataProvider>
          </FileComponentProvider>
        </MarkedProvider>
      </DialogProvider>
  )
}

