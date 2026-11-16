import { createSignal, createEffect, createMemo, onMount, onCleanup, untrack, on, Show, For, batch, type JSX } from "solid-js"
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
import { ChangesFace } from "./components/ChangesFace"
import { type GoalRef } from "./changes/changes-context"
import { nextChangesRequest, type ChangesRequest } from "./changes/changes-request"
import { buildSessionTurnChanges, type SessionTurnChange } from "./changes/session-turns"
import { countReviewAttention } from "./changes/review-queue"
import { MenuHost } from "./context-menu/MenuHost"
import { TextMenuBridge } from "./context-menu/TextMenuBridge"
import { menuController } from "./context-menu/controller"
import { experienceStore } from "./experience-store"
import { formatRailTitle, railProjectName } from "./components/rail-display"
import { LEFT_RAIL_WIDTH, PUSH_PAIR_BUDGET, clampLeftDockWidth, closeLeftDockState, effectiveLeftDockWidth, leftDockPushDragMax, normalizeLeftDockFace, resolveLeftDockWidth, resolveMode, restoreLeftDockOpen, shouldAutoRestoreLeftDock, shouldCloseOnSelect, toggleLeftDockState, type LeftDockFace } from "./left-dock"
import { SessionStrip } from "./components/SessionStrip"
import { sessionStore } from "./session-store"
import { needsSessionInfoHydration, sessionInfoEntityFields } from "./session-info"
import { agentKey, isAgentKey, resolveSessionAgent } from "./agent-identity"
import { mergeHiddenTodos } from "./todo-presenter"
  import { traceEvent } from "./event-trace"
import { dispatchShellEvent, type ShellEventDeps } from "./sse/dispatcher"
import { SseConnection, withSince } from "./sse/sse-connection"
import { recoverEventGap } from "./sse/event-replay-gap"
import { applyPartUpsert } from "./sse/chat-reducers"
import { createToolPartScheduler } from "./sse/tool-part-scheduler"
import { bumpGoalsRev, goalsRev } from "./goals-rev"
import { buildTopicList, proposedBoundaries, type LeadTopicListItem } from "./lead-topics"
import type { LeadBoundaryView } from "@mafw/sdk"
import { bumpCheckpointRev } from "./checkpoint-rev"
import { keybindingFor } from "./keybinding-store"
import { matchesCombo } from "./keybindings"
import { ingestSubagentEvent, onSubagentTerminal, subagentRows } from "./subagent-store"
import { backgroundJobs, clearBackgroundJobs, ingestBackgroundJob, ingestBackgroundJobs, onBackgroundTerminal } from "./background-store"
import { backgroundApiAvailable, resetBackgroundCapability } from "./background-capability"
import { ingestHistoryPage } from "./ingest/messages"
import { reconcileBackgroundOnce } from "./background-reconcile"
import { buildBackgroundNotice } from "./background-notify"
import { childrenNeedingProbe, isTrackedChildSession } from "./subagent-tracker"
import { reconcileSubagentsOnce } from "./subagent-reconcile"
import { buildTerminalNotice, createNotifyGate, shouldNotifyIdle } from "./subagent-notify"
import { mapAskCard as mapAskCardPure } from "./sse/handlers/flow-cards"
import { EventInspector } from "./components/EventInspector"
import { ImageLightbox } from "./components/ImageLightbox"
import { conn, useConnPhase } from "./connection-state"
import { ConnBanner } from "./components/ConnBanner"
import { UpdaterBanner } from "./components/UpdaterBanner"
import { ChatPane, mergeLocalParts, type FlowCardRecord } from "./components/ChatPane"
import { TaskList } from "./components/TaskList"
import { WorkbenchShell } from "./components/WorkbenchShell"
import type { FileDiffEntry } from "./components/DiffReviewPanel"
import { WorldOverviewStage } from "./components/WorldOverviewStage"
import { GoalDetailPanel } from "./components/GoalDetailPanel"
import { PodTranscriptOverlay } from "./components/PodTranscriptOverlay"
import { ingestPodEvent, podStore, pickTechLeadInviteGoal, resolvePodDetailCached, techLeadTabTitle } from "./pod-store"
import { podRailBadge, podResultBadge } from "./pod-rail-badge"
import { createDecisionStore } from "./decision-store"
import {
  isPodResultViewed,
  podTechLeadOpenRequest,
} from "./pod-result-store"
import { podEvents } from "./pod-events"
import {
  attentionTarget,
  goalRevisionOf,
  goalSessionIdentity,
  leadSessionIdFromPod,
  podRoleForSession,
  podSessionRoute,
  podStageLabel,
  reconcileGoalSessionTabs,
  techLeadSendGate,
  type GoalDetailFocus,
} from "./pod-model"
import { executionBadgeFor } from "./goal-user-view"
import type { PlanOpenRequest } from "./plan-open"
import { goalDiscussionRequestCurrent, goalDiscussionTarget, shouldOpenTechLeadForGoal, shouldShowReturnLead } from "./goal-chat-context"
import { ingestPluginEvent, ingestPluginsChanged, pluginDescriptors, refreshPluginClient } from "./plugins/plugin-store"
import { pluginSurfaceIssues, pluginSurfaces, pluginConfigSurfaces, railItemsFromPanels } from "./plugins/plugin-view-model"
import { railItemsFromWebSurfaces, webSurfaceViews } from "./plugins/plugin-web-surface"
import { PluginMenuWiring } from "./plugins/PluginMenuWiring"
import {
  EMPTY_PLUGIN_SURFACE_RUNTIME,
  applyPluginRailState,
  applyPluginSurfaceBadge,
  applyPluginSurfaceTitle,
  prunePluginSurfaceRuntime,
} from "./plugins/plugin-surface-state"
import { PluginSurfaceHost } from "./plugins/PluginSurfaceHost"
import { PluginWindowHost } from "./plugins/PluginWindowHost"
import { buildPodNoteBody } from "./pod-note"
import { retitleTab, shouldRetitleTab } from "./session-tab-title"
import { dropOtherLeadTabs, mergeTabIdentity, pinLeadTabTitle } from "./session-tab-identity"
import { sessionEntities } from "./session-entities"
import { resolveOpenSessionTitle, sessionSnapshotTabs, sessionTabTitle, sessionTitle } from "./session-title"
import { retitleSessionEntity } from "./session-title-writer"
import { isLeadRole, leadTabMetadata, resolveLeadSession, tabSessionRole } from "./lead-session"
import { readSavedTheme, nextTheme, applyTheme } from "./theme"
import { createPresence, SURFACE_MS } from "./components/presence"
import { fetchTasks, ingestTask } from "./task-store"
import { fetchQueue, ingestQueueEvent } from "./queue-store"
import { setRun } from "./run-store"
import { addPending } from "./annotation-store"
import { getSessionTurnDiffs } from "./session-turn-diffs"
import { defaultDockOpen } from "./workbench-defaults"
import type { ChatEpisode } from "./chat/episode-model"
import { resolveEpisodeGoalReference } from "./chat/episode-decision"
import {
  parsePluginSurfaceId,
  pluginSurfaceId,
  type PluginSurfaceId,
} from "./plugins/surface-id"
import {
  createWorkbenchState,
  jumpTo,
  openSubject,
  popFocus,
  selectFocus,
  type Focus,
  type Scope,
  type WorkbenchState,
} from "./focus/focus-model"
import { frameView, type FrameView } from "./focus/frame-view"
import { buildCommandPickerItems, buildFilePickerItems, buildGoalPickerItems, buildWorldPickerItem, withCommandItems, type PickerItem } from "./focus/picker-model"
import { shouldAutoOpenPicker } from "./focus/landing"
import {
  activeDocumentTabId,
  activateDocumentTab,
  configureDocumentListWorld,
  documentTabs,
  requestCloseDocumentTab,
  requestDocumentActivation,
} from "./documents/document-tabs-store"
import { fileDocumentTabId, nextDocumentTabId, webDocumentTabId, WORLD_SCENE_TAB_ID } from "./documents/document-tabs-model"
import { configureDocumentListStorage } from "./documents/document-list-persistence"
import { configureBrowserTabsStorage } from "./documents/browser-tabs-persistence"
import { activeBrowserDocumentId, openBrowserDocument } from "./documents/browser-documents"
import {
  activeChangeSetDocument,
  changeSetDocuments,
  clearChangeSetDocuments,
  openChangeSetDocument,
  setActiveChangeSetDocument,
  updateChangeSetDocument,
  type ChangeSetSource,
  type OpenChangeSetInput,
} from "./documents/change-set-documents"
import {
  closeSceneTab,
  flushSceneTabs,
  openSceneTab,
  sceneTabId,
  sceneTabs,
  switchSceneTabWorld,
  type SceneSubject,
} from "./documents/scene-tabs"
import { stageActionFor } from "./focus/stage-dispatch"
import { openGoalFocus as applyGoalFocus } from "./focus/goal-focus"
import type { FocusOpenRequest } from "./focus/focus-open"
import {
  configureFocusStorage,
  flushFocusPersistence,
  loadFocusState,
  saveFocusState,
} from "./focus/focus-persistence"
import { migrateLegacyContentScope, retiredContentScopeKey } from "./focus/legacy-migration"
import { fileOpenPlan } from "./file-kind"
import { fileProtocol } from "./file-protocol-client"
import { requestBrowserNavigate } from "./browser-nav"
import { buildMafwFileUrl } from "../../shared/mafw-file"
import { CHAT_COMFORT_MIN, CHAT_PX_CEIL, CHAT_PX_FLOOR, WORKBENCH_DEFAULT_DETENT, WORKBENCH_MIN_WIDTH, chatPxForDetent, snapDetent, workbenchZoneFor, type WorkbenchDetent } from "./workbench-detents"
import { migrateDockKeys, workbenchColumns, workbenchFocusActive, workbenchShellHidden, workbenchSplit, formatResizePreview, type WorkbenchContentMode } from "./workbench-layout"
import { resolveWorkbenchRoot } from "./workbench-root"
import {
  contentScopeKey,
  contentScopeLabel,
  contentScopeRoot,
  diffsForContentScope,
  goalContentScope,
  projectContentScope,
  type ContentScope,
} from "./content-scope"
import {
  configureContentScopeStateStorage,
  contentScopeStateFor,
} from "./content-scope-state"
import { configureEditorDraftStorage } from "./editor-drafts"
import { readRecentContent, recordRecentContent, type RecentContentEntry } from "./recent-content"
import { PopoverShell } from "./components/pickers/PopoverShell"
import { type NavTab } from "./components/nav-tab"
import { WindowControls } from "./components/WindowControls"
import { registerMafwToolCards } from "./components/tool-cards"
import { configureGoalCreatedActions } from "./components/tool-cards/goal-created"
import { registerUserPluginCards } from "./components/UserPluginCards"
import { registerUnifiedToolCards } from "./plugins/PluginToolCard"
import { registerThinkingBlock } from "./components/ThinkingBlock"
import { WelcomeHome } from "./components/WelcomeHome"
import { buildLeadHandoff, isHandoffableRole } from "./lead-handoff"
import { transcriptTurns } from "./pod-transcript"
import { parseDeepLink } from "./deep-link"
import { ConfirmOverlay } from "./components/ConfirmOverlay"
import { CommandPalette, type PaletteItem } from "./components/CommandPalette"
import { nextMode as nextPermissionMode, type PermissionMode } from "./components/permission-card-mapping"
import { findPendingToolPart } from "./components/flow-card-placement"
import { saveProjectLayout, loadProjectLayout, migrateLegacyLayout, pruneMissing } from "./layout-persist"
import { isWorkingStatus, sessionStatusFromInfo } from "./session-status"
import { buildSessionMarkdown, extractExportTurns } from "./export-markdown"
import { MemoryPage } from "./pages/Memory"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { TriagePage } from "./pages/TriagePage"
import { AutomationsPage } from "./pages/Automations"
import { McpPage } from "./pages/McpPage"
import { ConfigPage, isNavKey, type NavKey } from "./pages/Config"
import { creatorEntryState, reusableCreatorSession } from "./pages/creator-entry"
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
import type { MafwAgent, MafwProvider, PodGoal, ThinkingLevel } from "@mafw/sdk"

/** `/api/provider` 信封：规范 `items` + 默认模型/连接列表（composer 初值用）。 */
type ProvidersEnvelope = {
  items: MafwProvider[]
  default?: { providerID?: string; modelID?: string }
  connected?: string[]
}
import "./mafw.css"

if (typeof window !== "undefined") {
  try {
    configureContentScopeStateStorage(window.localStorage)
    configureEditorDraftStorage(window.localStorage)
    configureFocusStorage(window.localStorage)
    configureDocumentListStorage(window.localStorage)
    configureBrowserTabsStorage(window.localStorage)
  } catch { /* storage blocked — keep in-memory */ }
}

