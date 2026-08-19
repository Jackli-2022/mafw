// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from "solid-js"
import { createStore } from "solid-js/store"


import { Icon } from "@opencode-ai/ui/icon"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { ToastV2, showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { FileSSR } from "@opencode-ai/session-ui/file-ssr"
import { Rail } from "./components/Rail"
import { ChatPane, mergeLocalParts, type FlowCardRecord } from "./components/ChatPane"
import { SplitView, leafIds, leafCount, fillEmpty, removeLeaf, setRatio, splitLeaf, splitAtPath, replaceAtPath, removeSid, isSidLeaf, firstLeafPath, findSidPath, parentDirOf, splitWithTarget, zoneForPoint, zoneToDir, type SplitNode, type SplitLeaf, type DropZone } from "./components/SplitView"
import { SplitPlaceholder } from "./components/SplitPlaceholder"
import { TaskList } from "./components/TaskList"
import { RightDock } from "./components/RightDock"
import { TrajectoryDock } from "./components/TrajectoryDock"
import { PopoverShell } from "./components/pickers/PopoverShell"
import { TabStrip, type Tab } from "./components/TabStrip"
import { registerMafwToolCards } from "./components/MafwToolCards"
import { WelcomeHome } from "./components/WelcomeHome"
import { DashboardPage } from "./pages/Dashboard"
import { MemoryPage } from "./pages/Memory"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { TriagePage } from "./pages/TriagePage"
import { AutomationsPage } from "./pages/Automations"
import { ConfigPage } from "./pages/Config"
import { QuestionWidget, type QuestionData } from "./components/QuestionWidget"
import type { AskCardData } from "./components/AskCard"
import type { PermissionCardData } from "./components/PermissionCard"
import type { ModelEntry } from "./components/pickers/ModelPicker"
import type { AgentEntry } from "./components/pickers/AgentPicker"
import "./mafw.css"

interface ChatSession {
  id: string
  title: string
  userMsgId: string
  assistantMsgId: string | null
  done: boolean
  manager?: boolean
  metadata?: { mafw?: { role?: string } }
}
export function MafwShell() {
  const [activeTab, setActiveTab] = createSignal<Tab>("chat")
  const [showConfig, setShowConfig] = createSignal(false)
  const [gwStatus, setGwStatus] = createSignal<{ state: string; port: number | null } | null>(null)
  const [theme, setTheme] = createSignal<string | null>(null)

  // Model selection (shared across panes; recent-models persistence below)
  const [modelSel, setModelSel] = createSignal<{ providerID: string; modelID: string; label: string } | null>(null)

  // Reactive data store for SessionTurn (SolidJS store Proxy for fine-grained tracking)
  const [store, setStore] = createStore({
    session: [] as any[],
    session_status: {} as Record<string, any>,
    session_diff: {} as Record<string, any[]>,
    message: {} as Record<string, any[]>,
    part: {} as Record<string, any[]>,
  })

  // Question widget state
  const [activeQuestion, setActiveQuestion] = createSignal<QuestionData | null>(null)
  const [gatewayUrl, setGatewayUrl] = createSignal("")

  // Chat sessions (tabs)
  const [sessions, setSessions] = createSignal<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null)
  const [sessionRefreshKey, setSessionRefreshKey] = createSignal(0)

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
    console.log("[mafw] backToParent", childID, "->", parentID, "stack:", subagentStack[childID], "storeRec:", store.session.find((s: any) => s.id === childID))
    showToastV2({ description: `backToParent ${childID.slice(-8)} -> ${parentID ? parentID.slice(-8) : "NULL"}`, duration: 3000 })
    if (parentID) {
      setSubagentStack(childID, undefined as any)
      setActiveSessionId(parentID)
    }
  }

  // Startup welcome pane ("今天要做什么？"): shown on launch until the user
  // picks a session, creates one, or navigates into the chat.
  const [showWelcome, setShowWelcome] = createSignal(true)

  // All project sessions (for the split placeholder picker). Loaded once when
  // the gateway is ready; the Rail refreshes its own copy on sessionRefreshKey.
  const [historySessions, setHistorySessions] = createSignal<{ id: string; title?: string; time?: { updated?: number }; metadata?: { mafw?: { role?: string } } }[]>([])
  createEffect(() => {
    if (gwStatus()?.state !== "ready") return
    let cancelled = false
    window.api.mafw.sessions.list(currentProject() ?? undefined).then((list: any) => {
      if (cancelled) return
      setHistorySessions(Array.isArray(list) ? list : [])
    }).catch(() => { if (!cancelled) setHistorySessions([]) })
    onCleanup(() => { cancelled = true })
  })

  // Registered projects + current selection (welcome pane project switcher).
  const [projects, setProjects] = createSignal<{ id: string; worktree: string }[]>([])
  const [currentProject, setCurrentProject] = createSignal<string | null>(null)

  // Authoritative per-project manager session (from the gateway DB kv store).
  // Orphan/stale role=manager sessions from the pre-fix era are ignored.
  const [managerSessionId, setManagerSessionId] = createSignal<string | null>(null)
  createEffect(() => {
    const pd = currentProject()
    if (!pd) { setManagerSessionId(null); return }
    let cancelled = false
    window.api.mafw.manager.session(pd).then((info: any) => {
      if (!cancelled) setManagerSessionId(info?.sessionId || null)
    }).catch(() => { if (!cancelled) setManagerSessionId(null) })
    onCleanup(() => { cancelled = true })
  })
  createEffect(() => {
    if (gwStatus()?.state !== "ready") return
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

  // Open a session as a plain single-pane tab (no split view involvement).
  // Welcome-page entries (manager / new session / recent session) must never
  // create a split view — that only happens via explicit split actions.
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
  }

  // "Manager 会话": jump straight into the manager session. Prefers the
  // authoritative manager (gateway DB) and falls back to any role=manager
  // session in history.
  const handleOpenManager = async (): Promise<boolean> => {
    const authId = managerSessionId()
    const manager = (authId && historySessions().find(s => s.id === authId))
      || historySessions().find((s: any) => s?.metadata?.mafw?.role === "manager")
    if (!manager) {
      setActiveTab("goals")
      return false
    }
    openSessionTab(manager.id, manager.title || "Manager", true, manager.metadata)
    return true
  }
  // "新建 Goal": jump to the manager session and send a create-goal message.
  const handleNewGoal = async (description: string): Promise<boolean> => {
    if (!await handleOpenManager()) return false
    const manager = historySessions().find((s: any) => s?.metadata?.mafw?.role === "manager")
    if (!manager) return false
    const message = `创建新 Goal：${description}`
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

  // Lazy-load pagination state per session (older messages via `before` cursor)
  const [pageState, setPageState] = createStore<Record<string, { cursor: string | null; hasMore: boolean; loading: boolean }>>({})

  // Todo list per session (drives the TaskList; updated live via SSE todo.updated)
  const [todos, setTodos] = createStore<Record<string, any[]>>({})

  // ── Split views (tmux-window model) ──
  // SessionStrip shows one tab per session AND one tab per split view. A split
  // view is a multi-pane layout; clicking its tab shows it, clicking a session
  // tab shows that session as a single pane. Split views are session-local
  // only (never persisted; each launch starts fresh on the welcome page).
  type SplitViewRec = { id: string; title: string; layout: SplitNode | null }

  const loadSplitViews = (): SplitViewRec[] => {
    // Fresh start: never restore layouts across restarts. Clear any legacy
    // persisted keys once so stale data cannot resurface later.
    try {
      localStorage.removeItem("mafw-split-layout")
      localStorage.removeItem("mafw-split-layouts")
    } catch { /* ignore */ }
    return []
  }

  // Scroll anchors / sending-reset per session, keyed by sid. Used by
  // loadHistory to scroll the pane showing a session, and by the SSE lifecycle
  // to clear a pane's "stop" button state.
  const anchorRegistry: Record<string, () => void> = {}
  const sendingResetters: Record<string, () => void> = {}
  // mafw_media_speak 工具事件 → 对应会话 ChatPane 的流式播放回调
  const mediaSpeakHandlers: Record<string, (text: string, voice?: string) => void> = {}

  const [splitViews, setSplitViews] = createSignal<SplitViewRec[]>(loadSplitViews())
  const [activeViewId, setActiveViewId] = createSignal<string | null>(null)

  // Current split view record (when the active view is a split), else null.
  const activeSplitView = createMemo<SplitViewRec | null>(() => {
    const id = activeViewId()
    if (!id || !id.startsWith("split-")) return null
    return splitViews().find(v => v.id === id) ?? null
  })

  const persistSplitViews = (recs: SplitViewRec[]) => {
    setSplitViews(recs)
  }

  // Update the layout of the currently active split view.
  const updateCurrentLayout = (node: SplitNode | null) => {
    const id = activeViewId()
    if (!id || !id.startsWith("split-")) return
    setSplitViews(prev => prev.map(v => v.id === id ? { ...v, layout: node } : v))
  }

  // The effective tree: the active split view's layout, or a single leaf
  // following the active session.
  const currentTree = createMemo<SplitNode>(() => {
    const split = activeSplitView()
    if (split?.layout) return split.layout
    return activeSessionId() ? { sid: activeSessionId()! } : { empty: true }
  })

  // Register persisted split-pane sessions that are not yet in the local
  // session list so panes render titles and the strip shows them.
  createEffect(() => {
    const recs = splitViews()
    if (recs.length === 0) return
    for (const rec of recs) {
      if (!rec.layout) continue
      for (const sid of leafIds(rec.layout)) {
        if (sessions().some(s => s.id === sid)) continue
        const existing = store.session.find(s => s.id === sid)
        const title = existing?.title || historySessions().find(s => s.id === sid)?.title || `Chat ${sessions().length + 1}`
        setSessions(prev => prev.some(s => s.id === sid) ? prev : [...prev, {
          id: sid, title, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false,
        }])
        if (!existing) {
          setStore(prev => ({
            ...prev,
            session: [...prev.session, { id: sid, title, directory: ".", time: { created: Date.now() }, projectID: "." }],
            session_status: { ...prev.session_status, [sid]: { type: "idle" } },
            message: { ...prev.message, [sid]: [] },
          }))
        }
      }
    }
  })

  // Create a new split view tab (auto-numbered title) and switch to it.
  const createSplitView = (initial: SplitNode | null): string => {
    const nextId = `split-${Date.now()}`
    const n = splitViews().length + 1
    const rec: SplitViewRec = { id: nextId, title: `分屏 ${n}`, layout: initial }
    persistSplitViews([...splitViews(), rec])
    setActiveViewId(nextId)
    return nextId
  }

  const closeSplitView = (id: string) => {
    setSplitViews(prev => prev.filter(v => v.id !== id))
    if (activeViewId() === id) {
      const firstSession = sessions()[0]
      setActiveViewId(firstSession?.id ?? null)
    }
  }

  const renameSplitView = (id: string, title: string) => {
    setSplitViews(prev => prev.map(v => v.id === id ? { ...v, title } : v))
  }

  // Ensure a session is visible in the current view. In a split view, fill a
  // placeholder pane if one exists; in a single-session view it is already
  // shown (the view is that session).
  const ensureSessionVisible = (id: string) => {
    const split = activeSplitView()
    if (!split?.layout) return
    const tree = split.layout
    if (leafIds(tree).includes(id)) return
    if (leafCount(tree) === 1) {
      updateCurrentLayout({ sid: id })
      return
    }
    const filled = fillEmpty(tree, id)
    if (filled !== tree) updateCurrentLayout(filled)
  }

  /**
   * Unified split entry for operations INSIDE a split view (drag, placeholder
   * fill, pane close). Updates the active split view's layout; if no split view
   * is active, creates a new one.
   */
  const applySplit = (path: number[], dir: "h" | "v", place: "before" | "after", target: SplitLeaf) => {
    const split = activeSplitView()
    const tree = split?.layout ?? null
    if (!tree) {
      // No active split view: create one, splitting the single-session view.
      const base: SplitLeaf = activeSessionId() && sessions().some(s => s.id === activeSessionId())
        ? { sid: activeSessionId()! }
        : { empty: true }
      const a = place === "before" ? target : base
      const b = place === "after" ? target : base
      createSplitView({ dir, ratio: 0.5, a, b })
      if ("sid" in target) setActiveSessionId(target.sid)
      return
    }
    const next = splitWithTarget(tree, path, dir, place, target)
    if (next !== tree) {
      updateCurrentLayout(next)
      if ("sid" in target) setActiveSessionId(target.sid)
    }
  }

  /**
   * Four directional split options. Filtered by the no-same-direction rule:
   * children of an `h` split may only split vertically and vice versa; the
   * root (or a single-pane layout) is free. Returns [] when the 4-pane cap is
   * reached.
   */
  type DirOption = { dir: "h" | "v"; place: "before" | "after"; label: string; glyph: string }
  const ALL_FOUR: DirOption[] = [
    { dir: "h", place: "before", label: "向左分屏", glyph: "⇤" },
    { dir: "h", place: "after", label: "向右分屏", glyph: "⇥" },
    { dir: "v", place: "before", label: "向上分屏", glyph: "⇧" },
    { dir: "v", place: "after", label: "向下分屏", glyph: "⇩" },
  ]
  const directionOptions = (path: number[]): DirOption[] => {
    const split = activeSplitView()
    const tree = split?.layout ?? null
    if (!tree) return ALL_FOUR
    if (leafCount(tree) >= 4) return []
    const parentDir = parentDirOf(tree, path)
    if (parentDir === "h") return ALL_FOUR.filter(o => o.dir === "v")
    if (parentDir === "v") return ALL_FOUR.filter(o => o.dir === "h")
    return ALL_FOUR
  }

  // Direction options for a tab's session: no active split (or session absent
  // from it) → free four ways; otherwise governed by the parent split
  // direction of the pane holding it.
  const directionOptionsFor = (sid: string): DirOption[] => {
    const split = activeSplitView()
    const tree = split?.layout ?? null
    if (!tree) return ALL_FOUR
    if (leafCount(tree) >= 4) return []
    const sidPath = findSidPath(tree, sid)
    if (!sidPath) return ALL_FOUR // not on screen yet → treated as free
    return directionOptions(sidPath)
  }

  // Per-tab split (session tab ⿻ menu): create a NEW split view whose layout
  // is [the session | empty placeholder], then switch to it.
  const splitTab = (sid: string, dir: "h" | "v", place: "before" | "after") => {
    if (!sessions().some(s => s.id === sid)) return
    setShowWelcome(false)
    const base: SplitLeaf = { sid }
    const other: SplitLeaf = { empty: true }
    const layout: SplitNode = place === "before"
      ? { dir, ratio: 0.5, a: other, b: base }
      : { dir, ratio: 0.5, a: base, b: other }
    createSplitView(layout)
    setActiveSessionId(sid)
  }

  // Global split (⿻ button): create a NEW split view beside the focused
  // session, with an empty placeholder on the other side.
  const splitGlobal = (dir: "h" | "v", place: "before" | "after") => {
    setShowWelcome(false)
    const base: SplitLeaf = activeSessionId() && sessions().some(s => s.id === activeSessionId())
      ? { sid: activeSessionId()! }
      : { empty: true }
    const other: SplitLeaf = { empty: true }
    const layout: SplitNode = place === "before"
      ? { dir, ratio: 0.5, a: other, b: base }
      : { dir, ratio: 0.5, a: base, b: other }
    createSplitView(layout)
  }

  // Continue splitting inside an existing split view (its ⿻ button): split an
  // empty placeholder pane beside the focused pane, updating that view's
  // layout (no new split view tab).
  const continueSplitIn = (viewId: string, dir: "h" | "v", place: "before" | "after") => {
    const rec = splitViews().find(v => v.id === viewId)
    const tree = rec?.layout ?? null
    if (!tree) return
    const focusedPath = activeSessionId() ? findSidPath(tree, activeSessionId()!) : null
    const target = focusedPath ?? firstLeafPath(tree)
    const next = splitWithTarget(tree, target, dir, place, { empty: true })
    if (next !== tree) {
      setSplitViews(prev => prev.map(v => v.id === viewId ? { ...v, layout: next } : v))
      setActiveViewId(viewId)
    }
  }

  const closePane = (sid: string) => {
    const split = activeSplitView()
    const tree = split?.layout ?? null
    if (!tree) return
    const leaves = leafIds(tree)
    if (leaves.length <= 1) return
    const next = removeLeaf(tree, sid)
    updateCurrentLayout(next)
    if (activeSessionId() === sid) setActiveSessionId(leafIds(next)[0] || null)
  }

  // Close the pane at a tree path (used by placeholder panes, which have no sid).
  const closePaneAtPath = (path: number[]) => {
    const split = activeSplitView()
    const tree = split?.layout ?? null
    if (!tree) return
    if (leafCount(tree) <= 1) return
    const nodeAt = walkPath(tree, path)
    if (isSidLeaf(nodeAt)) {
      closePane(nodeAt.sid)
      return
    }
    // Remove the leaf at path: walk down, collapsing the vacated side.
    const remove = (n: SplitNode, idxs: number[]): SplitNode | null => {
      if (isLeaf(n)) return null // removing the leaf itself
      if (idxs.length === 0) return n
      const [head, ...rest] = idxs
      if (head !== 0 && head !== 1) return n
      const child = head === 0 ? n.a : n.b
      const next = remove(child, rest)
      if (next === null) {
        // This child collapsed away; keep the sibling.
        return head === 0 ? n.b : n.a
      }
      if (next === child) return n
      return head === 0 ? { ...n, a: next } : { ...n, b: next }
    }
    const next = remove(tree, path)
    if (next && next !== tree) {
      updateCurrentLayout(next)
      if (activeSessionId() && !leafIds(next).includes(activeSessionId()!)) {
        setActiveSessionId(leafIds(next)[0] || null)
      }
    }
  }

  // Ensure a session has a sessionstrip tab carrying its real title (a
  // placeholder fill can bring in a history session that is not in the tab
  // list yet, or a tab that was auto-created with a "Chat N" placeholder name).
  const ensureSessionTab = (sid: string) => {
    const title = historySessions().find(s => s.id === sid)?.title
      ?? store.session.find(s => s.id === sid)?.title
      ?? sessions().find(s => s.id === sid)?.title
    if (!sessions().some(s => s.id === sid)) {
      setSessions(prev => [...prev, {
        id: sid,
        title: title || `Chat ${sessions().length + 1}`,
        userMsgId: `user-${Date.now()}`,
        assistantMsgId: null,
        done: false,
      }])
      setStore(prev => {
        if (prev.session.some(s => s.id === sid)) return prev
        return {
          ...prev,
          session: [...prev.session, { id: sid, title: title || `Chat ${sessions().length + 1}`, directory: ".", time: { created: Date.now() }, projectID: "." }],
          session_status: { ...prev.session_status, [sid]: { type: "idle" } },
          message: { ...prev.message, [sid]: [] },
        }
      })
    } else if (title && !sessions().some(s => s.id === sid && s.title === title)) {
      setSessions(prev => prev.map(s => s.id === sid ? { ...s, title } : s))
    }
  }

  // Fill the first empty placeholder pane with a session. If no split view is
  // active, create one holding just that session.
  const fillPlaceholder = (sid: string) => {
    setShowWelcome(false)
    ensureSessionTab(sid)
    const split = activeSplitView()
    if (!split?.layout) {
      createSplitView({ sid })
      setActiveSessionId(sid)
      return
    }
    const tree = split.layout
    const next = fillEmpty(tree, sid)
    if (next !== tree) updateCurrentLayout(next)
    setActiveSessionId(sid)
  }

  const setSplitRatio = (path: number[], ratio: number) => {
    const split = activeSplitView()
    const tree = split?.layout ?? null
    if (!tree) return
    updateCurrentLayout(setRatio(tree, path, ratio))
  }

  // ── Split menu (Windows-style: explicit button + edge-drag) ──
  const [splitMenuFor, setSplitMenuFor] = createSignal<{ sid: string; el: HTMLElement | null } | null>(null)
  const [globalSplitMenu, setGlobalSplitMenu] = createSignal<{ el: HTMLElement | null } | null>(null)
  const [splitViewMenuFor, setSplitViewMenuFor] = createSignal<{ id: string; el: HTMLElement | null } | null>(null)
  const [splitPreview, setSplitPreview] = createSignal<{ path: number[]; zone: DropZone } | null>(null)

  const onTabDragStart = (e: DragEvent, sid: string) => {
    e.dataTransfer?.setData("text/mafw-sid", sid)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
  }

  const onLeafDragOver = (path: number[], e: DragEvent) => {
    // dragover 阶段 getData() 返回空（Chromium 安全限制）；用 types 判断来源。
    const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : []
    if (!types.some(t => t.includes("mafw-sid"))) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const zone = zoneForPoint(rect, x, y)
    // Idempotent update: dragover fires per mousemove; returning the previous
    // object reference when nothing changed stops SolidJS from re-rendering the
    // whole split tree on every pixel (which manifested as flicker).
    setSplitPreview(prev => {
      if (prev && prev.path.length === path.length && prev.path.every((v, i) => v === path[i]) && prev.zone === zone) {
        return prev
      }
      return { path, zone }
    })
  }

  const onLeafDrop = (path: number[], e: DragEvent) => {
    const sid = e.dataTransfer?.getData("text/mafw-sid")
    setSplitPreview(null)
    if (!sid) return
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const zone = zoneForPoint(rect, x, y)

    // Dragging in a single-session view: create a split view from it.
    if (!activeSplitView()?.layout) {
      const mapping0 = zoneToDir(zone)
      if (!mapping0) {
        // Drop on the only pane's center in single view → just switch view.
        setActiveViewId(sid)
        return
      }
      applySplit([], mapping0.dir, mapping0.place, { sid })
      return
    }

    const tree = currentTree()
    const ids = leafIds(tree)
    const alreadyOpen = ids.includes(sid)

    // Dragging a session onto its own current pane → no-op.
    const targetOwn = (() => {
      const nodeAt = walkPath(tree, path)
      return isSidLeaf(nodeAt) && nodeAt.sid === sid
    })()

    // Move semantics: remove the old position first, then insert at target.
    // removeSid collapses the tree, which may invalidate `path` when the removed
    // leaf sat in the same branch as the target pane. A path is only valid if
    // every step stays inside the tree (never hits a leaf early).
    const removal = alreadyOpen ? removeSid(tree, sid) : null
    const base = removal ? removal.tree : tree
    const pathDrifted = removal?.removed ? !isValidPath(base, path) : false
    // When the target pane itself was the removed leaf, targetOwn already
    // returned above; a drifted path means the target pane collapsed away.

    const mapping = zoneToDir(zone)
    if (!mapping) {
      // center → replace this pane's content with the dragged session.
      if (alreadyOpen && targetOwn) return
      if (leafCount(base) === 1) {
        // The whole view collapsed to a single pane → it becomes the dragged
        // session (the replaced pane's content already went back to tabs).
        updateCurrentLayout({ sid })
        setActiveSessionId(sid)
        return
      }
      const target = pathDrifted ? firstLeafPath(base) : path
      const final = replaceAtPath(base, target, sid)
      if (final !== base) {
        updateCurrentLayout(final)
        setActiveSessionId(sid)
      }
      return
    }

    const { dir, place } = mapping
    if (targetOwn) return // dropping onto its own pane edge does nothing
    // No-same-direction nesting rule: a drag that would nest the same
    // direction (h inside h, v inside v) is rejected with a hint.
    const layout = activeSplitView()?.layout ?? null
    if (layout) {
      const parentDir = parentDirOf(layout, path)
      if (parentDir === dir) {
        showToastV2({ description: "不允许同向嵌套分屏（父 pane 已是该方向）", duration: 3000 })
        return
      }
    }
    if (leafCount(base) === 1) {
      // Old position collapsed to a single pane → split it in the chosen
      // direction with the dragged session on the selected side.
      const leaf = base
      const next = place === "before"
        ? { dir, ratio: 0.5, a: { sid } as SplitLeaf, b: leaf }
        : { dir, ratio: 0.5, a: leaf, b: { sid } as SplitLeaf }
      updateCurrentLayout(next)
      setActiveSessionId(sid)
      return
    }
    const target = pathDrifted ? firstLeafPath(base) : path
    const next = splitAtPath(base, target, dir, sid, place)
    if (next !== base) {
      updateCurrentLayout(next)
      setActiveSessionId(sid)
    }
  }

  // Walk the split tree along a path to the node (leaf or internal).
  const walkPath = (root: SplitNode, path: number[]): SplitNode => {
    let node = root
    for (const idx of path) {
      if (isLeaf(node)) break
      node = idx === 0 ? node.a : node.b
    }
    return node
  }

  // A path is valid if every step descends into the tree (never hits a leaf
  // before the path is exhausted). Used to detect paths invalidated by the
  // tree collapsing after removeSid.
  const isValidPath = (root: SplitNode, path: number[]): boolean => {
    let node = root
    for (const idx of path) {
      if (isLeaf(node)) return false
      node = idx === 0 ? node.a : node.b
    }
    return true
  }

  // AskCard / PermissionCard per session (in-chat flow cards)
  const [flowCards, setFlowCards] = createSignal<Record<string, FlowCardRecord[]>>({})

  const upsertCard = (sid: string, rec: FlowCardRecord) => {
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

  const actionTypeOf = (permission: string): { type: string; title: string } => {
    const p = permission.toLowerCase()
    if (p.includes("bash") || p.includes("shell") || p.includes("terminal") || p.includes("command")) {
      return { type: "shell", title: "执行 Shell 命令" }
    }
    if (p.includes("unlink") || p.includes("delete")) return { type: "file-delete", title: "删除文件" }
    if (p.includes("write") || p.includes("edit")) return { type: "file-write", title: "写入文件" }
    if (p.includes("network") || p.includes("webfetch") || p.includes("http")) return { type: "network", title: "访问网络" }
    return { type: "custom", title: permission }
  }

  const riskOf = (permission: string, patterns: string[]): "medium" | "high" => {
    const p = permission.toLowerCase()
    const joined = patterns.join(" ").toLowerCase()
    if (p.includes("unlink") || p.includes("delete")) return "high"
    if (p.includes("bash") && /\b(rm|del|format)\b/.test(joined)) return "high"
    return "medium"
  }

  const dangerousPartsOf = (permission: string, patterns: string[]): string[] => {
    const parts: string[] = []
    for (const pat of patterns) {
      if (/\b(rm|del|format|mv|dd)\b/.test(pat.toLowerCase())) parts.push(pat)
    }
    return parts
  }

  const mapAskCard = (req: any, createdAt: number): AskCardData => ({
    id: req.id,
    sessionID: req.sessionID,
    agentName: sessions().find(s => s.id === req.sessionID)?.title || "Agent",
    status: "pending",
    createdAt,
    messageID: req.tool?.messageID,
    questions: (req.questions || []).map((q: any, i: number) => ({
      id: `${req.id}-q${i}`,
      title: q.question,
      mode: q.multiple ? "multi" : "single",
      options: (q.options || []).map((o: any) => ({ id: o.label, title: o.label, description: o.description })),
      allowCustom: q.custom !== false,
    })),
  })

  const mapPermissionCard = (req: any, createdAt: number): PermissionCardData => {
    const patterns = Array.isArray(req.patterns) ? req.patterns : []
    const { type, title } = actionTypeOf(req.permission)
    return {
      id: req.id,
      sessionID: req.sessionID,
      agentName: sessions().find(s => s.id === req.sessionID)?.title || "Agent",
      status: "pending",
      risk: riskOf(req.permission, patterns),
      action: {
        type,
        title,
        payload: patterns.join(" && ") || req.permission,
        dangerousParts: dangerousPartsOf(req.permission, patterns),
      },
      impact: req.metadata?.impact as string | undefined,
      createdAt,
      messageID: req.tool?.messageID,
    }
  }

  const answersToRecord = (answers: string[][], sid: string, cardId: string): Record<string, string[]> => {
    const rec: Record<string, string[]> = {}
    const card = flowCards()[sid]?.find(c => c.data.id === cardId)
    if (!card || card.kind !== "ask") return rec
    card.data.questions.forEach((q, i) => { rec[q.id] = answers[i] || [] })
    return rec
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

  const permReply = async (card: PermissionCardData, reply: "once" | "always" | "reject", message?: string) => {
    try {
      await window.api.mafw.permissions.reply(card.id, reply, message)
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
    return n
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
    // Use the modern session-ui rendering branch (rounded bubbles, v2 tokens).
    document.body.setAttribute("data-new-layout", "")
  })

  // Theme: MafwShell owns documentElement.dataset.theme (the theme preload
  // unconditionally sets "oc-2", which would otherwise dead-code the CSS
  // follow-system media block). A saved 'light'/'dark' override wins; otherwise
  // delete the marker and keep data-color-scheme (the v2 gate) synced to the OS
  // via matchMedia so chrome and session-ui flip together.
  onMount(() => {
    const root = document.documentElement
    const saved = localStorage.getItem('mafw-theme')
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    if (saved === 'light' || saved === 'dark') {
      root.dataset.theme = saved
      root.dataset.colorScheme = saved
      setTheme(saved)
    } else {
      delete root.dataset.theme
      root.dataset.colorScheme = mq.matches ? 'light' : 'dark'
      const onMq = () => {
        const cur = localStorage.getItem('mafw-theme')
        if (cur === 'light' || cur === 'dark') return
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
    const next = cur === 'light' ? 'dark' : 'light'
    root.dataset.theme = next
    root.dataset.colorScheme = next
    localStorage.setItem('mafw-theme', next)
    setTheme(next)
  }

  // Direct EventSource SSE connection (renderer has native EventSource)
  onMount(async () => {
    const info = await window.api.mafw.gateway.info()
    if (!info?.url) {
      console.log("[mafw] SSE: no gateway URL yet")
      return
    }
    console.log("[mafw] SSE connecting to", info.url)
    setGatewayUrl(info.url)
    const es = new EventSource(`${info.url}/api/events`)
    es.onopen = () => console.log("[mafw] SSE connected")
    // Seed flow cards that arrived before the SSE connection (native APIs return pending only).
    window.api.mafw.permissions.list().then((items: any[]) => {
      for (const req of items || []) upsertCard(req.sessionID, { kind: "permission", data: mapPermissionCard(req, Date.now()) })
    }).catch(e => console.warn("[mafw] permissions.list seed:", e))
    window.api.mafw.questions.list().then((items: any[]) => {
      for (const req of items || []) upsertCard(req.sessionID, { kind: "ask", data: mapAskCard(req, Date.now()) })
    }).catch(e => console.warn("[mafw] questions.list seed:", e))
    es.onmessage = (e: MessageEvent) => {
      let raw: any
      try { raw = JSON.parse(e.data) } catch { return }
      const event = raw?.data || raw
      if (!event) return

      if (event.type === "user_question") {
        console.log("[mafw] SSE user_question", event.goalId, event.questionId)
        setActiveQuestion(event as QuestionData)
        return
      }

      // sessionID may be top-level (gateway-normalized) or nested in opencode event properties
      const sid = event?.sessionID
        || event?.properties?.sessionID
        || event?.properties?.part?.sessionID
        || event?.properties?.info?.sessionID
        || ""
      if (!sid) return

      // Flow cards: native question / permission requests (AskCard / PermissionCard)
      if (event.type === "question.asked") {
        console.log("[mafw] SSE question.asked", sid, event.properties?.id)
        upsertCard(sid, { kind: "ask", data: mapAskCard(event.properties || {}, Date.now()) })
        return
      }
      if (event.type === "permission.asked") {
        console.log("[mafw] SSE permission.asked", sid, event.properties?.id, event.properties?.permission)
        upsertCard(sid, { kind: "permission", data: mapPermissionCard(event.properties || {}, Date.now()) })
        return
      }
      if (event.type === "question.replied") {
        const props = event.properties || {}
        const id = props.requestID || props.id
        const answers = props.answers || []
        if (id) resolveCard(sid, id, { status: "answered", answers: answersToRecord(answers, sid, id) })
        return
      }
      if (event.type === "question.rejected") {
        const props = event.properties || {}
        const id = props.requestID || props.id
        if (id) resolveCard(sid, id, { status: "cancelled" })
        return
      }
      if (event.type === "permission.replied") {
        const props = event.properties || {}
        const id = props.requestID || props.id
        if (id) {
          const reply = props.reply
          resolveCard(sid, id, { status: reply === "always" ? "allowed-always" : reply === "reject" ? "denied" : "allowed-once" })
        }
        return
      }

      if (event.type === "trajectory.event") {
        if (!sid) return
        const props = (event as any).properties || (raw as any).data?.properties || {}
        const prev = trajectoryLive()[sid] || []
        // dedup by (turnID, seq); seq may be number or string across sources
        if (!prev.some((e: any) => String(e.turnID ?? e.turn_id ?? 0) === String(props.turnID ?? props.turn_id ?? 0) && String(e.seq ?? 0) === String(props.seq ?? 0))) {
          setTrajectoryLive({ ...trajectoryLive(), [sid]: [...prev, props] })
        }
        return
      }
      if (event.type === "trajectory.turn") {
        if (!sid) return
        const props = (event as any).properties || {}
        setTrajectoryTurnLive({ ...trajectoryTurnLive(), [sid]: props })
        return
      }

      if (event.type === "todo.updated") {
        const list = event.properties?.todos
        if (Array.isArray(list)) setTodos(sid, list)
        return
      }
      if (event.type === "message.updated") {
        const info = event.properties?.info
        if (!info?.id || !info?.role) return
        const msgId = info.id
        if (info.role === "user") {
          // Replace the optimistic user message (id `user-...`) with the real
          // opencode message id so the turn anchor matches assistant parentIDs
          // and part messageIDs.
          setStore(prev => {
            const msgs = { ...prev.message }
            const sessionMsgs = [...(msgs[sid] || [])]
            if (sessionMsgs.find(m => m.id === msgId)) return prev
            const optIdx = sessionMsgs.findIndex(m => m.role === "user" && m.id.startsWith("user-"))
            if (optIdx >= 0) {
              const opt = sessionMsgs[optIdx]
              sessionMsgs[optIdx] = { ...info, id: msgId, sessionID: sid, time: info.time || opt.time || { created: Date.now() } }
              for (const m of sessionMsgs) {
                if (m.parentID === opt.id) m.parentID = msgId
              }
              msgs[sid] = sessionMsgs
              const parts = { ...prev.part }
              if (parts[opt.id]) {
                parts[msgId] = (parts[msgId] || []).concat(parts[opt.id].map(p => ({ ...p, sessionID: sid, messageID: msgId })))
                delete parts[opt.id]
              }
              return { ...prev, message: msgs, part: parts }
            }
            sessionMsgs.push({ ...info, id: msgId, sessionID: sid, time: info.time || { created: Date.now() }, parts: [] })
            msgs[sid] = sessionMsgs
            return { ...prev, message: msgs }
          })
          setSessions(prev => prev.map(s => s.id === sid ? { ...s, userMsgId: msgId } : s))
        } else if (info.role === "assistant") {
          setStore(prev => {
            const msgs = { ...prev.message }
            const sessionMsgs = [...(msgs[sid] || [])]
            if (sessionMsgs.find(m => m.id === msgId)) return prev
            const pm = info.parentID || sessions().find(s => s.id === sid)?.userMsgId || null
            sessionMsgs.push({ ...info, id: msgId, sessionID: sid, parentID: pm, time: info.time || { created: Date.now() }, parts: [] })
            msgs[sid] = sessionMsgs
            return { ...prev, message: msgs }
          })
        }
        return
      }
      if (event.type === "message.part.updated") {
        const part = event.payload?.part || event.properties?.part
        if (!part) return
        const msgId = part.messageID
        if (!msgId) return
        console.log("[mafw] SSE part:", part.type, "partId:", part.id, "msgId:", msgId, "len:", (part.text || "").length, (part.text || "").slice(0, 60))

        setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: { type: "busy" } } }))

        setStore(prev => {
          const parts = { ...prev.part }
          const existing = parts[msgId] || []
          const partObj = { ...part, id: part.id || `${msgId}-${part.type}`, sessionID: sid, messageID: msgId }
          let idx = existing.findIndex(p => p.id === partObj.id)
          if (idx < 0 && part.type === "text") {
            // absorb the optimistic user text part (id `user-...-text`) when the
            // real user part with identical text arrives
            idx = existing.findIndex(p => p.type === "text" && p.id.startsWith("user-") && (p.text || "") === (part.text || ""))
          }
          parts[msgId] = idx >= 0
            ? existing.map((p, i) => (i === idx ? { ...p, ...partObj } : p))
            : [...existing, partObj]
          return { ...prev, part: parts }
        })
      } else if (event.type === "message.complete") {
        setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: { type: "idle" } } }))
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, done: true } : s))
        sendingResetters[sid]?.()
        expireSessionCards(sid)
      } else if (event.type === "message.part.complete") {
        setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: { type: "idle" } } }))
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, done: true } : s))
        sendingResetters[sid]?.()
      } else if (event.type === "message.error" || event.type === "message.aborted") {
        setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: { type: "idle" } } }))
        sendingResetters[sid]?.()
        expireSessionCards(sid)
      }

      if (event.type?.startsWith("session.next.tool.") && event.assistantMessageID) {
        const msgId = event.assistantMessageID
        setStore(prev => {
          const msgs = { ...prev.message }
          const sessionMsgs = [...(msgs[sid] || [])]
          if (!sessionMsgs.find(m => m.id === msgId)) {
            const pm = sessions().find(s => s.id === sid)?.userMsgId || null
            sessionMsgs.push({ id: msgId, sessionID: sid, role: "assistant", parentID: pm, time: { created: Date.now() }, parts: [] })
            msgs[sid] = sessionMsgs
          }
          return { ...prev, message: msgs }
        })
      }

      // mafw_media_speak 工具事件 → 流式 TTS 播放（合成即出声，与回复生成并行）。
      // 参数字段多形态兼容：input（opencode tool part 标准字段）优先，args 保留兼容。
      const toolName = event.properties?.tool || event.properties?.info?.tool || event.info?.tool || (event.properties?.part as any)?.tool
      if (toolName === "mafw_media_speak" && sid) {
        const propsArgs = event.properties?.input || event.properties?.info?.input || event.properties?.part?.input
          || event.properties?.args || event.properties?.info?.args || event.info?.args
        let text = typeof propsArgs?.text === "string" ? propsArgs.text : ""
        let voice = typeof propsArgs?.voice === "string" ? propsArgs.voice : undefined
        if (!text) {
          // 兜底：从 store 里该 assistant 消息的 tool part 提取（part 结构 { type, tool, input }）
          const msgId = event.assistantMessageID
          const parts = msgId ? (store.part[msgId] || []) : []
          for (const p of parts) {
            if (p?.type === "tool" && (p.tool === "mafw_media_speak" || p.tool === "mafw_speak")) {
              text = typeof p.input?.text === "string" ? p.input.text : ""
              voice = typeof p.input?.voice === "string" ? p.input.voice : voice
              break
            }
          }
        }
        console.log("[mafw] media_speak event:", event.type, "| toolName:", toolName, "| text len:", text.length, "| voice:", voice)
        console.log("[mafw] media_speak raw:", JSON.stringify(raw).slice(0, 600))
        if (text) mediaSpeakHandlers[sid]?.(text, voice)
      }
    }
    es.onerror = () => { console.log("[mafw] SSE error (will auto-reconnect)") }
    onCleanup(() => { console.log("[mafw] SSE closing"); es.close() })
  })

  // Load history when active session changes (skip if already loaded)
  createEffect(() => {
    const sid = activeSessionId()
    if (!sid) return
    if (store.message[sid]?.length > 0) return
    loadSessionHistory(sid)
  })

  // Load session message history from the gateway
  async function loadSessionHistory(sessionID: string) {
    console.log("[mafw] loadSessionHistory", sessionID)
    try {
      const [data, sessionData] = await Promise.all([
        window.api.mafw.sessions.messages(sessionID, 100) as any,
        window.api.mafw.sessions.get(sessionID).catch(() => null),
      ]) as [any, any]
      // Fetch the todo list for the TaskList (also updated live via SSE)
      window.api.mafw.sessions.todo(sessionID).then((t: any) => {
        const arr = Array.isArray(t) ? t : t?.data
        if (Array.isArray(arr)) setTodos(sessionID, arr)
      }).catch(() => {})
      const rawItems = Array.isArray(data) ? data : data?.data
      const nextCursor = data?.nextCursor ?? null
      console.log("[mafw] loadSessionHistory result:", rawItems?.length ? `${rawItems.length} messages` : 'no data')
      if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        setPageState(sessionID, { cursor: nextCursor, hasMore: !!nextCursor, loading: false })
        return
      }

      // Merge with any existing in-store messages by id (preserve object identity so
      // <For>-keyed SessionTurn list doesn't fully remount on reload; avoids clobbering
      // live SSE / optimistic messages that arrived while the fetch was in flight).
      const rawExisting = store.message[sessionID]
      const existing = Array.isArray(rawExisting) ? rawExisting : []
      if (!Array.isArray(rawExisting)) console.warn("[mafw] store.message non-array for", sessionID, typeof rawExisting)
      const existingById = new Map(existing.map(m => [m.id, m]))
      const msgs: any[] = [...existing]
      const parts: Record<string, any[]> = {}
      for (const item of rawItems) {
        const info = item.info || item
        const msgId = info.id || `msg-${Date.now()}-${Math.random()}`
        if (existingById.has(msgId)) continue
        // Preserve all API fields — spread entire info object
        const msg = { ...info, id: msgId, sessionID, time: info.time || { created: Date.now() } }
        msgs.push(msg)
        let itemParts = Array.isArray(item.parts) ? item.parts : (Array.isArray(info.parts) ? info.parts : [])
        if (Array.isArray(itemParts) && itemParts.length > 0) {
          parts[msgId] = mergeLocalParts(store.part[msgId], itemParts.map((p: any) => ({ ...p, id: p.id || `p-${Date.now()}-${Math.random()}`, sessionID, messageID: msgId })))
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
        // Set userMsgId to the first user message
        const userMsg = msgs.find(m => m.role === "user")
        if (userMsg) {
          setSessions(prev => prev.map(s => s.id === sessionID ? { ...s, userMsgId: userMsg.id } : s))
          console.log("[mafw] set userMsgId:", userMsg.id, "found in msgs:", msgs.some(m => m.id === userMsg.id))
        } else {
          console.warn("[mafw] no user message found, first msg role:", msgs[0]?.role, "id:", msgs[0]?.id)
        }
        setTimeout(() => {
          const msgCount = store.message[sessionID]?.length || 0
          const partKeys = Object.keys(store.part).length
          console.log("[mafw] store verify - msgs:", msgCount, "partKeys:", partKeys, "sid:", sessionID, "sidExists:", !!store.message[sessionID])
        }, 100)
        setPageState(sessionID, { cursor: nextCursor, hasMore: !!nextCursor, loading: false })
        anchorRegistry[sessionID]?.()
      }
    } catch (e) { console.warn("[mafw] loadHistory failed", e); showToastV2({ description: "Failed to load session history", duration: 5000 }) }
  }

  // Active session
  const active = () => sessions().find(s => s.id === activeSessionId()) || null

  async function createSession(opts?: { noReveal?: boolean }) {
    console.log("[mafw] createSession")
    setShowWelcome(false)
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
      setSessionRefreshKey(k => k + 1)
      if (!opts?.noReveal) {
        setActiveViewId(id)
        ensureSessionVisible(id)
      }
      return id
    } catch {
      const id = `local-${Date.now()}`
      setSessions(prev => [...prev, { id, title: `Chat ${sessions().length + 1}`, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false }])
      setActiveSessionId(id)
      setSessionRefreshKey(k => k + 1)
      if (!opts?.noReveal) {
        setActiveViewId(id)
        ensureSessionVisible(id)
      }
      return id
    }
  }

  function closeSession(id: string) {
    setSessions(prev => prev.filter(s => s.id !== id))
    const wasActive = activeSessionId() === id
    const wasActiveView = activeViewId() === id
    // Remove the session from every split view's layout.
    let changed = false
    setSplitViews(prev => prev.map(v => {
      if (!v.layout || !leafIds(v.layout).includes(id)) return v
      changed = true
      const next = removeLeaf(v.layout, id)
      return { ...v, layout: next }
    }))
    if (changed) {
      setSessionRefreshKey(k => k + 1)
    }
    if (wasActiveView) {
      // The active view was that session → fall back to another session or a split.
      const firstSplit = splitViews()[0]
      const firstSession = sessions()[0]
      setActiveViewId(firstSplit?.id ?? firstSession?.id ?? null)
    } else if (wasActive) {
      const remaining = sessions().filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
    setSessionRefreshKey(k => k + 1)
  }

  // Interrupt the in-flight conversation (ESC / Ctrl+C / stop button) lives in
  // ChatPane per-pane now.

  // Current rendering state for SessionTurn
  const currentSessionID = () => active()?.id || ""

  // Composer menus: agents (@ mention) + providers/models (model pill)
  const gwReadyForMenus = createMemo(() => gwStatus()?.state === "ready")
  const [agentsData, setAgentsData] = createSignal<any[]>([])
  const [providersData, setProvidersData] = createSignal<any>(null)
  createEffect(() => {
    if (!gwReadyForMenus()) return
    window.api.mafw.agents.list().then((list: any[]) => {
      setAgentsData(Array.isArray(list) ? list : [])
    }).catch(e => console.warn("[mafw] agents.list:", e))
    window.api.mafw.providers.list().then((p: any) => {
      setProvidersData(p)
      // Default the model pill to the most recently used model (first entry of
      // localStorage mafw-recent-models) — only when the user hasn't picked one.
      if (modelSel() === null) {
        try {
          const recent: string[] = JSON.parse(localStorage.getItem("mafw-recent-models") || "[]")
          const first = recent[0]
          if (first) {
            const connected = new Set(p?.connected || [])
            const findModel = (prov: any, mid: string) => {
              if (!connected.has(prov.id)) return null
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
              // Legacy plain id: match the first connected provider that has it
              for (const prov of p?.all || []) {
                found = findModel(prov, first)
                if (found) break
              }
            }
            if (found) setModelSel(found)
          }
        } catch { /* ignore */ }
      }
    }).catch(e => console.warn("[mafw] providers.list:", e))
  })

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
    const connected = new Set(p?.connected || [])
    const all = p?.all || []
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

  // ── Pickers: agent selection (shared), per-pane picker state lives in ChatPane ──
  const [agentSel, setAgentSel] = createSignal<AgentEntry | null>(null)
  const [switchLogs, setSwitchLogs] = createSignal<Record<string, string[]>>({})
  const [taskListOpen, setTaskListOpen] = createSignal(false)
  const [tasksPlacement, setTasksPlacement] = createSignal<"bar" | "dock">(
    (localStorage.getItem("mafw-tasks-placement") as "bar" | "dock") || "bar"
  )
  const [viewportNarrow, setViewportNarrow] = createSignal(window.innerWidth < 1200)
  const [titlebarRef, setTitlebarRef] = createSignal<HTMLElement | null>(null)
  // Anchor for the TaskList popover: the titlebar of the pane whose TaskBar the
  // user clicked (per-pane; the shared titlebarRef is unreliable in splits).
  const [taskAnchor, setTaskAnchor] = createSignal<HTMLElement | null>(null)
  // Session whose todos the TaskList popover shows (per-pane, so a split pane's
  // TaskBar never shows the active session's tasks).
  const [taskListSid, setTaskListSid] = createSignal<string | null>(null)
  const [dockRef, setDockRef] = createSignal<HTMLDivElement | null>(null)

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

  // ── Unified right dock (tasks / trajectory tabs) ──
  const [rightDockOpen, setRightDockOpen] = createSignal(localStorage.getItem("mafw-right-dock-open") === "1")
  const [rightDockTab, setRightDockTab] = createSignal<"tasks" | "trajectory">(
    (localStorage.getItem("mafw-right-dock-tab") as "tasks" | "trajectory") || "tasks"
  )
  const [rightDockWidth, setRightDockWidth] = createSignal(Number(localStorage.getItem("mafw-right-dock-width")) || 320)

  const applyRightDock = (open: boolean, tab?: "tasks" | "trajectory") => {
    setRightDockOpen(open)
    if (tab !== undefined) setRightDockTab(tab)
    try { localStorage.setItem("mafw-right-dock-open", open ? "1" : "0") } catch {}
    if (tab !== undefined) { try { localStorage.setItem("mafw-right-dock-tab", tab) } catch {} }
  }
  const applyRightDockWidth = (w: number) => {
    setRightDockWidth(w)
    try { localStorage.setItem("mafw-right-dock-width", String(w)) } catch {}
  }

  // SSE live trajectory signals
  const [trajectoryLive, setTrajectoryLive] = createSignal<Record<string, any[]>>({})
  const [trajectoryTurnLive, setTrajectoryTurnLive] = createSignal<Record<string, any>>({})

  const [railCollapsed, setRailCollapsed] = createSignal(localStorage.getItem("mafw-rail-collapsed") === "1")
  const [railWidth, setRailWidth] = createSignal(Number(localStorage.getItem("mafw-rail-width")) || 264)

  const applyRailCollapsed = (c: boolean) => {
    setRailCollapsed(c)
    try { localStorage.setItem("mafw-rail-collapsed", c ? "1" : "0") } catch { /* ignore */ }
  }
  const applyRailWidth = (w: number) => {
    setRailWidth(w)
    try { localStorage.setItem("mafw-rail-width", String(w)) } catch { /* ignore */ }
  }

  const applyTasksPlacement = (p: "bar" | "dock") => {
    setTasksPlacement(p)
    try { localStorage.setItem("mafw-tasks-placement", p) } catch { /* ignore */ }
  }

  // Narrow-viewport overlay: right dock + legacy dock fallback.
  createEffect(() => {
    if (!(rightDockOpen() && viewportNarrow())) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") applyRightDock(false)
    }
    const onDown = (e: MouseEvent) => {
      const el = dockRef()
      if (el && el.contains(e.target as Node)) return
      applyRightDock(false)
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDown)
    onCleanup(() => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDown)
    })
  })
  createEffect(() => {
    if (!(tasksPlacement() === "dock" && viewportNarrow())) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") applyTasksPlacement("bar")
    }
    const onDown = (e: MouseEvent) => {
      const el = dockRef()
      if (el && el.contains(e.target as Node)) return
      applyTasksPlacement("bar")
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDown)
    onCleanup(() => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDown)
    })
  })

  // Ctrl/Cmd+J: toggle task list (bar) / return to bar (dock). Skip when typing.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "j") return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      e.preventDefault()
      if (tasksPlacement() === "dock") applyTasksPlacement("bar")
      else setTaskListOpen(o => !o)
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

  // Dock → overlay under 1200px viewport (storage unchanged).
  createEffect(() => {
    const onResize = () => setViewportNarrow(window.innerWidth < 1200)
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  const subagentRunning = (id: string) => store.session_status[id]?.type === "busy"

  const onModelSelect = (m: ModelEntry) => {
    setModelSel({ providerID: m.providerID, modelID: m.id, label: m.name })
  }

  // Manager sessions are locked to the manager agent — switching to another
  // primary agent is not allowed there.
  const isManagerSession = createMemo(() => active()?.manager === true)

  const applyAgentSwitch = (a: AgentEntry) => {
    setAgentSel(a)
    const sid = currentSessionID()
    if (sid) {
      setSwitchLogs(prev => ({ ...prev, [sid]: [...(prev[sid] || []), `已切换到 ${a.name}`] }))
    }
  }

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
  onMount(async () => {
    const info = await window.api.mafw.gateway.info()
    setGwStatus(info)
    const unsub = window.api.mafw.gateway.onStateChange(s => setGwStatus(s))
    onCleanup(unsub)
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
              <div class="mafw-shell">
      <ToastV2.Region />
      <div class="mafw-titlebar">
        <Icon name="logo" size="small" />
        <span style={{ "font-size": 13, "font-weight": 600, color: "var(--text-2)" }}>MAFW</span>
        <div class="mafw-titlebar-dot" classList={{
          ready: gwStatus()?.state === "ready",
          starting: gwStatus()?.state === "starting",
          failed: gwStatus()?.state === "failed",
          stopped: !gwStatus() || gwStatus()?.state === "stopped",
        }} style={{ "margin-left": 4 }} />
        <TooltipV2 value="切换主题" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" class="mafw-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme() === 'light' ? '☀' : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M11.2 8.9A5 5 0 1 1 5.1 2.8a4 4 0 0 0 6.1 6.1Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            )}
          </ButtonV2>
        </TooltipV2>
        <div style={{ flex: 1 }} />
      </div>
      <div class="mafw-body" style={{ "grid-template-columns": `${railCollapsed() ? 32 : railWidth()}px 1fr ${rightDockOpen() && !viewportNarrow() ? `${rightDockWidth()}px` : "0px"}` }}>
        {railCollapsed() ? (
          <div class="mafw-rail-collapsed">
            <ButtonV2 variant="ghost" size="small" class="mafw-rail-expand" onClick={() => applyRailCollapsed(false)} aria-label="展开侧边栏">
              <span>▶</span>
            </ButtonV2>
          </div>
        ) : (
          <div class="mafw-rail-wrap" style={{ width: `${railWidth()}px` }}>
            <Rail activeSessionId={activeSessionId()} sessionRefreshKey={sessionRefreshKey()} managerSessionId={managerSessionId()} onSelectSession={(id, title, manager) => {
              setShowConfig(false)
              setActiveTab("chat")
              setShowWelcome(false)
              // Ensure session exists in local tabs and store
              if (!sessions().find(s => s.id === id)) {
                const tabTitle = title || `Chat ${sessions().length + 1}`
                setSessions(prev => [...prev, { id, title: tabTitle, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false, manager }])
                setStore(prev => ({
                  ...prev,
                  session: [...prev.session, { id, title: tabTitle, directory: ".", time: { created: Date.now() }, projectID: "." }],
                  session_status: { ...prev.session_status, [id]: { type: "idle" } },
                  message: { ...prev.message, [id]: [] },
                }))
              }
              setActiveSessionId(id)
              setActiveViewId(id)
            }} onSettings={() => setShowConfig(true)} onToggleCollapsed={() => applyRailCollapsed(true)} />
            <ResizeHandle
              direction="horizontal"
              edge="end"
              size={railWidth()}
              min={180}
              max={400}
              collapseThreshold={120}
              onResize={applyRailWidth}
              onCollapse={() => applyRailCollapsed(true)}
            />
          </div>
        )}
        <div class="mafw-main">
          {!showConfig() && <TabStrip active={activeTab()} onChange={t => { setActiveTab(t); setShowConfig(false) }} counts={{ approvals: pendingPermissionCount() }} onOpenTrajectory={() => applyRightDock(!rightDockOpen(), "trajectory")} trajectoryActive={rightDockOpen() && rightDockTab() === "trajectory"} />}
          <div class="mafw-content" classList={{ "mafw-chat-content": activeTab() === "chat" }}>
            {showConfig() ? (
              <ConfigPage onBack={() => setShowConfig(false)} />
            ) : activeTab() === "chat" ? (
              <div class="mafw-chat">
                {/* SessionStrip */}
                <div class="mafw-sessionstrip">
                  {sessions().map(s => (
                    <ContextMenu>
                      <ContextMenu.Trigger
                        as="div"
                        class="mafw-session-tab"
                        classList={{ active: activeViewId() === s.id }}
                        draggable
                        onDragStart={e => onTabDragStart(e, s.id)}
                        onDragEnd={() => setSplitPreview(null)}
                        onClick={() => { setShowConfig(false); setActiveTab("chat"); setShowWelcome(false); setActiveSessionId(s.id); setActiveViewId(s.id); ensureSessionVisible(s.id) }}
                      >
                        <span class="mafw-agent-dot" style={{ background: s.manager ? "var(--accent)" : "var(--text-4)" }} />
                        <span class="mafw-session-title">{s.title}</span>
                        <TooltipV2 value="分屏" openDelay={300}>
                          <ButtonV2 variant="ghost" size="small" class="mafw-session-split" onClick={e => {
                            e.stopPropagation()
                            setGlobalSplitMenu(null)
                            setSplitMenuFor({ sid: s.id, el: (e.currentTarget as HTMLElement).parentElement })
                          }} aria-label="分屏">⿻</ButtonV2>
                        </TooltipV2>
                        <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={e => { e.stopPropagation(); closeSession(s.id) }}>✕</ButtonV2>
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content>
                          <For each={directionOptionsFor(s.id)}>
                            {(o) => (
                              <ContextMenu.Item onSelect={() => splitTab(s.id, o.dir, o.place)}>
                                <ContextMenu.ItemLabel>{o.glyph} {o.label}</ContextMenu.ItemLabel>
                              </ContextMenu.Item>
                            )}
                          </For>
                          <Show when={directionOptionsFor(s.id).length === 0 && leafCount(currentTree()) >= 4}>
                            <ContextMenu.Item disabled>
                              <ContextMenu.ItemLabel>已达最多 4 个 pane</ContextMenu.ItemLabel>
                            </ContextMenu.Item>
                          </Show>
                          <ContextMenu.Item onSelect={() => closeSession(s.id)}>
                            <ContextMenu.ItemLabel>Close</ContextMenu.ItemLabel>
                          </ContextMenu.Item>
                          <ContextMenu.Item onSelect={() => copyText(s.id)}>
                            <ContextMenu.ItemLabel>Copy session ID</ContextMenu.ItemLabel>
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu>
                  ))}
                  {/* Split view tabs */}
                  {splitViews().map(v => (
                    <div
                      class="mafw-session-tab mafw-split-view-tab"
                      classList={{ active: activeViewId() === v.id }}
                      onClick={() => { setShowConfig(false); setActiveTab("chat"); setShowWelcome(false); setActiveViewId(v.id) }}
                    >
                      <span class="mafw-split-view-icon">⛶</span>
                      <span
                        class="mafw-session-title"
                        title="双击重命名"
                        onDblClick={e => {
                          e.stopPropagation()
                          const next = prompt("重命名分屏", v.title)
                          if (next?.trim()) renameSplitView(v.id, next.trim())
                        }}
                      >{v.title}</span>
                      <TooltipV2 value="在此分屏中继续分屏" openDelay={300}>
                        <ButtonV2 variant="ghost" size="small" class="mafw-session-split" onClick={e => {
                          e.stopPropagation()
                          setGlobalSplitMenu(null)
                          setSplitViewMenuFor({ id: v.id, el: (e.currentTarget as HTMLElement).parentElement })
                        }} aria-label="继续分屏">⿻</ButtonV2>
                      </TooltipV2>
                      <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={e => { e.stopPropagation(); closeSplitView(v.id) }}>✕</ButtonV2>
                    </div>
                  ))}
                  <TooltipV2 value="分屏" openDelay={300}>
                    <ButtonV2 variant="ghost" size="small" class="mafw-session-new" onClick={e => {
                      setSplitMenuFor(null)
                      setGlobalSplitMenu({ el: (e.currentTarget as HTMLElement).parentElement })
                    }}>⿻</ButtonV2>
                  </TooltipV2>
                  <ButtonV2 variant="ghost" size="small" class="mafw-session-new" onClick={createSession}>+</ButtonV2>
                </div>
                {/* Split panes — one ChatPane per leaf */}
                <Show
                  when={showWelcome()}
                  fallback={
                    <div class="mafw-chat-panes">
                      <SplitView
                        root={currentTree()}
                    onRatio={setSplitRatio}
                    preview={splitPreview()}
                    onLeafDragOver={onLeafDragOver}
                    onLeafDrop={onLeafDrop}
                    renderLeaf={(leaf, path) => (
                      "sid" in leaf ? (
                        <ChatPane
                          sessionID={leaf.sid}
                          focused={activeSessionId() === leaf.sid}
                          canClosePane={leafCount(currentTree()) > 1}
                          store={store as any}
                          setStore={setStore as any}
                          todos={todos}
                          switchLogs={switchLogs}
                          sessionCards={sessionCards}
                          sessionPending={sessionPending}
                          taskMetrics={taskMetrics}
                          tasksAllDone={tasksAllDone}
                          gwReady={gwStatus()?.state === "ready"}
                          agentSel={agentSel}
                          model={modelSel}
                          modelGroups={modelGroups}
                          primaryAgents={primaryAgents}
                          subagentAgents={subagentAgents}
                          subagentRunning={subagentRunning}
                          isManager={isManagerSession()}
                          readOnly={!!store.session.find((s: any) => s.id === leaf.sid)?.parentID}
                          parentID={store.session.find((s: any) => s.id === leaf.sid)?.parentID ?? null}
                          onBackToParent={() => backToParent(leaf.sid)}
                          onOpenSubagent={(id) => void openSubagentSession(id)}
                          currentProject={currentProject()}
                          onNavigateTab={(t) => { setActiveTab(t as any); setShowConfig(false) }}
                          onToggleTheme={toggleTheme}
                          onOpenSettings={() => setShowConfig(true)}
                          onModelSelect={onModelSelect}
                          onApplyAgentSwitch={applyAgentSwitch}
                          onPermReply={permReply}
                          onAskSubmit={askSubmit}
                          onAskCancel={askCancel}
                          onTitlebarRef={(el) => setTitlebarRef(el)}
                          taskListOpen={taskListOpen()}
                          tasksPlacement={tasksPlacement()}
                          onTaskToggle={(el, sid) => toggleTasks(el, sid ?? null)}
                          onTaskHoverOpen={(el, sid) => openTasksHover(el, sid ?? null)}
                          onTaskHoverLeave={scheduleTaskClose}
                          onFocus={() => { setShowConfig(false); setActiveTab("chat"); setActiveSessionId(leaf.sid) }}
                          onClosePane={() => closePane(leaf.sid)}
                          onCreateSession={createSession}
                          onSetUserMsgId={(sid2, userMsgId2) => setSessions(prev => prev.map(s => s.id === sid2 ? { ...s, userMsgId: userMsgId2 } : s))}
                          onRegisterAnchor={(s, fn) => { anchorRegistry[s] = fn }}
                          onUnregisterAnchor={(s) => { delete anchorRegistry[s] }}
                          onRegisterResetSending={(s, fn) => { sendingResetters[s] = fn }}
                          onUnregisterResetSending={(s) => { delete sendingResetters[s] }}
                          onRegisterMediaSpeak={(s, fn) => { mediaSpeakHandlers[s] = fn }}
                          onUnregisterMediaSpeak={(s) => { delete mediaSpeakHandlers[s] }}
                          pageState={pageState}
                          setPageState={setPageState as any}
                        />
                      ) : (
                        <SplitPlaceholder
                          openSessions={sessions()}
                          historySessions={historySessions()}
                          canClosePane={leafCount(currentTree()) > 1}
                          onClose={() => closePaneAtPath(path)}
                          onSelect={fillPlaceholder}
                          onCreate={() => void createSession({ noReveal: true }).then(id => id && fillPlaceholder(id))}
                        />
                      )
                    )}
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
                  />
                </Show>
                {/* Split direction menus */}
                <Show when={splitMenuFor()}>
                  {(m) => {
                    const opts = () => directionOptionsFor(m().sid)
                    return (
                      <PopoverShell
                        open={!!splitMenuFor()}
                        trigger={m().el}
                        anchor="below-center"
                        width={160}
                        onClose={() => setSplitMenuFor(null)}
                      >
                        <div class="mafw-split-menu">
                          <For each={opts()}>
                            {(o) => (
                              <ButtonV2 variant="ghost" size="small" class="mafw-split-menu-item" onClick={() => {
                                // Snapshot sid BEFORE clearing the menu signal:
                                // Show's `m()` getter throws once the signal is null.
                                const sid = m().sid
                                setSplitMenuFor(null)
                                splitTab(sid, o.dir, o.place)
                              }}>
                                <span class="mafw-split-menu-glyph">{o.glyph}</span> {o.label}
                              </ButtonV2>
                            )}
                          </For>
                          <Show when={opts().length === 0}>
                            <div class="mafw-split-menu-hint">已达最多 4 个 pane</div>
                          </Show>
                        </div>
                      </PopoverShell>
                    )
                  }}
                </Show>
                <Show when={globalSplitMenu()}>
                  {(m) => {
                    // Global split always creates a NEW split view with a free
                    // four-way direction choice (not constrained by the
                    // current split view's layout).
                    const opts = () => ALL_FOUR
                    return (
                      <PopoverShell
                        open={!!globalSplitMenu()}
                        trigger={m().el}
                        anchor="below-center"
                        width={160}
                        onClose={() => setGlobalSplitMenu(null)}
                      >
                        <div class="mafw-split-menu">
                          <For each={opts()}>
                            {(o) => (
                              <ButtonV2 variant="ghost" size="small" class="mafw-split-menu-item" onClick={() => { setGlobalSplitMenu(null); splitGlobal(o.dir, o.place) }}>
                                <span class="mafw-split-menu-glyph">{o.glyph}</span> {o.label}
                              </ButtonV2>
                            )}
                          </For>
                          <Show when={opts().length === 0}>
                            <div class="mafw-split-menu-hint">已达最多 4 个 pane</div>
                          </Show>
                        </div>
                      </PopoverShell>
                    )
                  }}
                </Show>
                {/* Continue-split menu inside a split view tab */}
                <Show when={splitViewMenuFor()}>
                  {(m) => {
                    const opts = () => {
                      const rec = splitViews().find(v => v.id === m().id)
                      const tree = rec?.layout ?? null
                      if (!tree) return ALL_FOUR
                      if (leafCount(tree) >= 4) return []
                      const focused = activeSessionId() ? findSidPath(tree, activeSessionId()!) : null
                      const target = focused ?? firstLeafPath(tree)
                      return directionOptions(target)
                    }
                    return (
                      <PopoverShell
                        open={!!splitViewMenuFor()}
                        trigger={m().el}
                        anchor="below-center"
                        width={160}
                        onClose={() => setSplitViewMenuFor(null)}
                      >
                        <div class="mafw-split-menu">
                          <For each={opts()}>
                            {(o) => (
                              <ButtonV2 variant="ghost" size="small" class="mafw-split-menu-item" onClick={() => {
                                const id = m().id
                                setSplitViewMenuFor(null)
                                continueSplitIn(id, o.dir, o.place)
                              }}>
                                <span class="mafw-split-menu-glyph">{o.glyph}</span> {o.label}
                              </ButtonV2>
                            )}
                          </For>
                          <Show when={opts().length === 0}>
                            <div class="mafw-split-menu-hint">已达最多 4 个 pane</div>
                          </Show>
                        </div>
                      </PopoverShell>
                    )
                  }}
                </Show>
                {/* TaskList: popover (bar state) - kept for inline TaskBar popover */}
                <Show when={taskListOpen() && tasksPlacement() === "bar"}>
                  <PopoverShell
                    open={taskListOpen() && tasksPlacement() === "bar"}
                    trigger={taskAnchor()}
                    anchor="below-center"
                    onClose={() => setTaskListOpen(false)}
                    onHoverEnter={cancelTaskClose}
                    onHoverExit={closeTaskHover}
                    width={560}
                  >
                    <TaskList
                      todos={todos[taskListSid() ?? currentSessionID()] || []}
                      tokens={taskMetrics(taskListSid() ?? currentSessionID()).tokens}
                      started={taskMetrics(taskListSid() ?? currentSessionID()).started}
                      placement="popover"
                      onClose={() => setTaskListOpen(false)}
                      onPin={() => { setTaskListOpen(false); applyRightDock(true, "tasks") }}
                    />
                  </PopoverShell>
                </Show>
                {/* Legacy dock fallback: tasksPlacement=dock when right dock is closed */}
                <Show when={tasksPlacement() === "dock" && !rightDockOpen()}>
                  <div ref={setDockRef}>
                    <TaskList
                      todos={todos[currentSessionID()] || []}
                      tokens={taskMetrics(currentSessionID()).tokens}
                      started={taskMetrics(currentSessionID()).started}
                      placement={viewportNarrow() ? "overlay" : "dock"}
                      onClose={() => applyTasksPlacement("bar")}
                      onPin={() => { applyTasksPlacement("bar"); applyRightDock(true, "tasks") }}
                    />
                  </div>
                </Show>
              </div>
            ) : activeTab() === "goals" ? (
              <DashboardPage />
            ) : activeTab() === "memory" ? (
              <MemoryPage />
            ) : activeTab() === "approvals" ? (
              <ApprovalsPage />
            ) : activeTab() === "triage" ? (
              <TriagePage />
            ) : activeTab() === "automation" ? (
              <AutomationsPage />
            ) : null}
          </div>
        </div>
        {/* Unified right dock (tasks / trajectory tabs): real sidebar on wide
            viewports (third grid column), overlay on narrow (<1200px) */}
        <div class="mafw-dock-slot" classList={{ overlay: viewportNarrow() }} ref={setDockRef}>
          <Show when={rightDockOpen()}>
            <RightDock
              open={rightDockOpen()}
              tab={rightDockTab()}
              width={rightDockWidth()}
              onClose={() => applyRightDock(false)}
              onTab={(t) => applyRightDock(true, t)}
            >
              <Show when={rightDockTab() === "tasks"} fallback={
                <TrajectoryDock
                  sessionID={currentSessionID()}
                  liveEvents={trajectoryLive()[currentSessionID()] || []}
                  liveTurn={trajectoryTurnLive()[currentSessionID()] || null}
                />
              }>
                    <TaskList
                      todos={todos[currentSessionID()] || []}
                      tokens={taskMetrics(currentSessionID()).tokens}
                      started={taskMetrics(currentSessionID()).started}
                      placement={viewportNarrow() ? "overlay" : "dock"}
                      onClose={() => applyRightDock(false)}
                      onPin={() => applyRightDock(false)}
                    />
              </Show>
            </RightDock>
            <Show when={!viewportNarrow()}>
              <ResizeHandle
                direction="horizontal"
                edge="start"
                size={rightDockWidth()}
                min={240}
                max={480}
                collapseThreshold={140}
                onResize={applyRightDockWidth}
                onCollapse={() => applyRightDock(false)}
              />
            </Show>
          </Show>
        </div>
      </div>
      <Show when={activeQuestion()}>
        <QuestionWidget
          question={activeQuestion()!}
          gatewayUrl={gatewayUrl()}
          onDismiss={() => setActiveQuestion(null)}
        />
      </Show>
    </div>
            </DataProvider>
          </FileComponentProvider>
        </MarkedProvider>
      </DialogProvider>
  )
}