export function MafwShell() {
  const [activeTab, setActiveTab] = createSignal<NavTab>("chat")
  const [showConfig, setShowConfig] = createSignal(false)
  const [configSection, setConfigSection] = createSignal<NavKey | undefined>(undefined)
  const [gwStatus, setGwStatus] = createSignal<{ state: string; port: number | null; url?: string | null } | null>(null)
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

  // Code Mode / MCP progress bursts: keep only the latest running snapshot per
  // tool part and flush on the next frame. Terminal snapshots apply immediately
  // (the scheduler handles that), text deltas never enter this queue.
  const toolPartScheduler = createToolPartScheduler({
    schedule: (fn) =>
      typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : (setTimeout(fn, 32) as any),
    cancel: (handle) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle)
      else clearTimeout(handle)
    },
    apply: (parts) => {
      batch(() => {
        for (const part of parts) {
          const sid = part.sessionID
          if (!sid) continue
          setStore((prev) => ({ ...prev, ...applyPartUpsert(prev as any, sid, part) }))
        }
      })
    },
  })
  onCleanup(() => toolPartScheduler.flush())

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
  const [podGoalId, setPodGoalId] = createSignal<string | null>(null)
  const [goalPlanOpenRequest, setGoalPlanOpenRequest] = createSignal<PlanOpenRequest | null>(null)
  const [goalDetailFocus, setGoalDetailFocus] = createSignal<GoalDetailFocus>("timeline")
  let goalDiscussSeq = 0
  const [goalComposerRequest, setGoalComposerRequest] = createSignal(0)
  /** 打开统一 Goal 详情，并按 attention action 指定落点（计划/问题/方向/结果）。 */
  const openGoalDetail = (goalId: string, focus: GoalDetailFocus = "timeline"): void => {
    setGoalDetailFocus(focus)
    setPodGoalId(goalId)
    openGoalFocus(goalId, focus)
  }
  // 进入非终态 Goal 时把 Chat 切到 Tech Lead，但右侧 Goal 先同步打开。
  // snapshot 让“刚创建、SSE/刷新尚未到达”的 Goal 也能进入讨论；seq 防止快速切换
  // Goal/项目时迟到的 Tech Lead 恢复把 Chat 拉回旧上下文。
  const openGoalAndDiscuss = async (
    goalId: string,
    focus: GoalDetailFocus = "timeline",
    goalSnapshot?: PodGoal,
  ): Promise<void> => {
    const requestSeq = ++goalDiscussSeq
    const requestedProject = currentProject()
    openGoalDetail(goalId, focus)
    let goal = goalSnapshot ?? goalDiscussionTarget(podStore.detail(), goalId)
    try {
      await podStore.refresh()
      goal = goalDiscussionTarget(podStore.detail(), goalId) ?? goal
    } catch {
      // fail-open: keep the right Goal detail reachable even if Pod refresh fails
    }
    if (!goal) return
    const isCurrent = () => goalDiscussionRequestCurrent({
      requestSeq,
      currentSeq: goalDiscussSeq,
      requestedGoalId: goalId,
      selectedGoalId: podGoalId(),
      requestedProject,
      currentProject: currentProject(),
    })
    if (!isCurrent() || !shouldOpenTechLeadForGoal(goal)) return
    try {
      await openTechLead(goalId, isCurrent)
      if (isCurrent()) await podStore.refresh()
    } catch (err: any) {
      showToastV2({ description: `打开 Tech Lead 失败: ${err?.message || err}`, duration: 4000 } as any)
    }
  }

  // store.session 的 tab 占位只有 directory "."；权威信息（directory/parentID）来自
  // sessions.get。工作台根（benchRoot）与 worktree 徽标依赖真实 directory——激活时
  // 补齐一次（每个 sid 一次，防重复请求）。2026-10-31。
  const sessionInfoHydrated = new Set<string>()
  async function hydrateSessionInfo(sid: string): Promise<void> {
    try {
      const info: any = await window.api.mafw.sessions.get(sid)
      if (!info?.id) { sessionInfoHydrated.delete(sid); return }
      if (!sessions().some(s => s.id === sid)) return // tab 已关闭：丢弃
      // E6-2（F5）：权威元数据同时进 entity 缓存（Rail / 徽标 / 角色派生都读它）；
      // store.session 仍保留给 tab 本地展示。title 不在此列（独立写入口）。
      const entityFields = sessionInfoEntityFields(info)
      if (entityFields) sessionEntities.upsert(entityFields)
      setStore(prev => {
        if (!sessions().some(s => s.id === sid)) return prev // tab 已关闭：丢弃
        const idx = prev.session.findIndex((s: any) => s.id === sid)
        if (idx < 0) return { ...prev, session: [...prev.session, info] } // 布局恢复：tab 没有占位条目
        const entry = prev.session[idx]
        const next = [...prev.session]
        next[idx] = { ...entry, ...info, title: entry.title || info.title }
        return { ...prev, session: next }
      })
    } catch {
      sessionInfoHydrated.delete(sid) // E10-3: 404（会话不存在）或失败 → 未水合，下次激活重试
    }
  }
  createEffect(() => {
    const sid = activeSessionId()
    if (!sid || sessionInfoHydrated.has(sid)) return
    const entry = store.session.find((s: any) => s.id === sid)
    if (!needsSessionInfoHydration(entry)) return
    sessionInfoHydrated.add(sid)
    void hydrateSessionInfo(sid)
  })

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
          session_status: { ...prev.session_status, [childID]: "idle" },
          message: prev.message[childID] ? prev.message : { ...prev.message, [childID]: [] },
        }))
      }
    } catch (e) { console.warn("[mafw] open subagent failed:", e) } // E10-3: 404 = 子会话不存在，不插入假 tab
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
  // Task 20：Tech Lead 隐藏会话 → 它讨论的 Goal（只覆盖本次打开；会话本身保持隐藏，
  // reload 后 tab 已被 prune，不需要持久化）。
  const techLeadGoalBySession: Record<string, string> = {}
  createEffect(() => {
    const pd = currentProject()
    if (gwStatus()?.state !== "ready") return
    setHistorySessions(sessionStore.sessionsFor(pd) as any)
  })

  // Registered projects + current selection (welcome pane project switcher).
  const [projects, setProjects] = createSignal<{ id: string; worktree: string }[]>([])
  const [currentProject, setCurrentProject] = createSignal<string | null>(null)
  // Tabs are project-scoped: layoutProject is the project whose tab strip is
  // currently loaded/safe to persist; null while switching/restoring.
  const [layoutProject, setLayoutProject] = createSignal<string | null>(null)
  let switchingProject = false
  // Bumped by gateway project_registered broadcasts so once-only project
  // fetches (here + Rail) refetch when a new project registers.
  const [projectsRev, setProjectsRev] = createSignal(0)

  // 决定记录 / rail badge 的唯一数据源：attention 投影 + 后续 decision records。
  const decisionStore = createDecisionStore({
    api: {
      attention: (dir) => window.api.mafw.attention.list(dir),
      decisions: (dir) => window.api.mafw.decisions.list({ projectDir: dir, limit: 200 }),
      confirm: (id, input) => window.api.mafw.decisions.confirm(id, input),
      shelve: (id, input) => window.api.mafw.decisions.shelve(id, input),
      reopen: (id, input) => window.api.mafw.decisions.reopen(id, input),
    },
    projectDir: () => currentProject(),
  })
  const [decisionRecordBusy, setDecisionRecordBusy] = createSignal<string | null>(null)
  const runDecisionRecord = async (id: string, action: () => Promise<void>) => {
    setDecisionRecordBusy(id)
    try {
      await action()
    } catch (err: any) {
      showToastV2({
        description: `决定记录失败：${String(err?.message ?? err).slice(0, 120)}`,
        duration: 3600,
      })
    } finally {
      setDecisionRecordBusy(null)
    }
  }
  const confirmDecisionRecord = (
    id: string,
    input: { rationale: string; consequences: string; reviewAt?: string },
  ) => { void runDecisionRecord(id, () => decisionStore.confirm(id, input)) }
  const shelveDecisionRecord = (
    id: string,
    input: { reviewAt: string; note?: string },
  ) => { void runDecisionRecord(id, () => decisionStore.shelve(id, input)) }
  const reopenDecisionRecord = (id: string) => {
    void runDecisionRecord(id, () => decisionStore.reopen(id))
  }
  createEffect(() => {
    const dir = currentProject()
    const detail = podStore.detail()
    void podStore.reviewRevision()
    if (!dir || !detail) return
    const timer = setTimeout(() => { void decisionStore.refresh() }, 250)
    onCleanup(() => clearTimeout(timer))
  })
  // 决定记录写入由 gateway `decision.updated` 推送；200ms 合并多次写入。
  let decisionRefreshTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleDecisionRefresh = () => {
    if (decisionRefreshTimer) return
    decisionRefreshTimer = setTimeout(() => {
      decisionRefreshTimer = null
      void decisionStore.refresh()
    }, 200)
  }
  onCleanup(() => {
    if (decisionRefreshTimer) clearTimeout(decisionRefreshTimer)
  })

  // Lead UI authority is the current Pod's active coordination binding. The
  // legacy manager-session kv is a gateway recovery detail, never a desktop
  // fallback. Root can differ from a worktree project, so resolution is scoped
  // to the currently selected project rather than an id keyed by directory.
  const podLookupSettled = (): boolean => {
    const dir = podStore.projectDir()
    return !!dir && podStore.resolvedFor(dir)
  }
  const leadResolvedFor = (project: string | null): boolean =>
    !!project && project === currentProject() && podLookupSettled()
  /** Current Lead id; null while Pod is loading or when the Pod has no live Lead. */
  const currentLeadId = (project: string | null): string | null =>
    leadResolvedFor(project) ? leadSessionIdFromPod(podStore.detail()) : null
  const podIdForCurrentProject = (): string | null => {
    const detail = podStore.detail()
    if (!detail) return null
    const loadedFor = podStore.projectDir()
    return !loadedFor || loadedFor === currentProject() ? detail.pod.id : null
  }
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

  // Switch the current project: save the outgoing tab strip, restore the
  // target project's own tabs (the strip follows the selected project).
  const handleSelectProject = async (worktree: string) => {
    if (worktree === currentProject()) {
      const list = await window.api.mafw.sessions.list(worktree).catch(() => [])
      setHistorySessions(Array.isArray(list) ? list : [])
      return
    }
    const prev = currentProject()
    if (prev && layoutProject() === prev) {
      saveProjectLayout(layoutIO, prev, {
        // F1：快照存「当前展示的标签」（entity 优先），不是 tab 的首帧兜底。
        tabs: sessionSnapshotTabs(sessions()),
        activeViewId: activeViewId(),
      })
    }
    switchingProject = true
    setLayoutProject(null)
    setPodGoalId(null)
    setCurrentProject(worktree)
    try {
      try {
        await window.api.mafw.projects.setCurrent(worktree)
      } catch (e) { console.warn("[mafw] setCurrent failed:", e) }
      const list = await window.api.mafw.sessions.list(worktree).catch(() => [])
      const history = Array.isArray(list) ? list : []
      setHistorySessions(history)
      // Pod resolution must settle before pruning hidden Lead tabs. A
      // transport/unknown error is not definitive: keep the saved tabs and
      // let the restore effect apply them once lookup resolves.
      await podStore.open(worktree).catch(() => {})
      const podDir = podStore.projectDir()
      if (!podDir || !podStore.resolvedFor(podDir)) return
      applyProjectLayout(worktree, history)
      setLayoutProject(worktree)
    } finally {
      switchingProject = false
    }
  }

  // E6-2：会话标题只有一个读路径 —— entity 缓存 → tab/持久化兜底。
  // 角色命名 tab（Lead）恒为角色名，runtime 自动标题不得泄漏到标签。
  const titleOfSession = (sid: string, fallback?: string | null): string =>
    sessionTabTitle(sid, fallback ?? "", sessions().find(s => s.id === sid))

  // Open a session as a tab (single pane; v6 removed the split-view model).
  // Welcome-page entries (manager / new session / recent session) go through here.
  const openSessionTab = (sid: string, title?: string, lead?: boolean, metadata?: any) => {
    setShowConfig(false)
    setActiveTab("chat")
    setShowWelcome(false)
    // E6-2：先 upsert 实体（唯一元数据源），tab 里的 title 只作为实体缺失时的
    // 首帧兜底（持久化布局只存 {id,title}）。session.updated 只改实体，不回写 tab。
    const known = untrack(() => sessionEntities.get(sid))
    // F2：已知道的实体标题（用户改名 / gateway 最新标题）优先，调用方标题只在实体
    // 缺失或只是占位标题时补位——打开 tab 不能覆盖用户改名。
    const entityTitle = resolveOpenSessionTitle({
      lead,
      knownTitle: known?.title,
      callerTitle: title,
      fallback: `Chat ${sessions().length + 1}`,
    })
    const projectDir = known?.directory ?? currentProject()
    sessionEntities.upsert({
      id: sid,
      title: entityTitle,
      ...(projectDir ? { directory: projectDir } : {}),
      metadata: metadata ?? (lead === true ? leadTabMetadata() : known?.metadata),
      time: known?.time ?? { created: Date.now() },
    })
    if (!sessions().some(s => s.id === sid)) {
      setSessions(prev => [...prev, { id: sid, title: entityTitle, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false, lead, metadata }])
      setStore(prev => ({
        ...prev,
        session: [...prev.session, { id: sid, title: entityTitle, directory: ".", time: { created: Date.now() }, projectID: "." }],
        session_status: { ...prev.session_status, [sid]: "idle" },
        message: { ...prev.message, [sid]: [] },
      }))
    }
    // A tab may have been opened earlier without knowing its role. Upgrade it
    // in place; opening a new Lead also drops the previous (possibly dead)
    // Lead tab so the strip never contains two "Lead" identities.
    setSessions(prev => mergeTabIdentity(prev, sid, lead, metadata, entityTitle))
    // Lead 是角色 tab：标签恒为角色名，不继承 runtime 会话标题或恢复的旧标题。
    setSessions(prev => pinLeadTabTitle(prev, sid, lead))
    // ChatPane 头部同样以实体内标题为准（Lead 由 chatPaneTitle 钉成角色名）；
    // store.session 占位一起钉住，仅作为实体缺失时的兜底。
    if (lead === true) setStore(prev => ({ ...prev, session: pinLeadTabTitle(prev.session as any, sid, true) }))
    if (lead === true) setSessions(prev => dropOtherLeadTabs(prev, sid))
    setActiveSessionId(sid)
    setActiveViewId(sid)
    if (shouldRetitleTab(sessions().find(s => s.id === sid), entityTitle)) {
      setSessions(prev => retitleTab(prev, sid, entityTitle))
      setStore(prev => ({ ...prev, session: retitleTab(prev.session, sid, entityTitle) }))
    }
    syncPermissionMode(sid) // 🛡 徽标初始态（kv 真相源拉取）
    closeLeftDockIfOverlay()
  }

  // Project-level Lead is the project conversation. Opening it is the explicit
  // point where a missing Pod may be created; background polling never creates one.
  const openLeadEntry = async (): Promise<boolean> => {
    setShowConfig(false)
    setActiveTab("chat")
    setShowWelcome(false)
    const project = currentProject()
    if (!project) {
      showToastV2({ description: "尚未选择项目", duration: 3000 } as any)
      return false
    }
    try {
      await podStore.open(project)
      if (!podStore.detail()) await podStore.create()
      if (!podStore.detail()) throw new Error("鲸群创建失败")
      await openPodSession("")
      return !!currentLeadId(project)
    } catch (err: any) {
      showToastV2({ description: `打开 Lead 失败: ${err?.message || err}`, duration: 4500 } as any)
      return false
    }
  }
  const openProjectWork = () => {
    openWorldOverview()
  }
  const [teamFocusRequest, setTeamFocusRequest] = createSignal(0)
  const openProjectTeam = (): void => {
    openProjectWork()
    setTeamFocusRequest((seq) => seq + 1)
  }
  const openGoalComposer = (): void => {
    openProjectWork()
    setGoalComposerRequest((seq) => seq + 1)
  }
  const openNewGoalComposer = (): void => {
    openGoalComposer()
  }
  // 旧 goals / workspace 目的地兼容：不再渲染全页工作空间，统一进右工作台「工作」。
  createEffect(() => {
    if (activeTab() === "goals") openProjectWork()
  })

  const activeHandoffRole = (): string | undefined => {
    const sid = activeSessionId()
    if (!sid) return undefined
    // E6-2：角色以实体缓存为准（tab/store 占位兜底），与 ChatPane 的 isLead 同源。
    return workspace.sessionRole(sid)
      ?? tabSessionRole(store.session.find((item: any) => item.id === sid))
      ?? sessions().find((item) => item.id === sid)?.metadata?.mafw?.role
  }
  const canHandoffActiveSession = (): boolean => isHandoffableRole(activeHandoffRole())

  /**
   * Free discussion -> Lead handoff. The source session is never modified or
   * deleted; only an immutable snapshot + pointer travel with the new Goal.
   */
  const handoffActiveSessionToLead = async (): Promise<void> => {
    const sid = activeSessionId()
    if (!sid) return
    if (!canHandoffActiveSession()) {
      showToastV2({ description: "只有自由讨论可以交给 Lead；内部执行会话请直接管理 Goal", duration: 4000 } as any)
      return
    }
    try {
      const raw = await window.api.mafw.sessions.messages(sid, 100) as any
      const turns = transcriptTurns(raw)
      const lastUser = [...turns].reverse().find((turn) => turn.role === "user")
      const lastAssistant = [...turns].reverse().find((turn) => turn.role === "assistant")
      const sourceText = [lastUser?.text, lastAssistant?.text].filter(Boolean).join("\n\n")
      const handoff = buildLeadHandoff({
        sessionTitle: sessionTitle(
          sid,
          sessions().find((item) => item.id === sid)?.title
            ?? historySessions().find((item) => item.id === sid)?.title,
        ) || "未命名讨论",
        sourceText,
        sessionID: sid,
        role: activeHandoffRole(),
      })
      if (!handoff) {
        showToastV2({ description: "当前讨论还没有可交给 Lead 的内容", duration: 3500 } as any)
        return
      }
      const project = currentProject()
      if (!project) throw new Error("尚未选择项目")
      let detail = podStore.detail()
      if (!detail || (podStore.projectDir() && podStore.projectDir() !== project)) {
        await podStore.open(project)
        detail = podStore.detail()
      }
      if (!detail) {
        await podStore.create()
        detail = podStore.detail()
      }
      if (!detail) throw new Error("无法解析当前项目的鲸群")
      const created = await window.api.mafw.pod.handoffGoal(detail.pod.id, {
        title: handoff.title,
        objective: handoff.objective,
        sourceRef: handoff.sourceRef,
      })
      await podStore.refresh()
      void openGoalAndDiscuss(created.goalId, "timeline", created.goal)
      showToastV2({ description: "已交给 Lead，Goal 已创建", duration: 3000 } as any)
    } catch (err: any) {
      showToastV2({ description: `交给 Lead 失败: ${err?.message || err}`, duration: 4500 } as any)
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

  // Per-session session.config（agent/model/thinking）——会话菜单的状态源。
  // SSE `session.config` 增量由 flow-cards 分支写入；打开会话时拉一次全量（fail-open）。
  const [sessionConfigs, setSessionConfigs] = createStore<Record<string, any>>({})
  createEffect(() => {
    const sid = activeSessionId()
    if (!sid) return
    void window.api.mafw.sessions.config(sid)
      .then((state: any) => setSessionConfigs(sid, state))
      .catch(() => { /* fail-open：菜单的 Thinking 行按不支持处理 */ })
  })
  const thinkingLevelOf = (sid: string | null | undefined): any => (sid ? (sessionConfigs[sid]?.thinkingLevel ?? null) : null)
  const thinkingSupportedOf = (sid: string | null | undefined): boolean => (sid ? sessionConfigs[sid]?.thinkingLevelSupported === true : false)
  const applyThinking = (sid: string, level: ThinkingLevel | null) => {
    const prev = sessionConfigs[sid]
    setSessionConfigs(sid, { ...(prev ?? {}), thinkingLevel: level ?? undefined })
    window.api.mafw.sessions.setConfig(sid, { category: "thought_level", value: level } as any)
      .then((state: any) => setSessionConfigs(sid, state))
      .catch(() => {
        setSessionConfigs(sid, prev as any)
        showToastV2({ description: "切换思考档位失败", duration: 2000 } as any)
      })
  }

  // Shared destructive confirmation request (ConfirmOverlay) — replaces the
  // blocking window.confirm for in-shell actions.
  const [confirmReq, setConfirmReq] = createSignal<{ title: string; message?: string; confirmLabel?: string; onConfirm: () => void } | null>(null)

  // Global command palette (Ctrl+Shift+P).
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesCombo(e, keybindingFor("command-palette"))) {
        e.preventDefault()
        setPaletteOpen(o => {
          // 单浮层语义：命令面板与取景器互斥，哪怕被重绑到同一组合键。
          if (!o) setPickerOpen(false)
          return !o
        })
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
      {
        id: "project-work", label: "项目工作", hint: "Work", group: "导航",
        run: () => openProjectWork(),
      },
      nav("memory", "记忆", "Memory"),
      nav("approvals", "审批", "Approvals"),
      nav("triage", "分诊", "Triage"),
      nav("automation", "自动化", "Automations"),
      nav("mcp", "MCP 服务器", "MCP"),
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
        id: "copy-session-markdown", label: "复制会话为 Markdown", hint: "Copy to clipboard", group: "会话",
        run: () => { const sid = activeSessionId(); if (sid) void copySessionMarkdown(sid) },
      },
      {
        id: "open-settings", label: "打开设置", hint: "Settings", group: "导航",
        run: () => setShowConfig(true),
      },
      {
        id: "open-usage", label: "打开用量与上下文", hint: "Usage & Context", group: "导航",
        run: () => { setShowConfig(true); setConfigSection("usage") },
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
  const exportSession = async (sid: string) => {    const turns = extractExportTurns(store.message[sid] || [])
    const title = titleOfSession(sid, sessions().find(s => s.id === sid)?.title) || sid
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

  const forkSessionFromMenu = async (sid: string) => {
    try {
      const res = await window.api.mafw.sessions.fork(sid)
      const forked = res?.session?.id
      if (forked) {
        showToastV2({ description: "已分叉会话", duration: 2000 })
        openSessionTab(forked)
      }
    } catch (e: any) {
      showToastV2({ description: `分叉失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  // C1（W3 分享）：复制会话 Markdown 到剪贴板（与导出同构建管线）。
  const copySessionMarkdown = async (sid: string) => {
    const turns = extractExportTurns(store.message[sid] || [])
    const title = titleOfSession(sid, sessions().find(s => s.id === sid)?.title) || sid
    const markdown = buildSessionMarkdown({ title, turns })
    try {
      await navigator.clipboard.writeText(markdown)
      showToastV2({ description: `已复制 ${turns.length} 条回合到剪贴板`, duration: 2500 })
    } catch (e: any) {
      showToastV2({ description: `复制失败: ${e?.message || e}`, duration: 3000 })
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


  // ── Layout persistence: per-project session tabs + active view ──────────
  // Switching projects swaps the tab strip: outgoing tabs are saved under the
  // old project, incoming tabs restored from the target project's snapshot.
  const layoutIO = { getItem: (k: string) => localStorage.getItem(k), setItem: (k: string, v: string) => localStorage.setItem(k, v), removeItem: (k: string) => localStorage.removeItem(k) }
  let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null

  type LayoutHistorySession = { id: string; title?: string; metadata?: { mafw?: { role?: string } } }

  const applyProjectLayout = (
    project: string,
    history: LayoutHistorySession[],
  ) => {
    const snap = loadProjectLayout(layoutIO, project) ?? migrateLegacyLayout(layoutIO, project)
    setSessions([])
    // Lead is a hidden internal session: keep the Pod coordination id during
    // prune so a reload/project switch cannot mistake it for a deleted session.
    const leadId = currentLeadId(project)
    const existing = new Set(history.map(s => s.id))
    const pruned = snap ? pruneMissing(snap, existing, leadId ? [leadId] : []) : null
    if (!pruned) {
      setActiveSessionId(null)
      setActiveViewId(null)
      setShowWelcome(true)
      return
    }
    const byId = new Map(history.map(s => [s.id, s]))
    // 持久化布局只存 {id,title}：隐藏的 Lead 会话不在 history 里，角色标记会丢，
    // 靠 kv 权威 id 认回来（否则恢复后新话题/agent 锁失效）。
    for (const t of pruned.tabs) {
      const info = byId.get(t.id)
      const lead = (!!leadId && t.id === leadId) || isLeadRole(info?.metadata?.mafw?.role)
      // F1：恢复时以 gateway 最新标题为先（entity 内部还会再判一次「已知标题
      // 优先于占位标题」），持久化快照的旧标题只能是兜底。
      openSessionTab(t.id, info?.title || t.title, lead, info?.metadata ?? (lead ? leadTabMetadata() : undefined))
    }
    const active = pruned.activeViewId && pruned.tabs.some(t => t.id === pruned.activeViewId)
      ? pruned.activeViewId
      : pruned.tabs[0]?.id ?? null
    if (active) {
      setActiveSessionId(active)
      setActiveViewId(active)
      setShowWelcome(false)
    }
    console.log("[mafw] layout restored:", project, pruned.tabs.length, "tabs")
  }

  createEffect(() => {
    const project = layoutProject()
    if (!project || project !== currentProject()) return
    // F1：持久化当前展示标签（entity 优先），避免恢复出旧的 "Chat N"。
    const tabs = sessionSnapshotTabs(sessions())
    const active = activeViewId()
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer)
    layoutSaveTimer = setTimeout(() => {
      saveProjectLayout(layoutIO, project, { tabs, activeViewId: active })
    }, 500)
  })
  onCleanup(() => { if (layoutSaveTimer) clearTimeout(layoutSaveTimer) })

  // Initial restore waits for the session list and a definitive Pod lookup.
  // A network/unknown Pod error is not definitive, so the hidden Lead tab is
  // kept rather than pruned on a transient failure.
  createEffect(() => {
    if (gwStatus()?.state !== "ready") return
    const pd = currentProject()
    if (!pd || layoutProject() === pd || switchingProject) return
    if (!sessionStore.isLoaded(pd)) return
    if (!leadResolvedFor(pd)) return
    const history = sessionStore.sessionsFor(pd) as unknown as LayoutHistorySession[]
    applyProjectLayout(pd, history)
    setLayoutProject(pd)
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

  const resolveCard = (sid: string, id: string, patch: Record<string, any>) => {
    setFlowCards(prev => {
      const list = (prev[sid] || []).map(c => (c.data.id === id ? ({ ...c, data: { ...c.data, ...patch } } as any) : c))
      return { ...prev, [sid]: list }
    })
  }

  const expireSessionCards = (sid: string) => {
    setFlowCards(prev => {
      const list = (prev[sid] || []).map(c => {
        if (c.data.status !== "pending") return c
        return { ...c, data: { ...c.data, status: "expired" } } as any
      })
      return { ...prev, [sid]: list }
    })
  }

  // mapAskCard/mapPermissionCard 均为纯函数模块（sse/handlers/flow-cards.ts、
  // components/permission-card-mapping.ts），agentTitle 经参数注入。
  const agentTitleOf = (sid: string) => sessionTitle(sid, sessions().find(s => s.id === sid)?.title) || "Agent"

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

  // ── Background reconcile（Task 11）：中性 `background.jobs.list` 快照 ──
  // gateway 三源合并后的列表就是权威快照（含终态行）；失败/旧 gateway 整轮
  // fail-open（不建假行、不误杀）。快照摄取静默（历史完成不弹通知）。
  // 成功返回空数组 = 该会话没有作业 → 清掉本地残留行（review minor）。
  async function reconcileBackground(): Promise<void> {
    const sid = activeSessionId()
    if (!sid) return
    await reconcileBackgroundOnce({
      sessionID: sid,
      fetchers: { listJobs: (sessionID) => window.api.mafw.background.jobs.list(sessionID) },
      ingest: (jobs) => ingestBackgroundJobs(jobs),
      clear: (sessionID) => clearBackgroundJobs(sessionID),
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
    registerUnifiedToolCards() // 统一声明式工具卡：在内置与 legacy 之后占位/覆盖
    registerThinkingBlock()   // reasoning part → dsh 式可折叠思考块
    // Use the modern session-ui rendering branch (rounded bubbles, v2 tokens).
    document.body.setAttribute("data-new-layout", "")
    // Increase inline-action cards navigate through the shell, not window events.
    configureGoalCreatedActions({
      open: (goalId) => { void openGoalAndDiscuss(goalId, "timeline") },
      status: async (goalId) => {
        const read = () => podStore.detail()?.goals.find((item) => item.goalId === goalId)
        let goal = read()
        if (!goal) {
          try {
            await podStore.refresh()
            goal = read()
          } catch { /* leave as unknown */ }
        }
        if (!goal) return null
        return {
          status: goal.status,
          stage: goal.stage.kind,
          label: podStageLabel(goal.stage),
          canCancel: goal.status === "active" && goal.stage.kind === "discussing",
        }
      },
      cancel: async (goalId) => {
        try {
          await podStore.refresh()
          const goal = podStore.detail()?.goals.find((item) => item.goalId === goalId)
          if (!goal || goal.status !== "active" || goal.stage.kind !== "discussing") {
            showToastV2({ description: "Goal 已进入执行或已结束，不能撤销", duration: 3500 })
            return false
          }
          await window.api.mafw.goals.stop(goalId)
          await podStore.refresh()
          showToastV2({ description: "已撤销刚创建的 Goal", duration: 2500 })
          return true
        } catch (err: any) {
          const message = String(err?.message ?? err)
          showToastV2({
            description: message.includes("409")
              ? "Goal 已进入执行或已结束，不能撤销"
              : `撤销失败：${message.slice(0, 120)}`,
            duration: 3500,
          })
          return false
        }
      },
    })
    onCleanup(() => configureGoalCreatedActions(null))
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
  // worktree / fork / diff / run 等业务动作全部读 Experience（不再缓存 runtime 能力）。
  // 目录随当前会话/项目传给 gateway：worktree supported/enabled 由本地 git +
  // session.create({directory}) 契约共同决定（设计 2026-11-02 §7.1）。
  const experienceDirectory = () => {
    const sid = currentSessionID()
    const fromSession = sid
      ? (store.session.find((s: any) => s.id === sid)?.directory as string | undefined)
      : undefined
    return fromSession && fromSession !== "." ? fromSession : currentProject() ?? undefined
  }
  const worktreeEnabled = () =>
    experienceStore.enabled("session.worktree") && experienceStore.state().directory === experienceDirectory()
  const revertUndoEnabled = () =>
    experienceStore.supported("checkpoint.restore") && experienceStore.semantics("checkpoint.restore")?.undo === true
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
  // E1-9: SSE lifecycle owned by the tested manager (see below).

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
      onCheckpointEvent: () => bumpCheckpointRev(),
      onRuntimeSwitched: () => {
        experienceStore.invalidate()
        sessionStore.invalidate()
        void refreshMenus()
        resetChatWorkspace()
        resetBackgroundCapability()
        void experienceStore.load(currentSessionID() || undefined, { directory: experienceDirectory() })
        void podStore.refresh()
      },
    },
    lifecycle: {
      invalidate: () => sessionStore.invalidate(),
      patch: (id, patch) => sessionStore.patch(id, patch),
      // F3/F4：session.updated 的标题唯一写入口（entity 缓存；未知 id 补建）。
      // 标签 / ChatPane 都从 sessionEntities 读，这里不回写 tab 或 store 副本；
      // Lead 角色名由 sessionTabTitle / chatPaneTitle 在读取端钉住。
      retitleOpenTab: (id, title) => retitleSessionEntity(id, title),
      remove: (id) => sessionStore.remove(id),
      closeIfOpen: (id) => { if (sessions().some(s => s.id === id)) closeSession(id) },
    },
    flowCards: {
      upsertCard,
      resolveCard,
      setPermissionMode: (sid, mode) => setPermissionModes(sid, mode),
      setCompactionMark: (sid, mark) => setCompactionMarks(prev => ({ ...prev, [sid]: mark })),
      onSessionConfig: (sid, config) => setSessionConfigs(sid, config as any),
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
      applyToolPart: (part, sid) => { toolPartScheduler.queue(part, sid) },
      flushToolParts: () => toolPartScheduler.flush(),
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
        const title = sessionTitle(sid, sessions().find(x => x.id === sid)?.title) || "会话"
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
    // 后台作业：canonical `background.job.updated` 旁路入 jobs store。
    background: {
      onEvent: (job) => ingestBackgroundJob(job),
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
    pod: {
      onEvent: (event) => {
        // `pod.updated` 保留（刷新 Pod 详情用）；完成通知已由 main 的 presence
        // 轮询统一负责（spec 2026-11-04 §7：渲染层不再 toast/通知）。
        ingestPodEvent(event)
      },
      // `pod.event`：事件层写入后的 inbox/角标信号，与详情刷新分开。
      // p1/p2 才影响 presence（结果/注意力）；p3（成员备注）不催轮询。
      onPodEvent: (event) => {
        podEvents.ingest(event)
        const severity = (event as any)?.properties?.severity
        if (severity === "p1" || severity === "p2") {
          void window.api.mafw.presence.refresh().catch(() => {})
        }
      },
    },
    // 统一插件包（Task 7）：修订通知 → 重拉 committed descriptors；
    // 已注册包事件 → 事件 hub（只做数据投递，绝不执行插件代码）。
    // 决定记录写入由 gateway `decision.updated` 推送（E6-3）：事件自带完整
    // record → 就地 upsert；旧 gateway 无 record → 回退 200ms 合并全量刷新。
    decisions: {
      onEvent: (event) => {
        if (!decisionStore.ingest(event)) scheduleDecisionRefresh()
      },
    },
    plugins: {
      onChanged: (event) => { void ingestPluginsChanged(event) },
      onEvent: (event) => { ingestPluginEvent(event) },
    },
  }

  // E1-9: connection lifecycle lives in `sse/sse-connection.ts` (unit-tested
  // singleton guard). The component only supplies gateway info + event routing.
  const sse = new SseConnection({
    open: async (since) => {
      const info = await window.api.mafw.gateway.info()
      if (!info?.url) {
        console.log("[mafw] SSE: no gateway URL yet, will retry")
        return null
      }
      console.log("[mafw] SSE connecting to", info.url)
      // URL 契约归 SDK（event.url）；EventSource 传输保持 renderer 直连。
      // E2-3：持久化游标以 ?since= 追加重连恢复点。
      return new EventSource(withSince(await window.api.mafw.event.url(), since))
    },
    onOpen: () => {
      console.log("[mafw] SSE connected")
      conn.report("sse-open")
    },
    // E2-3：只有 initial / truncated / reset / 实例变更才整表重同步。干净 resume
    // 由游标回放覆盖实体事件，不得清空列表（否则每次重连都是全量风暴）。
    onFullResync: (_reason, _info) => {
      // Gateway restarts keep the same port; reconnect is the only reliable
      // signal that the cached session list is stale.
      // E6-2: a full resync (reset/truncated/instance) also clears the entity
      // cache — a new epoch must not leave rows the gateway no longer has.
      sessionEntities.reset()
      sessionStore.invalidate()
      experienceStore.invalidate()
      void experienceStore.load(currentSessionID() || undefined, { directory: experienceDirectory() })
      reconcileFlowCards()
      void reconcileSubagents()
      resetBackgroundCapability()
      void reconcileBackground()
      // Task 7：重连是唯一可靠的「gateway 可能重启过」信号（同一端口），
      // client revision 的 bootId 会变化 → 必须重拉 committed descriptors。
      void refreshPluginClient()
      // Seed flow cards that arrived before the SSE connection (native APIs
      // return pending only). Idempotent, so per-open is safe.
      seedFlowCards()
    },
    // E2-3 / B2：part.delta 从不入 journal，游标回放无法恢复实时文本——
    // 每次重连都强制补拉活跃会话消息，并从 REST 对账其状态（不依赖空桶假设）。
    onReconnect: () => {
      const sid = activeSessionId()
      if (!sid) return
      void loadSessionHistory(sid, { force: true })
    },
    // E6-1：开流前用 REST replay 补齐断线缺口（与 live 帧同一 dispatcher）。
    // event_log 存的是 canonical `mafw_event` 信封；解包（raw.data || raw）与
    // live 路径一致，由 recoverEventGap 统一完成，这里只提供 baseUrl + dispatch。
    // 补页失败（404/旧网关/网络/超时/形状不符）→ null，SseConnection 回退原 since。
    recoverGap: async (since, limit) => {
      const info = await window.api.mafw.gateway.info()
      if (!info?.url) return null
      return recoverEventGap({
        baseUrl: info.url,
        since,
        limit,
        dispatch: (event) => dispatchShellEvent(event, sseDeps),
      })
    },
    onError: () => {
      console.log("[mafw] SSE error (will auto-reconnect)")
      conn.report("sse-error")
    },
    onMessage: (data) => {
      let raw: any
      try { raw = JSON.parse(data) } catch { return }
      // 全部事件经 dispatcher 纯路由分发（sse/dispatcher.ts + sse/handlers/*，
      // 分支语义见各 handler 注释；漏接线检测在 dispatcher 尾部 missTrace）。
      dispatchShellEvent(raw?.data || raw, sseDeps)
    },
  })
  const connectSse = () => sse.connect()

  // Seed flow cards that arrived before the SSE connection (native APIs return pending only).
  const seedFlowCards = () => {
    window.api.mafw.permissions.list().then((items: any[]) => {
      for (const req of items || []) upsertCard(req.sessionID, { kind: "permission", data: mapPermissionCard(req, Date.now()) })
    }).catch(e => console.warn("[mafw] permissions.list seed:", e))
    window.api.mafw.questions.list(questionsDirectory()).then((items: any[]) => {
      for (const req of items || []) upsertCard(req.sessionID, { kind: "ask", data: mapAskCard(req, Date.now()) })
    }).catch(e => console.warn("[mafw] questions.list seed:", e))
  }

  // SSE lifecycle: connect now, close on unmount, reconnect if the gateway
  // only becomes available after this window loaded.
  onMount(() => {
    const reconcileTimer = setInterval(reconcileFlowCards, 60000)
    // Task 7：committed plugin descriptors 的初始拉取（重连时 onopen 再拉一次，
    // 两次并发由 refreshPluginClient 的 in-flight 合并）。
    void refreshPluginClient()
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
    const offBackgroundNotify = onBackgroundTerminal((job) => {
      // runtime-shell only：subagent 归 P0-1，mafw-task 有任务通道（防双响）。
      if (job.kind !== "shell" || job.source !== "runtime-shell") return
      const notice = buildBackgroundNotice(job, { hidden: document.hidden })
      if (!notice) return
      showToastV2({ description: notice.toast, duration: 3000 })
      if (notice.os && bgWorkNotifyGate(Date.now())) notifyIfHidden(notice.os.title, notice.os.body)
    })
    // 子代理对账轮询（spec §4.6）：有 running 行才跑
    const subagentTimer = setInterval(() => {
      if (subagentRows().some(r => r.status === "running")) void reconcileSubagents()
    }, 15_000)
    // 后台作业对账轮询：有活跃作业才跑；快照失败由对账层 fail-open。
    const backgroundTimer = setInterval(() => {
      const busy = backgroundJobs().some(j => j.sessionID === activeSessionId() && (j.status === "running" || j.status === "input_required"))
      if (!busy) return
      void backgroundApiAvailable().then(ok => { if (ok) void reconcileBackground() })
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
      if (sse.source) { console.log("[mafw] SSE closing") }
      sse.dispose()
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
  // E2-3: `force` = 重连补拉——覆盖已存在的消息/部件并按 REST 对账状态。
  async function loadSessionHistory(sessionID: string, opts?: { force?: boolean }) {
    console.log("[mafw] loadSessionHistory", sessionID)
    try {
      const [data, sessionData] = await Promise.all([
        window.api.mafw.sessions.messages(sessionID, 100) as any, // MAFW flat：content = 部件数组（无 {info,parts} 信封）
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
        // 摄取层统一规范形：wire error→{kind,message}、工具输出/文件 diff/task 子会话、
        // step-finish→stopReason（渲染层只读规范视图）。
        const page = ingestHistoryPage(pageItems, { sessionID })
        const rawExisting = store.message[sessionID]
        const existing = Array.isArray(rawExisting) ? rawExisting : []
        if (!Array.isArray(rawExisting)) console.warn("[mafw] store.message non-array for", sessionID, typeof rawExisting)
        const existingById = new Map(existing.map(m => [m.id, m]))
        const msgs: any[] = [...existing]
        const parts: Record<string, any[]> = {}
        for (const message of page.messages) {
          const msgId = message.id
          if (!msgId) continue
          const itemParts = page.parts[msgId]
          if (existingById.has(msgId)) {
            // E2-3 force（重连补拉）：就地刷新已有消息的字段（保留对象 identity，
            // 避免 <For> 全量重挂），并用服务端部件覆盖 live 期间缺失的 delta。
            if (!opts?.force) continue
            const current = existingById.get(msgId)
            Object.assign(current, message)
            if (Array.isArray(itemParts) && itemParts.length > 0) {
              parts[msgId] = mergeLocalParts(store.part[msgId], itemParts)
            }
            continue
          }
          msgs.push(message)
          if (Array.isArray(itemParts) && itemParts.length > 0) {
            parts[msgId] = mergeLocalParts(store.part[msgId], itemParts)
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
            // 中途进入运行中的会话：规范 status（gateway 已按 time.busy > time.idle 投影）
            // → busy/retry；本地已存状态优先（live SSE 比取回的快照新），不无条件写 idle。
            // E2-3 force：重连对账以 REST 快照为准（修正重连期间漏掉的 idle/busy）。
            session_status: {
              ...prev.session_status,
              [sessionID]: opts?.force
                ? sessionStatusFromInfo(sessionData)
                : sessionStatusFromInfo(sessionData, prev.session_status[sessionID]),
            },
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
        const data2 = await window.api.mafw.sessions.messages(sessionID, 100, nextCursor ?? undefined) as any
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

  async function createSession(opts?: { noReveal?: boolean; requirePersisted?: boolean }) {
    console.log("[mafw] createSession")
    const enterChat = () => {
      setShowWelcome(false)
      setShowConfig(false)
      setActiveTab("chat")
    }
    // Persisted-only callers (Creator entry) must leave the current view alone
    // when the runtime cannot create the Session, so they fail without a fake
    // `local-` Session and without silently closing Config.
    if (!opts?.requirePersisted) enterChat()
    try {
      // E1-5: the gateway now requires an absolute `directory` on session
      // create. Send the current project; without one the call fails and falls
      // into the existing degraded path below.
      const projectDir = currentProject()
      const result = await window.api.mafw.sessions.create(projectDir ? { directory: projectDir } : {}) as any
      const id = result.id || result.sessionID || `sess-${Date.now()}`
      console.log("[mafw] createSession result id:", id)
      if (opts?.requirePersisted) enterChat()
      const userMsgId = `user-${Date.now()}`
      const sess: ChatSession = { id, title: `Chat ${sessions().length + 1}`, userMsgId, assistantMsgId: null, done: false }
      setSessions(prev => [...prev, sess])
      setActiveSessionId(id)

      // Add session to store
      setStore(prev => ({
        ...prev,
        session: [...prev.session, { id, title: sess.title, directory: ".", time: { created: Date.now() }, projectID: "." }],
        session_status: { ...prev.session_status, [id]: "idle" },
        message: { ...prev.message, [id]: [] },
      }))
      sessionStore.invalidate()
      if (!opts?.noReveal) {
        setActiveViewId(id)
      }
      return id
    } catch {
      if (opts?.requirePersisted) {
        showToastV2({ description: "无法创建会话：Gateway 未连接", duration: 4000 })
        return ""
      }
      enterChat()
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
  createEffect(() => {
    const sid = currentSessionID()
    const directory = experienceDirectory()
    if (gwStatus()?.state !== "ready") return
    experienceStore.invalidate()
    void experienceStore.load(sid || undefined, { directory })
  })

  // Composer menus: agents (@ mention) + providers/models (model pill)
  const gwReadyForMenus = createMemo(() => gwStatus()?.state === "ready")
  const [agentsData, setAgentsData] = createSignal<MafwAgent[]>([])
  const [providersData, setProvidersData] = createSignal<ProvidersEnvelope | null>(null)
  const [providersRetry, setProvidersRetry] = createSignal(0)
  let providersRetryTimer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => { if (providersRetryTimer) clearTimeout(providersRetryTimer) })
  const refreshMenus = () => {
    // 规范 DTO：`MafwAgent[]`（id/label/selectable/source）与 `{items: MafwProvider[]}`
    // （models 恒为数组）。不再读 runtime 原生 `{name, mode, hidden}` / `{all, models:{}}`。
    window.api.mafw.agents.list().then((list: MafwAgent[]) => {
      setAgentsData(Array.isArray(list) ? list : [])
    }).catch(e => console.warn("[mafw] agents.list:", e))
    window.api.mafw.providers.list().then((p: ProvidersEnvelope) => {
      setProvidersData(p)
      // Default the model pill to the most recently used model (first entry of
      // localStorage mafw-recent-models) — only when we have no default yet.
      if (defaultModel() === null) {
        try {
          const recent: string[] = JSON.parse(localStorage.getItem("mafw-recent-models") || "[]")
          const first = recent[0]
          if (first) {
            const findModel = (prov: MafwProvider, mid: string) => {
              const m = prov.models.find((model) => model.id === mid)
              return m ? { providerID: prov.id, modelID: mid, label: m.name || mid } : null
            }
            let found: { providerID: string; modelID: string; label: string } | null = null
            const slash = first.indexOf("/")
            if (slash > 0) {
              // Composite key: providerID/modelID
              const pid = first.slice(0, slash)
              const mid = first.slice(slash + 1)
              const prov = (p?.items || []).find((x) => x.id === pid)
              found = prov ? findModel(prov, mid) : null
            } else {
              // Legacy plain id: match the first provider that has it
              for (const prov of p?.items || []) {
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
    setAgentPicksExplicit({})
  }

  // Agent 列表来自 `MafwAgent[]`（规范 DTO）：`selectable` 表达可切换（primary），
  // `mode` 仍用于 mention 面的 subagent 分组；不再读 runtime 原生 `hidden`/`mode === 'primary'`。
  const agentEntryOf = (a: MafwAgent): AgentEntry => ({
    id: a.id,
    name: a.label || a.id,
    description: a.description,
    mode: a.mode,
    source: a.source,
    default: a.default,
    planning: a.planning,
  })
  const primaryAgents = createMemo(() =>
    (agentsData() || []).filter((a) => a.selectable).map(agentEntryOf),
  )
  const subagentAgents = createMemo(() =>
    (agentsData() || []).filter((a) => !a.selectable && a.mode === "subagent").map(agentEntryOf),
  )

  const modelGroups = createMemo(() => {
    const p = providersData()
    const groups: { provider: string; providerID: string; models: ModelEntry[] }[] = []
    for (const prov of p?.items || []) {
      // `connected === false` = gateway 明确报未连接；undefined = 未知（照常展示）
      if (prov.connected === false) continue
      const models: ModelEntry[] = (prov.models || []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        providerID: prov.id,
        provider: prov.name || prov.id,
        contextK: m.contextLimit ? Math.round(m.contextLimit / 1000) : undefined,
        vision: m.extensions?.vision === true,
        thinking: m.extensions?.thinking === true,
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
  // Per-session agent pick（对齐 modelPicks 模式）。值 = MafwAgent 的稳定 id。
  const [agentPicks, setAgentPicks] = createStore<Record<string, string>>({})
  // 用户本次显式选择过的会话（老 gateway 无 default 标记时，徽标只在显式选择后出现）。
  const [agentPicksExplicit, setAgentPicksExplicit] = createSignal<Record<string, true>>({})
  const [switchLogs, setSwitchLogs] = createSignal<Record<string, string[]>>({})
  const [taskListOpen, setTaskListOpen] = createSignal(false)
  const [viewportWidth, setViewportWidth] = createSignal(window.innerWidth)
  /** 主布局容器（rail + left dock + main + right dock）；用它的实际宽度做响应式判定。 */
  let bodyEl: HTMLDivElement | undefined
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
  // A 方案：窄窗不再并排，Chat / Workbench 两个全宽视图互斥切换；宽窗回到并排。
  const [narrowView, setNarrowView] = createSignal<"chat" | "workbench">("chat")
  // Focus 是会话级瞬态：不持久化，项目切换时退出（spec 2026-11-04 §4.2）。
  const [workbenchFocus, setWorkbenchFocus] = createSignal(false)
  const [focusState, setFocusState] = createSignal<WorkbenchState>(
    createWorkbenchState(currentProject() ?? "unscoped"),
  )
  createEffect(on(
    () => currentProject(),
    (project) => {
      clearChangeSetDocuments()
      configureDocumentListWorld(project ?? "unscoped")
    },
  ))
  const [focusOpenRequest, setFocusOpenRequest] = createSignal<FocusOpenRequest | null>(null)
  let focusOpenNonce = 0
  const requestFocusOpen = (root: string, rel: string, line?: number, persist = false) => {
    focusOpenNonce += 1
    setFocusOpenRequest({ root, rel, nonce: focusOpenNonce, line, persist })
  }
  let focusDetentSnapshot: WorkbenchDetent | null = null
  try {
    for (const key of [
      "mafw-workbench-context",
      "mafw-workbench-surface",
      "mafw-execution-section",
      "mafw-workbench-view",
      "mafw-right-dock-tab",
      "mafw-workbench-tab",
      "mafw-tasks-placement",
    ]) {
      localStorage.removeItem(key)
    }
  } catch { /* ignore */ }
  // 绝对 px 三档（520/640/760，默认 640）
  const [detent, setDetent] = createSignal<WorkbenchDetent>(workbenchBoot.detent)
  /** 拖动中的连续预览（松手吸附后清空）。 */
  const [chatPreview, setChatPreview] = createSignal<number | null>(null)
  // 二选一窄窗只存在一栏：推挤按当前可见栏的最小宽度算，而不是整窗的 split 预算。
  const narrowZone = () => workbenchZoneFor(viewportWidth() - LEFT_RAIL_WIDTH) === "narrow"
  const narrowRequiredMainWidth = () => narrowView() === "workbench" ? WORKBENCH_MIN_WIDTH : CHAT_COMFORT_MIN
  const leftDockRequiredMainWidth = () => narrowZone() ? narrowRequiredMainWidth() : PUSH_PAIR_BUDGET
  const availableWidth = () => Math.max(0, viewportWidth() - LEFT_RAIL_WIDTH - (leftDockMode() === "push" ? effectiveLeftDockWidth(leftDockWidth(), viewportWidth(), leftDockRequiredMainWidth()) : 0))
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
    return !!(sid && isWorkingStatus(store.session_status?.[sid]))
  }
  const mergedSessionDiffs = createMemo(() =>
    getSessionTurnDiffs().entries(currentSessionID() || "", sessionMessages()),
  )
  const sessionTurnChanges = createMemo<SessionTurnChange[]>(() => {
    const sid = currentSessionID()
    if (!sid) return []
    return buildSessionTurnChanges(
      sessionMessages(),
      store.part as Record<string, any[] | undefined>,
      getSessionTurnDiffs().perTurn(sid),
    )
  })
  createEffect(() => {
    const sid = currentSessionID()
    if (!sid) return
    // 始终为活动会话预热 per-turn 数据：composer badge 与 changes tree 共用同一份合并结果。
    getSessionTurnDiffs().ensure({
      sid,
      messages: sessionMessages(),
      busy: sessionBusy(),
      diffSupported: experienceStore.supported("branch.diff"),
    })
  })
  const welcomeFull = () => activeTab() === "chat" && !showConfig() && (showWelcome() || !activeSessionId())
  const chatActive = () => activeTab() === "chat" && !showConfig() && !welcomeFull()
  const workbenchContent = (): WorkbenchContentMode => (showConfig() ? "config" : "project")
  const narrowChat = () => narrowZone() && narrowView() === "chat"
  const chatSplit = () => workbenchSplit({ content: workbenchContent(), open: rightDockOpen() })
  const focusActive = () => workbenchFocusActive({ focus: workbenchFocus(), content: workbenchContent(), open: rightDockOpen() })
  const bodyColumns = () =>
    workbenchColumns({
      leftPx: leftDockMode() === "push" ? effectiveLeftDockWidth(leftDockWidth(), viewportWidth(), leftDockRequiredMainWidth()) : 0,
      chatPx: chatPx(),
      split: chatSplit(),
      focus: focusActive(),
      narrow: narrowZone(),
      narrowWorkbench: narrowZone() && rightDockOpen() && narrowView() === "workbench",
    })

  const applyRightDock = (open: boolean) => {
    if (!open) {
      if (focusDetentSnapshot !== null) {
        applyDetent(focusDetentSnapshot)
        focusDetentSnapshot = null
      }
      setWorkbenchFocus(false)
    }
    if (narrowZone()) setNarrowView(open ? "workbench" : "chat")
    setRightDockOpen(open)
    try { localStorage.setItem("mafw-right-dock-open", open ? "1" : "0") } catch { /* ignore */ }
  }
  const applyNarrowView = (view: "chat" | "workbench") => {
    if (view === "workbench" && !rightDockOpen()) {
      applyRightDock(true)
      return
    }
    setNarrowView(view)
  }
  createEffect(() => { if (!narrowZone()) setNarrowView("chat") })
  const toggleWorkbenchFocus = () => {
    if (workbenchFocus()) {
      if (focusDetentSnapshot !== null) {
        applyDetent(focusDetentSnapshot)
        focusDetentSnapshot = null
      }
      setWorkbenchFocus(false)
      return
    }
    focusDetentSnapshot = detent()
    if (!rightDockOpen()) applyRightDock(true)
    setWorkbenchFocus(true)
  }

  // Task 8/9：插件面板与配置页 tab 由 committed descriptors 投影，Desktop 只消费数据。
  const pluginSurfaceList = createMemo(() => pluginSurfaces(pluginDescriptors()))
  const pluginConfigSurfaceList = createMemo(() => pluginConfigSurfaces(pluginDescriptors()))
  // Task 9：沙箱 Web 页面与声明式面板共用 `plugin:<pkg>:<surface>` 身份与 L2 tab。
  const pluginWebSurfaces = createMemo(() => webSurfaceViews(pluginDescriptors()))
  // 页面通过 bridge 写的角标/标题（rail 与 tab 共用一个源）。
  const [pluginSurfaceRuntime, setPluginSurfaceRuntime] = createSignal(EMPTY_PLUGIN_SURFACE_RUNTIME)
  const pluginSurfaceIdList = createMemo(() => [
    ...pluginSurfaceList().map((surface) => surface.id),
    ...pluginConfigSurfaceList().map((surface) => surface.id),
    ...pluginWebSurfaces().map((surface) => surface.surfaceId),
  ])
  const pluginRailItems = createMemo(() => {
    const merged = [
      ...railItemsFromPanels(pluginSurfaceList()),
      ...railItemsFromWebSurfaces(pluginWebSurfaces()),
    ].sort(
      (a, b) =>
        a.order - b.order ||
        a.label.localeCompare(b.label) ||
        a.surfaceId.localeCompare(b.surfaceId),
    )
    return applyPluginRailState(merged, pluginSurfaceRuntime())
  })
  const gatewayUrl = () => gwStatus()?.url ?? ""
  const applyWebSurfaceBadge = (surfaceId: string, count: number) => {
    setPluginSurfaceRuntime((prev) => applyPluginSurfaceBadge(prev, surfaceId, count))
  }
  const applyWebSurfaceTitle = (surfaceId: string, title: string) => {
    setPluginSurfaceRuntime((prev) => applyPluginSurfaceTitle(prev, surfaceId, title))
  }
  // 错误面在宿主内部（DockBanner + 重试）；shell 只留诊断轨迹，避免后台 tab
  // 的失败被静默吞掉。
  const applyWebSurfaceError = (surfaceId: string, message: string) => {
    console.warn(`[plugins] ${surfaceId}: ${message}`)
  }
  const reportedPluginIssues = new Set<string>()
  createEffect(() => {
    for (const issue of pluginSurfaceIssues(pluginDescriptors())) {
      const key = `${issue.code}|${issue.package}|${issue.panel}`
      if (reportedPluginIssues.has(key)) continue
      reportedPluginIssues.add(key)
      console.warn(`[plugins] ${issue.message}`)
    }
  })
  // revision 变化移除 surface 后，页面已卸载不会再回调：清掉遗留的角标/标题
  // （prune 无变化时返回同一个对象，不会自激）。
  createEffect(() => {
    const live = pluginSurfaceIdList()
    setPluginSurfaceRuntime((prev) => prunePluginSurfaceRuntime(prev, live))
  })
  // 插件 surface 被删除后，活动焦点弹回上一个对象；根对象则回取景器。
  createEffect(() => {
    const active = activePluginSurface()
    if (!active) return
    if (pluginSurfaceIdList().includes(active)) return
    focusBack()
  })
  const openGoalContent = (input: {
    goalId: string
    revision: number
    worktreeDir: string
    title?: string | null
  }): void => {
    void (async () => {
      const scope = goalContentScope({ projectDir: currentProject(), ...input })
      if (!scope) {
        showToastV2({ description: "无法打开该 Goal 版本的文件", variant: "error", duration: 3500 } as any)
        return
      }
      let entries: unknown = null
      try {
        entries = await window.api.fs.listDir(scope.worktreeDir, "")
      } catch {
        entries = null
      }
      if (entries === null) {
        showToastV2({ description: "该 Goal 版本的文件已不可用", variant: "error", duration: 3500 } as any)
        return
      }
      revealWorkbench()
      const goalScope: Scope = {
        kind: "goal",
        worldId: scope.projectDir,
        goalId: scope.goalId,
        revision: scope.revision,
        worktreeDir: scope.worktreeDir,
      }
      setFocusState((state) =>
        applyGoalFocus(
          seedWorldRoot(state, goalScope),
          {
            projectDir: scope.projectDir,
            goalId: scope.goalId,
            revision: scope.revision,
            worktreeDir: scope.worktreeDir,
            title: input.title,
          },
        ),
      )
    })()
  }
  const returnToProjectContent = (): void => {
    openWorldOverview()
  }
  const recordRecentFile = (rel: string, scope: ContentScope | null): void => {
    const project = currentProject()
    const key = contentScopeKey(scope)
    if (!project || !scope || !key) return
    setRecentContent(recordRecentContent(project, {
      rel,
      scopeKey: key,
      scopeKind: scope.kind,
      scopeLabel: contentScopeLabel(scope),
      at: Date.now(),
      ...(scope.kind === "goal"
        ? { goalId: scope.goalId, revision: scope.revision, worktreeDir: scope.worktreeDir }
        : {}),
    }, window.localStorage))
  }
  /** 空栈时先放世界根，保证返回 / 面包屑有落点。 */
  const seedWorldRoot = (state: WorkbenchState, scope: Scope): WorkbenchState => {
    if (state.stack.length > 0) return state
    const worldScope: Scope = { kind: "world", worldId: scope.worldId }
    return openSubject({ ...state, worldId: scope.worldId }, worldScope, { kind: "world" })
  }
  /** 文件统一入口：按 fileOpenPlan 分流浏览器 / 编辑器，并记录 recent。 */
  const openFileInScope = (
    rel: string,
    root: string | null,
    scope: Scope,
    opts?: { persist?: boolean; line?: number },
  ): void => {
    if (!root) return
    revealWorkbench()
    // 分流（2026-10-27 文件预览）：html → 浏览器 surface（mafw-file:// 单 webview 导航）；
    // 图片/SVG/文本 → 文件 surface（编辑器内部按 kind 渲染）。
    if (fileOpenPlan(rel) === "browser") {
      void (async () => {
        const token = await fileProtocol.ensureRootToken(root)
        if (!token) {
          showToastV2({ description: "无法打开本地文件（文件协议注册失败）", variant: "error", duration: 4000 } as any)
          return
        }
        if (scope.worldId !== (currentProject() ?? "unscoped")) return // 世界已切换：丢弃迟到结果
        const url = buildMafwFileUrl(token, rel)
        try {
          requestBrowserNavigate(url)
          setFocusState((state) =>
            openSubject(
              { ...seedWorldRoot(state, scope), worldId: scope.worldId },
              scope,
              { kind: "web", url },
            ),
          )
          recordRecentFile(rel, contentScopeFromFocus(scope))
        } catch {
          showToastV2({ description: "无法打开该文件路径", variant: "error", duration: 4000 } as any)
        }
      })()
      return
    }
    requestFocusOpen(root, rel, opts?.line, opts?.persist === true)
    setFocusState((state) =>
      openSubject(
        { ...seedWorldRoot(state, scope), worldId: scope.worldId },
        scope,
        { kind: "file", root, rel },
      ),
    )
    recordRecentFile(rel, contentScopeFromFocus(scope))
  }
  /** 左栏插件入口：把插件 surface 作为焦点对象打开（spec 2026-11-09 §6.4）。 */
  const openPluginSurface = (surfaceId: PluginSurfaceId) => {
    openPluginFocus(surfaceId)
  }

  /** 审批三档直选（composer 图标循环 + 会话菜单共用；乐观更新失败回滚）。 */
  const applyPermissionMode = (mode: PermissionMode) => {
    const sid = activeSessionId()
    if (!sid) return
    const prev = permissionModes[sid] || "read-only"
    if (prev === mode) return
    setPermissionModes(sid, mode)
    window.api.mafw.permissions.setMode(sid, mode).catch(() => {
      setPermissionModes(sid, prev)
      showToastV2({ description: "切换审批模式失败", duration: 2000 })
    })
  }

  // External links: chat/workbench-visible links go to a new browser tab;
  // links from non-chat views stay visible via the system browser.
  onMount(() => {
    const off = window.api.browser.onOpenUrl((req) => {
      if (!chatActive()) {
        void window.api.browser.openExternal(req.url)
        return
      }
      openBrowserFocus(req.url, { newTab: true })
    })
    // 托盘菜单 / OS 通知点击 → 打开 Goal（跨项目先切项目）。
    const offNavigate = window.api.mafw.navigate.onGoal((target) => {
      const goalId = String(target?.goalId ?? "").trim()
      if (!goalId) return
      const projectDir = String(target?.projectId ?? "").trim()
      void (async () => {
        if (projectDir && projectDir !== currentProject()) {
          await handleSelectProject(projectDir).catch(() => {})
        }
        await openGoalAndDiscuss(goalId, "result")
      })()
    })
    onCleanup(() => {
      off()
      offNavigate()
    })
  })
  // 文件/编辑器根：会话目录属于项目（含 worktree）才采用，否则回退项目目录
  // （协调会话（Lead/历史 manager）的 directory 可能指向 home 等外部目录，实证 2026-10-22）
  // memo：sessions 数组在回合开始/结束会被替换（setUserMsgId/markSessionDone），
  // 裸函数会让每个读它的消费者重跑（文件树清空重载、Office 预览重解析白帧）。
  const benchRoot = createMemo(() =>
    resolveWorkbenchRoot(currentProject(), store.session.find((s: any) => s.id === currentSessionID())?.directory ?? null))

  const activeFocus = (): Focus | null =>
    focusState().stack[focusState().stack.length - 1] ?? null
  const activePluginSurface = (): PluginSurfaceId | null => {
    const subject = activeFocus()?.subject
    return rightDockOpen() && subject?.kind === "plugin"
      ? pluginSurfaceId(subject.package, subject.panel)
      : null
  }
  const contentScopeFromFocus = (scope: Scope): ContentScope =>
    scope.kind === "world"
      ? { kind: "project", projectDir: scope.worldId }
      : {
          kind: "goal",
          projectDir: scope.worldId,
          goalId: scope.goalId,
          revision: scope.revision,
          worktreeDir: scope.worktreeDir,
          title: null,
        }
  // 内容工作台 scope：项目根是默认值；Goal revision 只能由显式动作进入。
  // 与会话目录解耦，Chat 角色切换不会改变这里。
  const contentScope = createMemo<ContentScope | null>(() => {
    const focus = activeFocus()
    return focus ? contentScopeFromFocus(focus.scope) : projectContentScope(currentProject())
  })
  const [activeContentDocument, setActiveContentDocument] = createSignal<string | null>(null)
  const contentRoot = createMemo(() => contentScopeRoot(contentScope()) ?? currentProject())
  const currentContentScopeKey = createMemo(() => contentScopeKey(contentScope()))
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [pickerFiles, setPickerFiles] = createSignal<string[]>([])
  const focusScopeFromContent = (scope: ContentScope | null): Scope => {
    if (!scope) return { kind: "world", worldId: currentProject() ?? "unscoped" }
    if (scope.kind === "project") return { kind: "world", worldId: scope.projectDir }
    return {
      kind: "goal",
      worldId: scope.projectDir,
      goalId: scope.goalId,
      revision: scope.revision,
      worktreeDir: scope.worktreeDir,
    }
  }
  const focusScope = (): Scope => focusScopeFromContent(contentScope())
  const focusScopeLabel = (scope: Scope): string =>
    scope.kind === "world" ? "项目文件" : "Goal"
  const focusFrame = createMemo<FrameView | null>(() => {
    const focus = activeFocus()
    if (!focus) return null
    const subject = focus.subject
    const goalTitle = subject.kind === "goal"
      ? podStore.detail()?.goals.find((goal) => goal.goalId === subject.goalId)?.title
      : null
    const subjectLabel =
      subject.kind === "file" ? subject.rel
      : subject.kind === "goal" ? (goalTitle || "Goal")
      : subject.kind === "world" ? "世界总览"
      : subject.kind === "web" ? "浏览器"
      : subject.kind === "terminal" ? "终端"
      : subject.kind === "plugin" ? "插件"
      : subject.kind === "changeset"
        ? (changeSetDocuments().find((doc) => doc.id === subject.id)?.label ?? "改动")
      : "对象"
    const goalScope = focus.scope.kind === "goal" ? focus.scope : null
    const focusedGoal = goalScope
      ? podStore.detail()?.goals.find((goal) => goal.goalId === goalScope.goalId)
      : null
    const stack = focusState().stack
    const worldIndex = stack.findIndex((item) => item.subject.kind === "world")
    const scopeStartIndex = goalScope
      ? stack.findIndex((item) => item.scope.kind === "goal" && item.scope.goalId === goalScope.goalId)
      : (worldIndex >= 0 ? worldIndex : 0)
    return frameView({
      worldName: railProjectName(currentProject(), true),
      scopeLabel: focusScopeLabel(focus.scope),
      subjectLabel,
      worldIndex,
      scopeStartIndex,
      subjectIndex: stack.length - 1,
      revision: goalScope ? goalScope.revision : undefined,
      execution: focusedGoal ? executionBadgeFor(focusedGoal) ?? undefined : undefined,
      version: subject.kind === "file" ? "HEAD" : undefined,
      external: subject.kind === "web" || subject.kind === "terminal" || subject.kind === "plugin",
    })
  })
  const revealWorkbench = () => {
    closeLeftDockIfOverlay()
    setShowConfig(false)
    setActiveTab("chat")
    applyRightDock(true)
    if (narrowZone()) setNarrowView("workbench")
  }
  const openWorldOverview = () => {
    revealWorkbench()
    setPodGoalId(null)
    const worldId = currentProject() ?? "unscoped"
    const worldScope: Scope = { kind: "world", worldId }
    openSceneTab({ subject: { kind: "world" }, scope: worldScope, label: "世界总览", icon: "world" })
    setFocusState((state) =>
      openSubject({ ...state, worldId }, worldScope, { kind: "world" }),
    )
  }
  const openBrowserFocus = (url: string, opts?: { newTab?: boolean }) => {
    revealWorkbench()
    const target = url.trim()
    const blank = target.length === 0 || target === "about:blank"
    if (blank) {
      const tab = openBrowserDocument("", { newTab: true })
      if (!tab) {
        showToastV2({ description: "最多同时打开 12 个浏览器标签", duration: 2200 } as any)
        return
      }
    } else {
      requestBrowserNavigate(url, opts)
    }
    const scope = focusScope()
    setFocusState((state) =>
      openSubject(
        seedWorldRoot(state, scope),
        scope,
        { kind: "web", url: blank ? "about:blank" : url },
      ),
    )
  }
  const openTerminalFocus = () => {
    revealWorkbench()
    const scope = focusScope()
    const subject = { kind: "terminal" as const, id: "local" }
    openSceneTab({ subject, scope, label: "终端", icon: "terminal" })
    setFocusState((state) =>
      openSubject(seedWorldRoot(state, scope), scope, subject),
    )
  }
  /** 打开/激活一个改动集 tab，并把焦点切到对应 changeset subject。 */
  const openChangeSetTab = (input: OpenChangeSetInput) => {
    const doc = openChangeSetDocument(input)
    revealWorkbench()
    const next = selectFocus(
      seedWorldRoot(focusState(), input.scope),
      input.scope,
      { kind: "changeset", id: doc.id, rel: doc.activeFile ?? undefined },
    )
    setFocusState(next)
    syncStageToFocus(next)
    requestDocumentActivation(doc.id)
  }
  const openGoalChangeSet = (input: {
    podId: string
    goalId: string
    revision: number
    title: string
    scope: Scope
    root: string | null
    rel?: string
    line?: number
    reviewItemId?: string
  }) => {
    const source: ChangeSetSource = {
      kind: "goal",
      podId: input.podId,
      goalId: input.goalId,
      revision: input.revision,
      title: input.title,
    }
    openChangeSetTab({
      source,
      root: input.root,
      scope: input.scope,
      activeFile: input.rel ?? null,
      anchorLine: input.line,
    })
  }
  const openSessionChangeSet = (input: {
    sessionID: string
    title: string
    turnID?: string | null
    files?: readonly FileDiffEntry[]
    scope: Scope
    root: string | null
    rel?: string
    line?: number
  }) => {
    openChangeSetTab({
      source: {
        kind: "session",
        sessionID: input.sessionID,
        turnID: input.turnID ?? null,
        title: input.title,
      },
      root: input.root,
      scope: input.scope,
      files: input.files,
      activeFile: input.rel ?? null,
      anchorLine: input.line,
    })
  }
  const openPluginFocus = (surfaceId: string) => {
    const parsed = parsePluginSurfaceId(surfaceId)
    if (!parsed) return
    revealWorkbench()
    const scope = focusScope()
    openSceneTab({
      subject: { kind: "plugin", package: parsed.package, panel: parsed.panel },
      scope,
      label: `插件 · ${parsed.panel}`,
      icon: "plugin",
    })
    setFocusState((state) =>
      openSubject(
        seedWorldRoot(state, scope),
        scope,
        { kind: "plugin", package: parsed.package, panel: parsed.panel },
      ),
    )
  }
  const showWorkbenchLanding = () => {
    setFocusState(createWorkbenchState(currentProject() ?? "unscoped"))
    setPodGoalId(null)
    setPickerOpen(true)
    revealWorkbench()
  }
  const sceneSubjectOf = (subject: Focus["subject"]): SceneSubject | null => {
    if (subject.kind !== "world" && subject.kind !== "goal" && subject.kind !== "terminal" && subject.kind !== "plugin") {
      return null
    }
    return subject
  }
  const sceneLabelFor = (subject: SceneSubject): string => {
    if (subject.kind === "world") return "世界总览"
    if (subject.kind === "terminal") return "终端"
    if (subject.kind === "plugin") return `插件 · ${subject.panel}`
    const goal = podStore.detail()?.goals.find((item) => item.goalId === subject.goalId)
    return goal?.title ? `Goal · ${goal.title}` : "Goal"
  }
  /** 焦点回到场景 subject（含“返回上一焦点”）时保证 tab 存在。 */
  const ensureSceneTabFor = (subject: Focus["subject"], scope: Scope): string | null => {
    const scene = sceneSubjectOf(subject)
    if (!scene) return null
    const id = sceneTabId(scene)
    if (!sceneTabs().some((tab) => tab.id === id)) {
      openSceneTab({ subject: scene, scope, label: sceneLabelFor(scene), icon: scene.kind })
    }
    return id
  }
  const tabIdForSubject = (subject: Focus["subject"]): string | null => {
    if (subject.kind === "file") return fileDocumentTabId(subject.root, subject.rel)
    if (subject.kind === "changeset") return subject.id
    const scene = sceneSubjectOf(subject)
    return scene ? sceneTabId(scene) : null
  }
  const syncStageToFocus = (state: WorkbenchState) => {
    const focus = state.stack[state.stack.length - 1]
    if (!focus) return
    if (focus.subject.kind === "changeset") {
      setActiveChangeSetDocument(focus.subject.id)
      requestDocumentActivation(focus.subject.id)
      return
    }
    const tabId = tabIdForSubject(focus.subject) ?? ensureSceneTabFor(focus.subject, focus.scope)
    if (tabId) {
      if (documentTabs().some((entry) => entry.id === tabId)) activateDocumentTab(tabId)
      else requestDocumentActivation(tabId)
    }
    const action = stageActionFor(focus)
    if (action.kind === "editor") {
      requestFocusOpen(action.root, action.rel, action.line)
      return
    }
    if (action.kind === "browser" && /^(mafw-file|https?):\/\//.test(action.url)) {
      requestBrowserNavigate(action.url)
    }
  }
  const focusBack = () => {
    const state = focusState()
    if (state.stack.length > 1) {
      const next = popFocus(state)
      setFocusState(next)
      if (next.stack.at(-1)?.subject.kind !== "goal") setPodGoalId(null)
      syncStageToFocus(next)
      return
    }
    if (focusState().stack.length === 1) {
      showWorkbenchLanding()
    }
  }
  const focusCrumb = (index: number) => {
    const next = jumpTo(focusState(), index)
    setFocusState(next)
    syncStageToFocus(next)
  }
  /** 统一 tab 条 → 焦点栈：只切换，不重新读盘 / 不重新导航。 */
  const focusDocumentTab = (id: string) => {
    const entry = documentTabs().find((item) => item.id === id)
    if (!entry) return
    revealWorkbench()
    const base = focusScope()
    if (entry.kind === "file") {
      const root = contentRoot()
      if (!root) return
      const scope = contentScope() ? focusScopeFromContent(contentScope()!) : base
      const next = selectFocus(
        seedWorldRoot(focusState(), scope),
        scope,
        { kind: "file", root, rel: entry.view.id },
      )
      setFocusState(next)
      syncStageToFocus(next)
    } else if (entry.kind === "changeset") {
      const doc = changeSetDocuments().find((item) => item.id === id)
      if (!doc) return
      setActiveChangeSetDocument(id)
      const next = selectFocus(
        seedWorldRoot(focusState(), doc.scope),
        doc.scope,
        { kind: "changeset", id: doc.id, rel: doc.activeFile ?? undefined },
      )
      setFocusState(next)
      syncStageToFocus(next)
    } else if (entry.kind === "scene") {
      const tab = sceneTabs().find((item) => item.id === id)
      if (!tab) return
      const next = selectFocus(
        seedWorldRoot(focusState(), tab.scope),
        tab.scope,
        tab.subject,
      )
      setFocusState(next)
      syncStageToFocus(next)
    } else {
      const url = entry.view.title ?? ""
      const next = selectFocus(
        seedWorldRoot(focusState(), base),
        base,
        { kind: "web", url },
      )
      setFocusState(next)
      syncStageToFocus(next)
    }
    activateDocumentTab(id)
  }
  const closeDocumentTab = (id: string) => {
    if (id === WORLD_SCENE_TAB_ID) return
    const entries = documentTabs()
    const active = activeDocumentTabId()
    const wasActive = active === id
    const next = nextDocumentTabId(entries, id, active)
    requestCloseDocumentTab(id)
    if (!wasActive) return
    if (next) focusDocumentTab(next)
    else showWorkbenchLanding()
  }
  const closeDocumentTabs = (ids: readonly string[]) => {
    const closing = new Set(ids.filter((id) => id !== WORLD_SCENE_TAB_ID))
    const entries = documentTabs()
    const active = activeDocumentTabId()
    const wasActive = !!active && closing.has(active)
    const survivors = entries.filter((entry) => !closing.has(entry.id))
    for (const id of ids) requestCloseDocumentTab(id)
    if (!wasActive) return
    const next = survivors[0]?.id ?? null
    if (next) focusDocumentTab(next)
    else showWorkbenchLanding()
  }
  const sendAnnotation = (text: string, opts?: { imageDataUrl?: string }) => {
    const sid = currentSessionID()
    if (!sid) return
    const run = (async () => {
      if (!opts?.imageDataUrl) {
        return window.api.mafw.sessions.promptAsync({ sessionID: sid, message: text })
      }
      const task = await window.api.mafw.media.createTask({
        dataUrl: opts.imageDataUrl,
        mediaType: "image/png",
        question: text,
      })
      const pointer = `[媒体附件 taskID: ${task.id} contextID: ${task.contextId}（媒体: annotation.png），这是用户批注的区域截图——调用 mafw_media_ask 工具获取其内容后直接回应（taskID 填 ${task.id}）]`
      return window.api.mafw.sessions.promptAsync({ sessionID: sid, message: `${text}\n\n${pointer}` })
    })()
    void run
      .then(() => showToastV2({ description: "批注已发送给 agent", duration: 2000 } as any))
      .catch((e: any) => showToastV2({ description: `发送失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 4000 } as any))
  }
  const addAnnotation = (a: any) => {
    const sid = currentSessionID()
    if (!sid) return
    addPending({ sessionID: sid, ...a })
    showToastV2({ description: "已加入批注", duration: 1600 } as any)
  }

  // 焦点 → tab 条激活项：文档靠 id，场景靠 subject id；entry 可能稍后同步进来。
  createEffect(() => {
    documentTabs()
    const subject = activeFocus()?.subject
    if (!subject) return
    if (subject.kind === "web") {
      const byUrl = documentTabs().find(
        (item) => item.kind === "web" && (item.view.title ?? "") === subject.url,
      )
      const activeWeb = activeBrowserDocumentId()
      const entry = byUrl ?? (activeWeb
        ? documentTabs().find((item) => item.id === webDocumentTabId(activeWeb))
        : undefined)
      if (entry) activateDocumentTab(entry.id)
      return
    }
    const focus = activeFocus()
    if (!focus) return
    const id = tabIdForSubject(focus.subject) ?? ensureSceneTabFor(focus.subject, focus.scope)
    if (!id) return
    if (documentTabs().some((entry) => entry.id === id)) activateDocumentTab(id)
    else requestDocumentActivation(id)
  })
  const resolveGoalWorktreeDir = async (podId: string | null, goalId: string, project: string): Promise<string> => {
    if (!podId) return project
    try {
      const result = await window.api.mafw.pod.result(podId, goalId)
      const dir = result?.worktree?.dir
      if (!dir) return project
      const entries = await window.api.fs.listDir(dir, "").catch(() => null)
      return entries === null ? project : dir
    } catch {
      return project
    }
  }
  const openGoalChangeSetFromGoal = (
    goal: PodGoal,
    revision: number,
    opts?: { rel?: string; line?: number },
  ) => {
    const project = currentProject()
    if (!project) return
    const baseScope: Scope = {
      kind: "goal",
      worldId: project,
      goalId: goal.goalId,
      revision,
      worktreeDir: project,
    }
    void resolveGoalWorktreeDir(goal.podId, goal.goalId, project).then((root) => {
      openGoalChangeSet({
        podId: goal.podId,
        goalId: goal.goalId,
        revision,
        title: goal.title,
        scope: { ...baseScope, worktreeDir: root },
        root,
        rel: opts?.rel,
        line: opts?.line,
      })
    })
  }
  const openGoalFocus = (goalId: string, focus: GoalDetailFocus = "timeline") => {
    const project = currentProject()
    if (!project) return
    revealWorkbench()
    const goal = podStore.detail()?.goals.find((item) => item.goalId === goalId)
    const revision = goal ? (goalRevisionOf(goal) ?? goal.activeRevision ?? goal.revision ?? 1) : 1
    setPodGoalId(goalId)
    setGoalDetailFocus(focus)
    const goalScope: Scope = {
      kind: "goal",
      worldId: project,
      goalId,
      revision,
      worktreeDir: project,
    }
    openSceneTab({
      subject: { kind: "goal", goalId },
      scope: goalScope,
      label: goal?.title ? `Goal · ${goal.title}` : "Goal",
      icon: "goal",
    })
    setFocusState((state) =>
      applyGoalFocus(
        seedWorldRoot(state, goalScope),
        {
          projectDir: project,
          goalId,
          revision,
          worktreeDir: project,
          title: goal?.title ?? null,
        },
      ),
    )
    void resolveGoalWorktreeDir(podIdForCurrentProject(), goalId, project).then((worktreeDir) => {
      if (worktreeDir === project || currentProject() !== project) return
      if (goal) {
        openSceneTab({
          subject: { kind: "goal", goalId },
          scope: { ...goalScope, worktreeDir },
          label: `Goal · ${goal.title}`,
          icon: "goal",
        })
      }
      setFocusState((state) => {
        const top = state.stack[state.stack.length - 1]
        if (!top || top.subject.kind !== "goal" || top.subject.goalId !== goalId) return state
        return applyGoalFocus(
          state,
          {
            projectDir: project,
            goalId,
            revision,
            worktreeDir,
            title: goal?.title ?? null,
          },
        )
      })
    })
  }

  const listScopedFiles = async (scope: Scope | null): Promise<string[]> => {
    if (scope?.kind !== "goal") return window.api.mafw.files.list()
    const root = scope.worktreeDir
    const out: string[] = []
    const walk = async (rel: string): Promise<void> => {
      if (out.length >= 500) return
      const entries = await window.api.fs.listDir(root, rel).catch(() => null)
      for (const entry of entries ?? []) {
        if (out.length >= 500) return
        const next = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.kind === "dir") await walk(next)
        else out.push(next)
      }
    }
    await walk("")
    return out
  }
  const openSubjectPicker = () => {
    setPaletteOpen(false)
    setPickerOpen(true)
    void listScopedFiles(activeFocus()?.scope ?? null).then(setPickerFiles).catch(() => {})
  }
  const pickSubject = (item: PickerItem) => {
    setPickerOpen(false)
    if (item.subject.kind === "world") {
      openWorldOverview()
      return
    }
    if (item.subject.kind === "goal") {
      openGoalFocus(item.subject.goalId, "timeline")
      return
    }
    if (item.subject.kind === "file") {
      openFileInScope(
        item.subject.rel,
        item.subject.root,
        item.scope,
      )
      return
    }
    if (item.subject.kind === "web") {
      openBrowserFocus(item.subject.url, { newTab: true })
      return
    }
    const next = openSubject(
      { ...seedWorldRoot(focusState(), item.scope), worldId: item.scope.worldId },
      item.scope,
      item.subject,
    )
    setFocusState(next)
    syncStageToFocus(next)
  }

  let lastFocusWorld: string | null = null
  let lastAutoPickerWorld: string | null = null
  createEffect(on(() => currentProject(), () => { lastAutoPickerWorld = null }, { defer: true }))
  const validateFocusStack = async (worldId: string, state: WorkbenchState) => {
    const valid: Focus[] = []
    for (const focus of state.stack) {
      if (focus.scope.kind === "goal") {
        const entries = await window.api.fs.listDir(focus.scope.worktreeDir, "").catch(() => null)
        if (entries === null) continue
      }
      valid.push(focus)
    }
    if (valid.length === state.stack.length) return
    if (focusState() !== state) return
    if ((currentProject() ?? "unscoped") !== worldId) return
    setFocusState({ ...state, stack: valid })
    if (valid.length === 0) showWorkbenchLanding()
  }
  createEffect(() => {
    const worldId = currentProject() ?? "unscoped"
    if (lastFocusWorld === worldId) return
    if (lastFocusWorld) flushFocusPersistence(lastFocusWorld)
    lastFocusWorld = worldId
    const loaded = loadFocusState(worldId)
    let next = loaded
    if (!next) {
      const project = currentProject()
      const rawScope = project
        ? (() => { try { return localStorage.getItem(retiredContentScopeKey(project)) } catch { return null } })()
        : null
      const migrated = project
        ? migrateLegacyContentScope({
            worldId,
            projectDir: project,
            rawScope,
            readState: (key) => contentScopeStateFor(key),
          })
        : null
      next = migrated ?? createWorkbenchState(worldId)
      if (project) {
        try { localStorage.removeItem(retiredContentScopeKey(project)) } catch { /* ignore */ }
      }
      saveFocusState(next)
    }
    const state = next
    setFocusState(state)
    switchSceneTabWorld(worldId)
    const top = state.stack[state.stack.length - 1]
    openSceneTab({
      subject: { kind: "world" },
      scope: { kind: "world", worldId },
      label: "世界总览",
      icon: "world",
    })
    if (top?.subject.kind === "goal") {
      const subject = top.subject
      const goal = podStore.detail()?.goals.find((item) => item.goalId === subject.goalId)
      openSceneTab({
        subject,
        scope: top.scope,
        label: goal?.title ? `Goal · ${goal.title}` : "Goal",
        icon: "goal",
      })
    }
    syncStageToFocus(state)
    void validateFocusStack(worldId, state)
  })
  createEffect(() => {
    const worldId = currentProject()
    if (!worldId || lastFocusWorld !== worldId) return
    if (pickerOpen()) {
      lastAutoPickerWorld = worldId
      return
    }
    if (!shouldAutoOpenPicker({
      worldId,
      focusCount: focusState().stack.length,
      pickerOpen: pickerOpen(),
      rightDockOpen: rightDockOpen(),
      lastAutoPickerWorld,
    })) return
    lastAutoPickerWorld = worldId
    setPickerOpen(true)
  })
  createEffect(() => {
    saveFocusState(focusState())
  })
  onCleanup(() => { flushSceneTabs(); flushFocusPersistence() })
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+P：取景器（文件 / Goal / 终端…）。走快捷键注册表，与命令面板
      //（Ctrl+Shift+P）分开，避免同一次按键同时打开两个浮层。
      if (matchesCombo(event, keybindingFor("open-picker"))) {
        event.preventDefault()
        openSubjectPicker()
        return
      }
      if (event.key === "Escape" && pickerOpen()) {
        event.preventDefault()
        setPickerOpen(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })
  const contentScopeIsGoal = createMemo(() => contentScope()?.kind === "goal")
  // 项目主目录 scope 与最近内容（按项目持久化）。
  const [recentContent, setRecentContent] = createSignal<RecentContentEntry[]>([])
  createEffect(() => {
    setRecentContent(readRecentContent(currentProject(), window.localStorage))
  })
  const pickerItems = createMemo<PickerItem[]>(() => {
    const project = currentProject()
    const worldId = project ?? "unscoped"
    const scope = focusScope()
    const projectScope: Scope = { kind: "world", worldId }
    const filesRoot = scope.kind === "goal" ? scope.worktreeDir : (project ?? "")
    const items = buildFilePickerItems({
      worldId,
      files: pickerFiles(),
      filesRoot,
      recent: recentContent(),
      root: contentRoot() ?? filesRoot,
      scope,
      projectScope,
    })
    const goalItems = buildGoalPickerItems(
      podStore.detail()?.goals ?? [],
      project ?? "",
      project ?? "",
    )
    const worldItem = buildWorldPickerItem(worldId)
    return withCommandItems([worldItem, ...items, ...goalItems], buildCommandPickerItems(scope))
  })
  const contentDiffEntries = createMemo(() => diffsForContentScope({
    contentRoot: contentRoot(),
    sessionDirectory: store.session.find((s: any) => s.id === currentSessionID())?.directory ?? null,
    diffs: mergedSessionDiffs(),
  }))
  createEffect(() => {
    const sid = currentSessionID()
    if (!sid) return
    const live = mergedSessionDiffs()
    const perTurn = getSessionTurnDiffs().perTurn(sid)
    untrack(() => {
      for (const doc of changeSetDocuments()) {
        if (doc.source.kind !== "session" || doc.source.sessionID !== sid) continue
        if (doc.source.turnID) {
          const files = perTurn[doc.source.turnID]
          if (Array.isArray(files)) updateChangeSetDocument(doc.id, { files })
        } else {
          updateChangeSetDocument(doc.id, { files: live })
        }
      }
    })
  })
  const [changesRequest, setChangesRequest] = createSignal<ChangesRequest | null>(null)
  function sessionGoalRef(): GoalRef | null {
    const sid = currentSessionID()
    if (!sid) return null
    const detail = podStore.detail()
    const identity = goalSessionIdentity(detail, sid)
    if (!identity?.goalId) return null
    const goal = detail?.goals.find((item) => item.goalId === identity.goalId)
    if (!goal) return null
    return {
      podId: goal.podId,
      goalId: goal.goalId,
      revision: goal.activeRevision ?? goal.revision ?? identity.revision ?? 1,
      title: goal.title,
      worktreeDir: null,
    }
  }
  function currentGoalRef(): GoalRef | null {
    const detail = podStore.detail()
    const directId = podGoalId()
    if (directId) {
      const goal = detail?.goals.find((item) => item.goalId === directId)
      if (goal) {
        return {
          podId: goal.podId,
          goalId: goal.goalId,
          revision: goal.activeRevision ?? goal.revision ?? 1,
          title: goal.title,
          worktreeDir: null,
        }
      }
    }
    const focus = activeFocus()
    if (focus?.scope.kind === "goal") {
      const scope = focus.scope
      const goal = detail?.goals.find((item) => item.goalId === scope.goalId)
      if (goal) {
        return {
          podId: goal.podId,
          goalId: goal.goalId,
          revision: scope.revision,
          title: goal.title,
          worktreeDir: scope.worktreeDir,
        }
      }
    }
    return sessionGoalRef()
  }
  const openChangesFace = (input: {
    section?: "review" | "changes"
    rel?: string
    line?: number
  } = {}) => {
    revealWorkbench()
    openLeftDockFace("changes")
    setChangesRequest((previous) => nextChangesRequest(previous, input))
  }
  const activeGoalId = () => currentGoalRef()?.goalId ?? null
  const activeGoalAccepted = () => !!podStore.detail()?.goals.find((goal) => goal.goalId === activeGoalId())?.accepted
  const changesBadge = () => countReviewAttention(decisionStore.items())
  const changesDot = () => changesBadge() === 0 && contentDiffEntries().length > 0
  const openCurrentSessionChangeSet = () => {
    const sid = currentSessionID()
    if (!sid) {
      openChangesFace({ section: "changes" })
      return
    }
    const title = sessions().find((session) => session.id === sid)?.title ?? "本会话"
    openSessionChangeSet({
      sessionID: sid,
      title,
      scope: focusScope(),
      root: contentRoot(),
      files: contentDiffEntries(),
    })
    openChangesFace({ section: "changes" })
  }
  const openTurnChangeSet = (turn: SessionTurnChange) => {
    const sid = currentSessionID()
    if (!sid) return
    const title = `${turn.timeLabel} ${turn.title}`.trim()
    openSessionChangeSet({
      sessionID: sid,
      title,
      turnID: turn.id,
      scope: focusScope(),
      root: contentRoot(),
      files: turn.files,
    })
  }

  // 鲸群左栏：shell 持有常驻订阅，左右两栏共用同一个 pod-store
  // （spec 2026-10-30-pod-left-rail §4.1）。目录口径与右栏一致。
  const podBadgeCount = () => podRailBadge({
    attention: podStore.detail()?.attention ?? [],
    needsYou: decisionStore.loaded() ? decisionStore.counts().needsYou : undefined,
  })
  // Task 21：未查看结果 + 隐藏时 OS 通知。结果不是人类阻塞点（不进 podBadgeCount）。
  // Task 9：`isPodResultViewed` 已是事件 + legacy 双读，结果点随 `pod.events` 自动收敛。
  const podResultDot = () => {
    const detail = podStore.detail()
    if (!detail) return false
    // 冷启动事件列表还没拉回来时不要先闪一下「有新结果」；旧 gateway（supported=false）
    // 直接走 legacy localStorage，不受影响。
    if (podEvents.supported() && !podEvents.loaded()) return false
    return detail.goals.some((goal) => podResultBadge({
      resultReady: goal.resultReady,
      viewed: isPodResultViewed(detail.pod.id, goal.goalId, goalRevisionOf(goal) ?? 1),
    }) === "result")
  }
  // 完成通知在 main（presence 轮询 → OS 通知/托盘），渲染层不再 toast/记录待打开结果
  // （spec 2026-11-04 §7：通知逻辑退役，避免同一条结果双通知）。
  const [podPanelRequest, setPodPanelRequest] = createSignal<{
    tab: "team" | "memory"
    seq: number
    target?: "members" | "inbox"
  }>({ tab: "team", seq: 0 })
  const openPodPanelTab = (tab: "team" | "memory", target?: "members" | "inbox") => {
    closeLeftDockIfOverlay()
    setShowConfig(false)
    setActiveTab("chat")
    setShowWelcome(false)
    applyRightDock(true)
    openProjectWork()
    // The Pod dock is tabbed now; ask it to select and then scroll to the
    // requested section instead of assuming a single flat column.
    setPodPanelRequest((prev) => ({
      tab,
      ...(target ? { target } : {}),
      seq: prev.seq + 1,
    }))
  }
  // Task 19：Lead 只做协调，不讨论技术方案（spec §3.1）。有 Goal 处于 `discussing`
  // 时，在 Lead 的 composer 上方开一个入口，把用户送到该 Goal 的 Tech Lead 隐藏会话。
  // 判定口径：会话是当前项目的 Lead（kv 权威 id 或 tab 的 lead/manager 角色）。
  const activeSessionIsLead = (): boolean => {
    const sid = activeSessionId()
    if (!sid) return false
    const pd = currentProject()
    if (pd && currentLeadId(pd) === sid) return true
    return isLeadRole(tabSessionRole(sessions().find((s) => s.id === sid)))
  }
  const [showTopics, setShowTopics] = createSignal(false)
  const [topicItems, setTopicItems] = createSignal<LeadTopicListItem[]>([])
  const [topicBoundaries, setTopicBoundaries] = createSignal<LeadBoundaryView[]>([])
  const [topicBusy, setTopicBusy] = createSignal(false)
  const openTopics = async (): Promise<void> => {
    if (showTopics()) { setShowTopics(false); return }
    const projectDir = currentProject()
    if (!projectDir) return
    setTopicBusy(true)
    try {
      await refreshTopics(projectDir)
      setShowTopics(true)
    } catch (err: any) {
      showToastV2({ description: `读取话题失败：${err?.message || err}`, duration: 3000 } as any)
    }
    setTopicBusy(false)
  }
  const refreshTopics = async (projectDir: string): Promise<void> => {
    setTopicBusy(true)
    try {
      const result = await window.api.mafw.lead.topics.list({ projectDir })
      if (currentProject() !== projectDir) return
      setTopicItems(buildTopicList(result.items))
      const items = await Promise.all(result.items.map(async (topic) => {
        try {
          return (await window.api.mafw.lead.topics.boundaries(topic.id)).items
        } catch {
          return []
        }
      }))
      if (currentProject() !== projectDir) return
      setTopicBoundaries(proposedBoundaries(items.flat()))
    } finally {
      setTopicBusy(false)
    }
  }
  const resumeTopic = async (id: string): Promise<void> => {
    setTopicBusy(true)
    try {
      const result = await window.api.mafw.lead.topics.resume(id)
      setShowTopics(false)
      await openPodSession(result.sessionID)
    } catch (err: any) {
      showToastV2({ description: `恢复话题失败：${err?.message || err}`, duration: 3000 } as any)
    }
    setTopicBusy(false)
  }
  const forkTopic = async (id: string): Promise<void> => {
    setTopicBusy(true)
    try {
      const result = await window.api.mafw.lead.topics.fork(id)
      if (result.sessionID) {
        setShowTopics(false)
        await openPodSession(result.sessionID)
      }
    } catch (err: any) {
      showToastV2({ description: `分叉失败：${err?.message || err}`, duration: 3000 } as any)
    }
    setTopicBusy(false)
  }
  const boundaryAction = async (boundaryId: string, action: "accept" | "merge" | "undo"): Promise<void> => {
    const boundary = topicBoundaries().find((item) => item.id === boundaryId)
    if (!boundary || boundary.projectDir !== currentProject()) return
    setTopicBusy(true)
    try {
      await window.api.mafw.lead.boundaries[action](boundary.fromTopicId, boundaryId)
      const projectDir = currentProject()
      if (projectDir) await refreshTopics(projectDir)
    } catch (err: any) {
      showToastV2({ description: `边界操作失败：${err?.message || err}`, duration: 3000 } as any)
    }
    setTopicBusy(false)
  }
  createEffect(on(() => currentProject(), () => {
    setTopicItems([])
    setTopicBoundaries([])
  }, { defer: true }))
  const activeLeadGoalInvite = (): { goalId: string; title: string; stageLabel: string; sourceLabel?: string } | null => {
    if (!activeSessionIsLead()) return null
    // 2026-11-04：非终态 Goal 都保留邀请位；discussing 优先占位（刚建完的引导）。
    const goal = pickTechLeadInviteGoal(podStore.detail()?.goals ?? [])
    if (!goal) return null
    return {
      goalId: goal.goalId,
      title: goal.title || "未命名目标",
      stageLabel: podStageLabel(goal.stage),
      sourceLabel: goal.sourceRef?.topicId ? "来自 Lead 话题" : undefined,
    }
  }
  // 打开 Goal 的 Tech Lead 讨论：`pod.techLead` 确保隐藏会话存在；tab 标题只由 Goal
  // 标题派生，runtime session id 不出现在任何用户可见文案里（spec §3.2）。
  const openTechLead = async (goalId: string, isCurrent: () => boolean = () => true): Promise<void> => {
    const goal = podStore.detail()?.goals.find((item) => item.goalId === goalId)
    try {
      const history = await podStore.techLead(goalId)
      if (!isCurrent()) return
      if (!history?.sessionID) {
        showToastV2({ description: "Tech Lead 会话暂不可用", duration: 3000 } as any)
        return
      }
      // Task 20：记住这个隐藏会话讨论的是哪个 Goal——发送必须经 sendTechLeadMessage，
      // 由 gateway 注入 Tech Lead 身份和当前 revision 的 ContextManifest。
      techLeadGoalBySession[history.sessionID] = goalId
      // Task 21：打回后打开的是新 revision（标题带 rev N，讨论会话由 gateway 确保）。
      const title = techLeadTabTitle(goal?.title, history.revision)
      openSessionTab(history.sessionID, title, false, { mafw: { role: "tech_lead" } })
    } catch (e: any) {
      showToastV2({ description: `打开 Tech Lead 失败: ${e?.message || e}`, duration: 4000 } as any)
    }
  }
  // Task 21：打回成功后 PodDock 请求打开同一 Goal 的 Tech Lead 讨论。gateway 的 GET
  // techLead 会确保「新 revision」的隐藏讨论会话存在（旧 revision 会话不复活）。
  createEffect(on(() => podTechLeadOpenRequest(), (request) => {
    if (!request) return
    void openTechLead(request.goalId)
  }))

  // Tech Lead tab 的发送目标（当前会话 → Goal → Pod）。优先用本次打开时记录的映射；
  // 其余入口（PodDock / 左栏鲸群面 / Goal 详情会话）从 Pod 成员+作用域反推。
  // 发送时按项目目录解析 Pod（store 未加载/跨项目时 fail-open 到 lookup），不信任旧 detail。
  const resolveSendPod = async () => {
    const dir = currentProject()
    const loaded = podStore.detail()
    const sameProject = !!loaded && (!podStore.projectDir() || podStore.projectDir() === dir)
    return resolvePodDetailCached({
      loaded: sameProject ? loaded : null,
      projectDir: dir,
      key: `${dir ?? ""}|${sameProject && loaded ? loaded.pod.id : ""}`,
      // Pod 重建后 store revision 变化：旧 pod id 的缓存 detail 不得继续用于发送。
      revision: podStore.revision(),
      lookup: (projectDir) => window.api.mafw.pod.lookup(projectDir),
    })
  }
  const activeTechLeadGate = async () => {
    const sid = activeSessionId()
    if (!sid) return { target: null, blocked: null }
    const detail = await resolveSendPod()
    return techLeadSendGate({
      detail,
      sessionID: sid,
      mappedGoalId: techLeadGoalBySession[sid],
      role: tabSessionRole(sessions().find((session) => session.id === sid)),
    })
  }
  const activeTechLeadTarget = async (): Promise<{ podId: string; goalId: string } | null> => {
    return (await activeTechLeadGate()).target
  }
  /** Tech Lead thread → its Goal; Lead thread → whole project. */
  const activeTechLeadGoalId = (): string | null => {
    const sid = activeSessionId()
    if (!sid) return null
    const identity = goalSessionIdentity(podStore.detail(), sid)
    if (identity?.role === "tech_lead" && identity.goalId) return identity.goalId
    return techLeadGoalBySession[sid] ?? null
  }
  /** Episode 关闭时用的 Goal 身份：Pod 会话身份优先，其次 Tech Lead 映射/工作台焦点。 */
  const episodeGoalReference = (sessionID: string) => {
    const detail = podStore.detail()
    const identity = goalSessionIdentity(detail, sessionID)
    const focusScope = activeFocus()?.scope
    const scope = contentScope()
    return resolveEpisodeGoalReference({
      sessionID,
      techLeadGoalBySession,
      sessionGoal: identity?.goalId
        ? { goalId: identity.goalId, revision: identity.revision }
        : null,
      podLoaded: !!detail,
      podGoals: detail?.goals ?? [],
      focusGoal: focusScope?.kind === "goal"
        ? { goalId: focusScope.goalId, revision: focusScope.revision }
        : null,
      contentGoal: scope?.kind === "goal"
        ? { goalId: scope.goalId, revision: scope.revision }
        : null,
    })
  }
  /** 关闭 Episode → 起草一条用户来源的决定记录；确认仍由人类完成。 */
  const closeEpisodeToDecision = async (input: {
    episode: ChatEpisode
    summary: string
  }): Promise<string | null> => {
    const projectDir = currentProject()
    if (!projectDir) {
      showToastV2({ description: "当前没有项目，无法起草决定记录", duration: 3200 } as any)
      return null
    }
    const goal = episodeGoalReference(input.episode.sessionID)
    const title = input.episode.title.trim() || "未命名讨论"
    try {
      const result = await window.api.mafw.decisions.draft({
        projectDir,
        goalId: goal?.goalId ?? null,
        revision: goal?.revision ?? null,
        kind: "other",
        question: title,
        rationale: input.summary.trim() || null,
        evidence: [{
          kind: "message",
          ref: input.episode.startMessageId,
          label: title,
        }],
        source: "user",
      })
      await decisionStore.refresh()
      return result.record.id
    } catch (err: any) {
      showToastV2({
        description: `起草决定记录失败：${String(err?.message ?? err).slice(0, 120)}`,
        duration: 3600,
      } as any)
      return null
    }
  }
  /** 非讨论的 Tech Lead 节点会话 / Pod 不可解析：发送必须被拦住并给出指引。 */
  const activeTechLeadBlocked = async (): Promise<string | null> => {
    return (await activeTechLeadGate()).blocked
  }
  // 已结束会话：只有快照可读，绝不再走 live open（runtime 会话可能已被销毁）。
  const [podTranscriptTarget, setPodTranscriptTarget] = createSignal<{ podId: string; sessionId: string } | null>(null)
  const openPodTranscript = async (sessionId: string): Promise<void> => {
    const detail = podStore.detail() ?? await resolveSendPod()
    const podId = detail?.pod.id
    if (!podId) {
      showToastV2({ description: "鲸群尚未加载，无法读取会话快照", duration: 3500 } as any)
      return
    }
    setPodTranscriptTarget({ podId, sessionId })
  }
  // Pod 会话统一入口：Tech Lead 会话带上角色/Goal（供发送通道与 tab 语义使用），
  // 成员、时间线、通知与历史恢复都从这里拿同一份 Goal/revision/role 身份。
  const openPodSession = async (sid: string, title?: string) => {
    const detail = podStore.detail() ?? (sid ? await resolveSendPod() : null)
    const identity = goalSessionIdentity(detail, sid)
    if (sid && identity?.ended) {
      if (identity.transcript) await openPodTranscript(sid)
      else showToastV2({ description: "该会话已结束且没有可读快照", duration: 3500 } as any)
      return
    }
    const route = podSessionRoute(detail, sid)
    if (!sid || route?.role === "lead") {
      if (!detail) {
        showToastV2({ description: "鲸群尚未加载，无法打开 Lead", duration: 3500 } as any)
        return
      }
      try {
        const ensured = await podStore.ensureLead()
        await podStore.refresh()
        const lead = resolveLeadSession({ leadSessionId: ensured.sessionId })
        if (lead) openSessionTab(lead.id, lead.title, lead.lead, lead.metadata)
      } catch (err: any) {
        showToastV2({ description: `打开 Lead 失败: ${err?.message || err}`, duration: 4500 } as any)
      }
      return
    }
    if (identity && identity.role && identity.role !== "lead") {
      if (route?.isDiscussion && identity.goalId) techLeadGoalBySession[sid] = identity.goalId
      openSessionTab(sid, identity.title, false, { mafw: { role: identity.role } })
      return
    }
    openSessionTab(sid, title)
  }
  // 已打开的 tab（含布局恢复的 Chat N）在 Pod 详情到达后升级为同一 Goal 身份。
  createEffect(() => {
    const detail = podStore.detail()
    if (!detail) return
    const prev = sessions()
    const next = reconcileGoalSessionTabs(prev, detail)
    if (next === prev) return
    setSessions(next)
    // E6-2：Goal 身份标题/角色同样落到实体缓存（tab 只保留兜底 title）。
    for (let i = 0; i < next.length; i++) {
      if (next[i] === prev[i]) continue
      const tab = next[i]
      // 标题只在 reconcile 真的改过时写回实体，避免把 tab 的兜底旧标题
      // 覆盖掉 session.updated 刚写入实体的新标题。
      const titleChanged = !!tab.title && tab.title !== prev[i]?.title
      sessionEntities.patch(tab.id, {
        ...(tab.metadata ? { metadata: tab.metadata } : {}),
        ...(titleChanged ? { title: tab.title } : {}),
      })
    }
  })
  // 「记入鲸群」：chatview 的一条消息 → 一条 Pod note（不自动镜像，见
  // docs/research/2026-10-31-agent-chat-vs-team-log.md）。
  const recordPodNote = async (input: {
    sessionID: string
    messageID: string
    role: "user" | "assistant"
    text: string
  }): Promise<void> => {
    const detail = podStore.detail()
    const lead = detail?.members.find((member) => member.role === "lead")
    if (!detail || !lead) {
      showToastV2({ description: "当前项目还没有鲸群", duration: 2500 } as any)
      return
    }
    const role = podRoleForSession(detail, input.sessionID)
    const speaker = input.role === "user" ? "你" : (role ? `${role}` : "成员")
    const body = buildPodNoteBody({
      speaker,
      sessionId: input.sessionID,
      messageId: input.messageID,
      text: input.text,
    })
    if (!body) return
    try {
      await window.api.mafw.pod.sendMessage(detail.pod.id, {
        fromMemberId: lead.id,
        kind: "note",
        body,
      })
      void podStore.refresh()
      showToastV2({ description: "已记入鲸群", duration: 2500 } as any)
    } catch (err: any) {
      showToastV2({ description: `记入失败：${String(err?.message ?? err).slice(0, 60)}`, duration: 3000 } as any)
    }
  }

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
  const initialLeftDockNarrow = workbenchZoneFor(window.innerWidth - LEFT_RAIL_WIDTH) === "narrow"
  const [leftDock, setLeftDock] = createSignal<{ face: LeftDockFace; open: boolean }>({
    face: normalizeLeftDockFace(localStorage.getItem("mafw-left-dock-face")),
    open: restoreLeftDockOpen(
      localStorage.getItem("mafw-left-dock-open"),
      window.innerWidth,
      initialLeftDockWidth.width,
      initialLeftDockNarrow ? CHAT_COMFORT_MIN : PUSH_PAIR_BUDGET,
    ),
  })
  try {
    const storedFace = localStorage.getItem("mafw-left-dock-face")
    if (storedFace && storedFace !== leftDock().face) {
      localStorage.setItem("mafw-left-dock-face", leftDock().face)
    }
  } catch { /* ignore */ }
  let lastLeftDockMode: "push" | "overlay" | null = null
  const leftDockMode = () =>
    resolveMode(leftDock().open, viewportWidth(), leftDockWidth(), leftDockRequiredMainWidth(), lastLeftDockMode)
  createEffect(() => {
    const mode = leftDockMode()
    if (mode !== "closed") lastLeftDockMode = mode
  })
  const openLeftDockFace = (face: LeftDockFace) => {
    // Persist before state, same ordering rule as toggle/close.
    try {
      localStorage.setItem("mafw-left-dock-open", "1")
      localStorage.setItem("mafw-left-dock-face", face)
    } catch { /* ignore */ }
    setLeftDock({ face, open: true })
  }
  const toggleLeftDock = (face: LeftDockFace) => {
    // Persist BEFORE setLeftDock: shouldAutoRestoreLeftDock reads localStorage in
    // an effect; if state flips first it sees the old "1" and immediately reopens
    // (the old two-click-to-close bug).
    const next = toggleLeftDockState(leftDock(), face, localStorage)
    setLeftDock(next)
  }
  const closeLeftDock = () => {
    // Same ordering rule as toggleLeftDock (avoid the auto-restore reopen).
    const next = closeLeftDockState(leftDock(), localStorage)
    setLeftDock(next)
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

  // 鲸群常驻订阅：目录口径与右栏一致；SSE 重连后补一次刷新
  // （spec 2026-10-30-pod-left-rail §4.1）。两个 effect 都用 on() 隔离依赖：
  // open()/refresh() 会同步读 detail()/refreshing()/projectDir()，裸 effect 会把
  // 这些 signal 变成依赖 → 自触发无限刷新（pod listMessages / cost 打屏）。
  createEffect(on(() => benchRoot() ?? currentProject(), (dir, previous) => {
    if (previous !== undefined && dir !== previous) {
      if (focusDetentSnapshot !== null) {
        applyDetent(focusDetentSnapshot)
        focusDetentSnapshot = null
      }
      setWorkbenchFocus(false)
    }
    if (dir) void podStore.open(dir)
  }))
  // Task 9：事件 inbox 跟随当前 Pod。只按 pod id 变化触发（detail 每次刷新都是新对象，
  // 直接读 detail 会让 refresh 自触发）。
  createEffect(on(() => podStore.detail()?.pod.id ?? null, (podId) => {
    podEvents.setPod(podId)
    if (podId) void podEvents.refresh(podId)
  }))
  createEffect(on(() => connPhaseLabel(), (phase, previous) => {
    if (phase === "connected" && previous !== "connected") {
      void podStore.refresh()
      void podEvents.refresh()
    }
  }))
  const dockPresent = createPresence(() => rightDockOpen(), SURFACE_MS)

  // Ctrl/Cmd+J: toggle the TaskBar popover. Skip when typing. (C3 可自定义)
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesCombo(e, keybindingFor("taskbar"))) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      e.preventDefault()
      setTaskListOpen(o => !o)
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // 布局开关快捷键（VS Code 惯例）：Ctrl+B 侧边栏、Ctrl+Alt+B 面板（C3 均可自定义）。skip when typing.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      const left = matchesCombo(e, keybindingFor("toggle-leftdock"))
      const right = !left && matchesCombo(e, keybindingFor("toggle-rightdock"))
      if (!left && !right) return
      e.preventDefault()
      if (right) applyRightDock(!rightDockOpen())
      else toggleLeftDock("sessions")
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Ctrl+Alt+F：工作台 Focus（全宽 / 恢复 chat 列）。瞬态、不持久化（C3 可自定义）；
  // Ctrl+Shift+M 保留给 main 进程全局 Quick Entry，避免 OS 级快捷键抢占。
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesCombo(e, keybindingFor("toggle-workbench-focus"))) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      e.preventDefault()
      toggleWorkbenchFocus()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Ctrl/Cmd+K: 打开左栏搜索面（全局搜索入口；C3 可自定义）。
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesCombo(e, keybindingFor("open-search"))) return
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

  // Ctrl/Cmd+`：终端 surface 级开合（VS Code/Zed 惯例，C3 可自定义）。
  // capture 阶段消费——xterm 聚焦时也要先生效（否则 Ctrl+` 以 \x00 落进 PTY）；
  // 当前就是终端 → 回上一个文件/浏览器 surface；否则打开工作台 › 终端。
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesCombo(e, keybindingFor("toggle-terminal"))) return
      e.preventDefault()
      e.stopPropagation()
      if (activeFocus()?.subject.kind === "terminal") focusBack()
      else openTerminalFocus()
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  // 宽度跟踪：量主布局容器（不是 window.innerWidth），窗口 / 侧栏变化都会触发。
  onMount(() => {
    const el = bodyEl
    if (!el) return
    const update = () => setViewportWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })
  // 启动时因窄幅被抑制的 open 偏好，在拉宽到 push 阈值后恢复。
  createEffect(() => {
    const width = viewportWidth()
    const required = leftDockRequiredMainWidth()
    if (!shouldAutoRestoreLeftDock(localStorage.getItem("mafw-left-dock-open"), leftDock().open, width, leftDockWidth(), required)) return
    setLeftDock((s) => ({ ...s, open: true }))
  })
  // 浮层模式：Esc 关闭（点外关闭由 backdrop 承担）。
  createEffect(() => {
    if (leftDockMode() !== "overlay") return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeLeftDock() }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const subagentRunning = (id: string) => isWorkingStatus(store.session_status[id])

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

  // Lead sessions are locked to the Lead agent — switching to another
  // primary agent is not allowed there.
  // 判定已收敛进 ChatPane（workspace.sessionRole per-session，lead/manager 同义）

  const applyAgentSwitch = (a: AgentEntry, sidOverride?: string) => {
    const sid = sidOverride ?? currentSessionID()
    if (sid) {
      // 稳定键是 agent id（来自 MafwAgent DTO），显示名只用于展示
      const prev = agentPicks[sid]
      setAgentPicks(sid, agentKey(a))
      setAgentPicksExplicit(prevExplicit => ({ ...prevExplicit, [sid]: true }))
      setSwitchLogs(prev => ({ ...prev, [sid]: [...(prev[sid] || []), `已切换到 ${a.name}`] }))
      // sticky 即时切换：失败回滚本地 pick，防“显示已切换但服务端没切”。
      void window.api.mafw.sessions.switchAgent(sid, agentKey(a)).catch(() => {
        setAgentPicks(sid, prev as any)
        setAgentPicksExplicit(prevExplicit => {
          const next = { ...prevExplicit }
          delete next[sid]
          return next
        })
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

  // ── Creator entry (spec §15.7) ──────────────────────────────────────────
  // Ordinary blank Session + `mafw-create` agent switch through the existing
  // channels: no Creator Session API, draft store or second agent binding.
  const creatorAgentEntry = () => primaryAgents().find(a => isAgentKey(a, "mafw-create")) ?? null
  const creatorEntry = createMemo(() =>
    creatorEntryState({
      agentsLoaded: agentsData().length > 0,
      hasCreator: !!creatorAgentEntry(),
      isWorktree: benchRoot() !== currentProject(),
    })
  )
  const openCreatorSession = async (): Promise<void> => {
    if (!creatorEntry().available) return
    const agent = creatorAgentEntry()
    if (!agent) return
    const activeSid = activeSessionId()
    const reusable = reusableCreatorSession({
      activeSessionID: activeSid,
      messagesBySession: store.message,
      // Seeded `[]` is not proof of blank: only a completed page load is.
      pageState,
      // A Lead/manager tab or a session rooted outside the project must never be
      // switched to mafw-create (drafts are promised under the project path).
      activeSessionRole: activeSid ? workspace.sessionRole(activeSid) : undefined,
      activeSessionDirectory: store.session.find((s: any) => s.id === activeSid)?.directory ?? null,
      projectRoot: currentProject(),
    })
    const sid = reusable ?? (await createSession({ noReveal: true, requirePersisted: true }))
    if (!sid) return // persisted creation failed (toast already shown)
    applyAgentSwitch(agent, sid)
    setShowConfig(false)
    openSessionTab(sid)
  }

  // sticky agent：session.agent 是运行时真值——应用重启后用它把 agent 选择补回来；
  // 本地已有选择时不覆盖（用户刚点的选择先于服务端旧值，直到下一条消息把切换写入会话）。
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
      if (s?.state === "ready" && !sse.source) void connectSse()
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
      <MenuHost controller={menuController} />
      <PluginMenuWiring sessionID={activeSessionId()} />
      <TextMenuBridge />
      <ToastV2.Region />
      <UpdaterBanner />
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
          onLead={() => { void openLeadEntry() }}
          onTeam={() => openProjectTeam()}
          leadActive={activeSessionIsLead()}
          onApprovals={() => { closeLeftDockIfOverlay(); setShowConfig(false); setActiveTab("approvals") }}
          onMcp={() => { closeLeftDockIfOverlay(); setShowConfig(false); setActiveTab("mcp") }}
          onConfig={() => { closeLeftDockIfOverlay(); setConfigSection(undefined); setShowConfig(true) }}
          onNewSession={() => { closeLeftDockIfOverlay(); void createSession().then((sid: any) => { if (sid) openSessionTab(sid) }) }}
          onNewWorktreeSession={() => createWorktreeSession()}
          worktreeEnabled={worktreeEnabled()}
          approvals={pendingPermissionCount()}
          changesBadge={changesBadge()}
          changesDot={changesDot()}
          podBadge={podBadgeCount()}
          podResultDot={podResultDot()}
          pluginItems={pluginRailItems()}
          pluginActiveSurface={activePluginSurface()}
          onPluginItem={openPluginSurface}
          connPhase={connPhaseLabel()}
          gatewayState={gwStatus()?.state ?? null}
          approvalsActive={activeTab() === "approvals" && !showConfig()}
          mcpActive={activeTab() === "mcp" && !showConfig()}
          configActive={showConfig()}
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
          titleOf={(id, fallback) => titleOfSession(id, fallback)}
          activeViewId={activeViewId}
          onSelect={(id) => { closeLeftDockIfOverlay(); setShowConfig(false); setActiveTab("chat"); setShowWelcome(false); setActiveSessionId(id); setActiveViewId(id) }}
          onClose={closeSession}
          onRename={(id, next) => {
            // 用户重命名是显式意图：实体是展示真值，tab 只保留持久化兜底。
            setSessions(prev => prev.map(x => x.id === id ? { ...x, title: next } : x))
            if (!sessionEntities.patch(id, { title: next })) sessionEntities.upsert({ id, title: next })
            window.api.mafw.sessions.rename(id, next)
              .catch((err: any) => showToastV2({ description: `重命名失败: ${err?.message || err}`, duration: 3000 }))
          }}
          onExport={(id) => void exportSession(id)}
          onCopyId={copyText}
          onNew={createSession}
          podRoleOf={(id) => podRoleForSession(podStore.detail(), id)}
          forkEnabled={experienceStore.supported("branch.fork")}
          onFork={(id) => void forkSessionFromMenu(id)}
          onHome={() => {
            closeLeftDockIfOverlay()
            setShowConfig(false)
            setActiveTab("chat")
            setShowWelcome(true)
          }}
        />
        <div class="mafw-topstrip-spacer" />
        <Show when={narrowZone() && !showConfig()}>
          <div class="mafw-narrow-switch" role="group" aria-label="Chat / Workbench">
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-narrow-tab"
              aria-pressed={narrowView() === "chat"}
              onClick={() => applyNarrowView("chat")}
            >
              Chat
            </ButtonV2>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-narrow-tab"
              aria-pressed={narrowView() === "workbench"}
              onClick={() => applyNarrowView("workbench")}
            >
              Workbench
            </ButtonV2>
          </div>
        </Show>
        <Show when={!showConfig()}>
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
      <div ref={(el) => { bodyEl = el }} class="mafw-body" style={{ "grid-template-columns": bodyColumns() }}>
        <Show when={leftDockMode() !== "closed"}>
          <Show when={leftDockMode() === "overlay"}>
            <div class="mafw-left-dock-backdrop" onClick={closeLeftDock} />
          </Show>
          <LeftDock
            mode={leftDockMode()}
            face={leftDock().face}
            width={leftDockMode() === "push" ? effectiveLeftDockWidth(leftDockWidth(), viewportWidth(), leftDockRequiredMainWidth()) : leftDockWidth()}
            resizeMax={leftDockPushDragMax(viewportWidth(), leftDockRequiredMainWidth())}
            onClose={closeLeftDock}
            onResize={applyLeftDockWidth}
            activeSessionId={activeSessionId()}
            projectsRev={projectsRev}
            contentRoot={contentRoot()}
            contentScopeKey={currentContentScopeKey()}
            sessionID={currentSessionID()}
            onOpenFile={(rel) => {
              const root = contentRoot()
              if (!root) return
              closeLeftDockIfOverlay()
              openFileInScope(rel, root, focusScopeFromContent(contentScope()), { persist: true })
            }}
            renderChanges={() => (
              <ChangesFace
                request={changesRequest()}
                goals={podStore.detail()?.goals ?? []}
                sessions={sessions().map((session) => ({ id: session.id, title: session.title ?? "未命名" }))}
                activeSessionID={currentSessionID()}
                activeGoalId={activeGoalId()}
                turns={sessionTurnChanges()}
                sessionDiffs={contentDiffEntries()}
                reviewGoal={currentGoalRef() ?? sessionGoalRef()}
                accepted={activeGoalAccepted()}
                onReviewChanged={() => { void podStore.refresh() }}
                reviewRefreshKey={() => podStore.reviewRevision()}
                reviewCountForGoal={(goalId) => countReviewAttention(decisionStore.items(), goalId)}
                onOpenGoal={(goalId) => openGoalFocus(goalId, "timeline")}
                onOpenGoalChangeSet={(goal, revision) => openGoalChangeSetFromGoal(goal, revision)}
                onOpenSession={(sid) => openSessionTab(sid)}
                onOpenTurnChangeSet={openTurnChangeSet}
                onOpenSessionChangeSet={openCurrentSessionChangeSet}
              />
            )}
            onNewSession={() => { closeLeftDockIfOverlay(); void createSession().then(sid => { if (sid) openSessionTab(sid) }) }}
            onSelectSession={openSessionTab}
            onSessionDeleted={closeSession}
            forkEnabled={experienceStore.supported("branch.fork")}
            onForkSession={(id) => void forkSessionFromMenu(id)}
            onExportSession={(id) => void exportSession(id)}
          />
        </Show>
        <div class="mafw-main" classList={{ "mafw-narrow-chat": narrowChat() }}>
          <div class="mafw-content" classList={{ "mafw-chat-content": activeTab() === "chat" }}>
            <Show when={connDown()}><ConnBanner /></Show>
            {showConfig() ? (
              <ConfigPage onBack={() => { setShowConfig(false); setConfigSection(undefined) }} initialSection={configSection()} theme={theme() ?? undefined} onToggleTheme={toggleTheme} projectDir={benchRoot() ?? undefined} sessionID={currentSessionID() || undefined} onCreatePlugin={() => void openCreatorSession()} creatorEntry={creatorEntry()} />
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
                          agentExplicit={() => {
                            const sid = activeSessionId()
                            return !!(sid && agentPicksExplicit()[sid])
                          }}
                          model={() => sessionModel(activeSessionId()!)}
                          modelGroups={modelGroups}
                          primaryAgents={primaryAgents}
                          subagentAgents={subagentAgents}
                          subagentRunning={subagentRunning}
                          thinkingLevel={() => thinkingLevelOf(activeSessionId())}
                          thinkingSupported={() => thinkingSupportedOf(activeSessionId())}
                          onThinkingSelect={(level) => { const sid = activeSessionId(); if (sid) applyThinking(sid, level) }}
                                readOnly={!!store.session.find((s: any) => s.id === activeSessionId()!)?.parentID}
                          parentID={store.session.find((s: any) => s.id === activeSessionId()!)?.parentID ?? null}
                          onBackToParent={() => backToParent(activeSessionId()!)}
                          onOpenSubagent={(id) => void openSubagentSession(id)}
                          onOpenUsage={() => { setShowConfig(true); setConfigSection("usage") }}
                          currentProject={currentProject() ?? undefined}
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
                          onRecordPodNote={recordPodNote}
                          onHandoffToLead={() => void handoffActiveSessionToLead()}
                          handoffEligible={canHandoffActiveSession}
                          techLeadInvite={activeLeadGoalInvite}
                          leadGoals={() => podStore.detail()?.goals ?? []}
                          leadAttention={() => podStore.detail()?.attention ?? []}
                          showTopics={showTopics()}
                          topicItems={topicItems()}
                          topicBoundaries={topicBoundaries()}
                          topicBusy={topicBusy()}
                          onOpenTopics={() => void openTopics()}
                          onResumeTopic={(id) => void resumeTopic(id)}
                          onForkTopic={(id) => void forkTopic(id)}
                          onBoundaryAction={(id, action) => void boundaryAction(id, action)}
                          onCloseTopics={() => setShowTopics(false)}
                          onOpenTechLead={(goalId) => void openTechLead(goalId)}
                          showReturnLead={() => shouldShowReturnLead({
                            detail: podStore.detail(),
                            selectedGoalId: podGoalId(),
                            activeSessionId: activeSessionId(),
                          })}
                          onReturnLead={() => { void openLeadEntry() }}
                          onCloseEpisode={closeEpisodeToDecision}
                          techLeadTarget={activeTechLeadTarget}
                          reviewRefreshKey={() => podStore.reviewRevision()}
                          reviewActive={() => {
                            const goalId = activeTechLeadGoalId()
                            const goal = podStore.detail()?.goals.find((item) => item.goalId === goalId)
                            return !!goal && goal.status === "active"
                          }}
                          reviewAccepted={() => {
                            const goalId = activeTechLeadGoalId()
                            return !!podStore.detail()?.goals.find((item) => item.goalId === goalId)?.accepted
                          }}
                          onOpenReview={() => {
                            const goalId = activeTechLeadGoalId()
                            if (goalId) setPodGoalId(goalId)
                            openChangesFace({ section: "review" })
                          }}
                          sendBlocked={activeTechLeadBlocked}
                          onOpenFile={(root, rel) => openFileInScope(rel, root, focusScopeFromContent(contentScope()))}
                          onOpenDiffReview={openCurrentSessionChangeSet}
                          onExportCurrentSession={() => { const sid = activeSessionId(); if (sid) void exportSession(sid) }}
                          onForkCurrentSession={() => { const sid = activeSessionId(); if (sid) void forkSessionFromMenu(sid) }}
                          worktreeEnabled={worktreeEnabled()}
                          revertUndoEnabled={revertUndoEnabled()}
                          onCreateWorktreeSession={createWorktreeSession}
                          projectDirectory={currentProject()}
                          onCreateSession={createSession}
                          onSetUserMsgId={(sid2, userMsgId2) => setSessions(prev => prev.map(s => s.id === sid2 ? { ...s, userMsgId: userMsgId2 } : s))}
                          compactionMark={compactionMarks()[activeSessionId()!] || null}
                          permissionMode={permissionModes[activeSessionId()!] || "read-only"}
                          onTogglePermissionMode={() => applyPermissionMode(nextPermissionMode(permissionModes[activeSessionId()!] || "read-only"))}
                          onSetPermissionMode={applyPermissionMode}
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
                     onNavigate={(t) => { setActiveTab(t); setShowConfig(false); closeLeftDockIfOverlay() }}
                     onOpenLead={openLeadEntry}
                     onOpenWork={openProjectWork}
                     onOpenGoalComposer={openNewGoalComposer}
                     hasPlanAgent={primaryAgents().some(a => a.planning === true)}
                     onStartWithPlan={() => {
                       const planEntry = primaryAgents().find(a => a.planning === true)
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
                    />
                  </PopoverShell>
                </Show>
              </div>
            ) : activeTab() === "memory" ? (
              <MemoryPage />
            ) : activeTab() === "approvals" ? (
              <ApprovalsPage permissionCards={pendingPermissionCards} onPermissionReply={permReply} />
            ) : activeTab() === "triage" ? (
              <TriagePage onOpenGoals={openProjectWork} />
            ) : activeTab() === "automation" ? (
              <AutomationsPage />
            ) : activeTab() === "mcp" ? (
              <McpPage />
            ) : null}
          </div>
          <Show when={chatSplit() && !focusActive() && !narrowZone()}>
            <div
              class="mafw-chat-resize-wrap"
              onDblClick={() => applyDetent(WORKBENCH_DEFAULT_DETENT)}
              title="拖动调宽（松手吸附 520/640/760）；双击回默认档 760"
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
              <div class="mafw-dock-shell" classList={{ "is-hidden": workbenchShellHidden({ content: workbenchContent(), open: rightDockOpen() }) }}>
                <WorkbenchShell
                  open={dockPresent()}
                  focusView={activeFocus()}
                  frame={focusFrame()}
                  onFocusBack={focusBack}
                  onFocusCrumb={focusCrumb}
                  focusOpenRequest={focusOpenRequest()}
                  pickerOpen={pickerOpen()}
                  pickerItems={pickerItems()}
                  onOpenPicker={openSubjectPicker}
                  onClosePicker={() => setPickerOpen(false)}
                  onPick={pickSubject}
                  sessionID={currentSessionID() || null}
                  sessionDirectory={store.session.find((s: any) => s.id === currentSessionID())?.directory ?? null}
                  contentRoot={contentRoot()}
                  contentScopeKey={currentContentScopeKey()}
                  pluginProjectDir={benchRoot() ?? currentProject()}
                  diffs={contentDiffEntries()}
                  liveDiffs={store.session_diff?.[currentSessionID() ?? ""]}
                  activeTabId={activeDocumentTabId()}
                  onActiveFileChange={setActiveContentDocument}
                  onSendAnnotation={sendAnnotation}
                  onAddAnnotation={addAnnotation}
                  onOpenFile={(rel, line) => {
                    const doc = activeChangeSetDocument()
                    if (doc?.root) {
                      openFileInScope(rel, doc.root, doc.scope, { persist: true, line })
                      return
                    }
                    const root = contentRoot()
                    if (!root) return
                    openFileInScope(rel, root, focusScopeFromContent(contentScope()), { persist: true, line })
                  }}
                  onSendDiffComment={(sid, text) => {
                    void window.api.mafw.sessions.promptAsync({ sessionID: sid, message: text })
                      .then(() => showToastV2({ description: "评论已发送给 agent", duration: 2000 } as any))
                      .catch((e: any) => showToastV2({ description: `发送失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 4000 } as any))
                  }}
                  onAddDiffAnnotation={(a) => {
                    const doc = activeChangeSetDocument()
                    const sid = doc?.source.kind === "session" ? doc.source.sessionID : currentSessionID()
                    if (!sid) return
                    addPending({ sessionID: sid, ...a })
                    showToastV2({ description: "已加入批注", duration: 1600 } as any)
                  }}
                  onOpenReview={() => openChangesFace({ section: "review" })}
                  renderWorld={() => (
                    <WorldOverviewStage
                      projectDir={currentProject()}
                      projectName={railProjectName(currentProject(), true)}
                      refreshTick={() => Math.max(goalsRev(), podStore.revision())}
                      composerRequest={goalComposerRequest()}
                      active={dockPresent() && activeFocus()?.subject.kind === "world"}
                      team={{
                        detail: podStore.detail(),
                        loading: podStore.loading(),
                        error: podStore.error(),
                        unsupported: podStore.unsupported(),
                        isWorktree: benchRoot() !== currentProject(),
                        onRefresh: () => { void podStore.refresh() },
                        onOpenLead: () => { void openLeadEntry() },
                        onOpenTechLead: (goalId) => { void openTechLead(goalId) },
                        onOpenPanel: (tab, target) => openPodPanelTab(tab, target),
                        onCreate: () => { void podStore.create() },
                      }}
                      teamFocusRequest={teamFocusRequest()}
                      podPanelRequest={podPanelRequest()}
                      onOpenPodSession={(sid, title) => { void openPodSession(sid, title) }}
                      onOpenGoal={(goal, focus) => { openGoalFocus(goal.goalId, focus) }}
                      onGoalCreated={(goalId) => { openGoalFocus(goalId, "timeline") }}
                    />
                  )}
                  onDocumentSelect={focusDocumentTab}
                  onDocumentClose={closeDocumentTab}
                  onDocumentCloseMany={closeDocumentTabs}
                  renderGoal={() => {
                    const subject = activeFocus()?.subject
                    const goalId = subject?.kind === "goal" ? subject.goalId : null
                    return (
                      <Show when={goalId} keyed>
                        {(id) => (
                          <GoalDetailPanel
                            goalId={id}
                            projectDir={currentProject()}
                            podId={podIdForCurrentProject()}
                            focus={goalDetailFocus()}
                            planOpenRequest={goalPlanOpenRequest()}
                            onClose={() => { setPodGoalId(null); focusBack() }}
                            onOpenSession={(sid) => { void openPodSession(sid) }}
                            onGoalAccepted={() => { void openLeadEntry() }}
                            onOpenWorktree={(target) => openGoalContent(target)}
                            onOpenChanges={(input) => {
                              const goal = currentGoalRef()
                              const podGoal = goal
                                ? podStore.detail()?.goals.find((item) => item.goalId === goal.goalId)
                                : null
                              if (goal && podGoal) {
                                openGoalChangeSetFromGoal(podGoal, goal.revision, {
                                  rel: input.rel,
                                  line: input.line,
                                })
                              }
                              openChangesFace({ section: input.section, rel: input.rel, line: input.line })
                            }}
                            decisionRecords={() => decisionStore.records().filter((record) => record.goalId === id)}
                            decisionRecordBusy={() => decisionRecordBusy()}
                            onDecisionConfirm={confirmDecisionRecord}
                            onDecisionShelve={shelveDecisionRecord}
                            onDecisionReopen={reopenDecisionRecord}
                          />
                        )}
                      </Show>
                    )
                  }}
                  onSendComment={(sid, text) => {
                    void window.api.mafw.sessions.promptAsync({ sessionID: sid, message: text })
                      .then(() => showToastV2({ description: "评论已发送给 agent", duration: 2000 } as any))
                      .catch((e: any) => showToastV2({ description: `发送失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 4000 } as any))
                  }}
                  webSurfaces={pluginWebSurfaces()}
                  gatewayUrl={gatewayUrl()}
                  onWebBadge={applyWebSurfaceBadge}
                  onWebTitle={applyWebSurfaceTitle}
                  onWebError={applyWebSurfaceError}
                  renderPluginSurface={(id) => (
                    <PluginSurfaceHost
                      id={id}
                      surfaces={pluginSurfaceList()}
                      configSurfaces={pluginConfigSurfaceList()}
                      sessionID={currentSessionID() || null}
                    />
                  )}
                />
              </div>
            )}
          </Show>
        </div>
      </div>
      <Show when={podTranscriptTarget()}>
        {(target) => (
          <PodTranscriptOverlay
            podId={target().podId}
            sessionId={target().sessionId}
            onClose={() => setPodTranscriptTarget(null)}
          />
        )}
      </Show>
      <Show when={activeQuestion()}>
        <QuestionWidget
          question={activeQuestion()!}
          onDismiss={() => setActiveQuestion(null)}
        />
      </Show>
      <Show when={showInspector()}>
        <EventInspector onClose={() => setShowInspector(false)} />
      </Show>
      <ImageLightbox />
      {/* 统一插件包消息小窗：主窗口 DOM 内 overlay，绝不创建 BrowserWindow。 */}
      <PluginWindowHost />
    </div>
            </DataProvider>
          </FileComponentProvider>
        </MarkedProvider>
      </DialogProvider>
  )
}

