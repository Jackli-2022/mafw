import { createSignal, createMemo, createEffect, onMount, onCleanup, Show, For, ErrorBoundary } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { Icon as IconV2 } from "@mafw/ui/v2/icon"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { SessionTurn } from "@mafw/session-ui/session-turn"
import { TaskBar } from "./TaskBar"
import { AskCard, type AskCardData } from "./AskCard"
import { PermissionCard, type PermissionCardData } from "./PermissionCard"
import { ModelPicker, type ModelEntry } from "./pickers/ModelPicker"
import { messageModel } from "../message-model"
import { useConnPhase } from "../connection-state"
import { AgentPicker, type AgentEntry } from "./pickers/AgentPicker"
import { CommandPicker, type CommandItem } from "./pickers/CommandPicker"
import { PopoverShell } from "./pickers/PopoverShell"
import { AudioReply, cachedArtifactUrl } from "./AudioReply"
import { scrollPinDecision } from "./ChatPaneScroll"
import { inlineAnchor } from "./flow-card-placement"
import {
  hasInlineAnchor as hasInlineAnchorSlot,
  inlineCardsForPart as inlineCardsForPartSlot,
  turnOfMessage as turnOfMessageSlot,
  cardsForTurn as cardsForTurnSlot,
  unplacedCards as unplacedCardsSlot,
} from "../chat/flow-card-slots"
import { useAttachments, mimeOf } from "../chat/use-attachments"
import { useSendMessage } from "../chat/use-send-message"
import { TtsPicker } from "../chat/TtsPicker"
import { MessageNav } from "./MessageNav"
import { enqueueTurn, removeTurnAt, takeFirstTurn, type QueuedTurn } from "./turn-queue"
import { countUserTurns, shouldKeepPaging } from "./history-paging"
import { worktreeBadge } from "./worktree-label"
import { type PermissionMode } from "./permission-card-mapping"
import { aggregateSessionDiffs } from "./session-diffs"

/** 🛡 三档按钮文案与提示（切片 1）；图标由 shield 承担，文案不带 emoji。 */
const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  "read-only": "只读",
  auto: "auto",
  "full-access": "全开",
}
const PERMISSION_MODE_HINT: Record<PermissionMode, string> = {
  "read-only": "审批模式：只读 — 只读工具免审，任何变更需确认。点击切到自动",
  auto: "审批模式：自动 — 安全命令免审，高危仍需确认，25 次后回落只读。点击切到全开",
  "full-access": "审批模式：全开 — 不再审批（危险命令也直接执行）。点击切回只读",
}
import { createInputHistory } from "./input-history"
import { mergeRemoteCommands } from "./command-merge"
import { getDraft, setDraft, clearDraft } from "./session-drafts"
import { fuzzyMatchFiles } from "./file-fuzzy"
import { FilePicker, type FilePickerItem } from "./pickers/FilePicker"
import { TranscriptSearchOverlay } from "./TranscriptSearchOverlay"
import { CompressionDivider } from "./CompressionDivider"
import { useVoiceBinding, extractVoiceReplies } from "../chat/use-voice-binding"
import { workspace } from "../workspace/session-workspace"

export type FlowCardRecord =
  | { kind: "ask"; data: AskCardData }
  | { kind: "permission"; data: PermissionCardData }

// TTS 引擎来源徽标文案（/api/tts/voices engines[].source）

// [媒体附件 taskID: <id> contextID: <id> artifactId: <id>（媒体: <name>）...]
const MEDIA_POINTER_RE = /\[媒体附件\s+taskID:\s*([^\s]+)\s+contextID:\s*([^\s]+)(?:\s+artifactId:\s*([a-zA-Z0-9-]+))?（媒体:\s*([^）]+)）[^\]]*\]/g

// Local-only parts (prt_local_ thumbnails) must survive server-side history
// rewrites: history reloads replace parts wholesale, so re-merge the local
// set from the previous store snapshot.
export const mergeLocalParts = (oldParts: any[] | undefined, newParts: any[]): any[] => {
  const locals = (Array.isArray(oldParts) ? oldParts : []).filter(p => p?.id?.startsWith("prt_local_"))
  return locals.length > 0 ? [...newParts, ...locals] : newParts
}

type Attachment = { token?: string; path?: string; name: string; size: number; mime?: string; dataUrl?: string }

type StoreShape = {
  session: any[]
  session_status: Record<string, any>
  message: Record<string, any[]>
  part: Record<string, any[]>
}

export type ChatPaneProps = {
  sessionID: string
  focused: boolean
  canClosePane: boolean
  store: StoreShape
  setStore: (fn: (prev: StoreShape) => StoreShape) => void
  todos: Record<string, any[]>
  switchLogs: () => Record<string, string[]>
  sessionCards: (sid: string) => { visible: FlowCardRecord[]; queueLength: number; keyboardOwnerId: string | null }
  sessionPending: (sid: string) => number
  taskMetrics: (sid: string) => { tokens: number; started: number }
  tasksAllDone: (sid: string) => boolean
  gwReady: boolean
  agentSel: () => AgentEntry | null
  model: () => { providerID: string; modelID: string; label: string } | null
  modelGroups: () => { provider: string; providerID: string; models: ModelEntry[] }[]
  primaryAgents: () => any[]
  subagentAgents: () => any[]
  subagentRunning: (id: string) => boolean
  onNewTopic?: () => void
  readOnly?: boolean
  parentID?: string | null
  onBackToParent?: () => void
  onOpenSubagent?: (id: string) => void
  currentProject?: string
  onNavigateTab?: (tab: string) => void
  onToggleTheme?: () => void
  onOpenSettings?: () => void
  onModelSelect: (m: ModelEntry, sid?: string) => void
  onApplyAgentSwitch: (a: AgentEntry) => void
  onPermReply: (card: PermissionCardData, reply: "once" | "always" | "reject", message?: string, persist?: boolean | "tool" | "prefix") => void
  onAskSubmit: (card: AskCardData, answers: Record<string, string[]>, custom: Record<string, string>) => void
  onAskCancel: (card: AskCardData) => void
  /** 打开改动审阅面板（切片 2；SessionTurn actions + composer 工具条双入口） */
  onOpenDiffReview?: () => void
  /** plan/build 模式三态循环（切片 3；'default' = 清除 picks 回 runtime 默认） */
  onPlanBuildToggle?: (next: "plan" | "build" | "default") => void
  /** worktree 并行隔离（切片 4）：能力门由 MafwShell 传（runtime worktreeApi） */
  worktreeEnabled?: boolean
  onCreateWorktreeSession?: () => void
  /** 当前项目主目录（worktree 徽标判定的对照基准） */
  projectDirectory?: string | null
  onTitlebarRef: (el: HTMLElement | null) => void
  taskListOpen: boolean
  tasksPlacement: "bar" | "dock"
  onTaskToggle: (el: HTMLElement | null, sid?: string | null) => void
  onTaskHoverOpen: (el: HTMLElement | null, sid?: string | null) => void
  onTaskHoverLeave: () => void
  onFocus: () => void
  onClosePane: () => void
  onOpenForkedSession?: (sid: string) => void
  onCreateSession: () => Promise<string | null>
  onSetUserMsgId: (sid: string, userMsgId: string) => void
  onRegisterAnchor: (sid: string, fn: () => void) => void
  onUnregisterAnchor: (sid: string) => void
  onRegisterResetSending: (sid: string, fn: () => void) => void
  onUnregisterResetSending: (sid: string) => void
  onRegisterPhaseUpdater?: (sid: string, fn: (p: 'idle' | 'searching' | 'writing') => void) => void
  onUnregisterPhaseUpdater?: (sid: string) => void
  onRegisterQueueFlush?: (sid: string, fn: () => void) => void
  onUnregisterQueueFlush?: (sid: string) => void
  compactionMark?: { at: number; summary?: string } | null
  permissionMode?: "read-only" | "auto" | "full-access"
  onTogglePermissionMode?: () => void
  onRegisterMediaSpeak?: (sid: string, fn: (text: string, voice?: string) => void) => void
  onUnregisterMediaSpeak?: (sid: string) => void
  pageState: Record<string, { cursor: string | null; hasMore: boolean; loading: boolean }>
  setPageState: (sid: string, patch: any, flag?: boolean) => void
}

// One ChatPane instance per session; the keyed Show resets all per-pane state
// when the pane switches to a different session.
export function ChatPane(props: ChatPaneProps) {
  return (
    <Show keyed when={props.sessionID || "__none__"}>
      {(sid) => <PaneInner {...props} sid={sid === "__none__" ? "" : sid} />}
    </Show>
  )
}

// 历史媒体附件播放器：artifact URL 经 SDK helper 异步解析（media.artifactUrl），
// 渲染端不自己拼 /a2a/artifacts/ 字符串。
function MediaHistoryAttachment(props: { artifactId: string; name: string; mediaType: string }) {
  const [url, setUrl] = createSignal<string | null>(null)
  createEffect(() => {
    void window.api.mafw.media.artifactUrl(props.artifactId).then(setUrl)
  })
  return (
    <Show when={url()}>
      {(u) => (
        <div class="mafw-media-history">
          <Show when={props.mediaType.startsWith("image/")}>
            <img src={u()} alt={props.name} class="mafw-media-image" />
          </Show>
          <Show when={props.mediaType.startsWith("audio/")}>
            <audio controls preload="metadata" src={u()}>
              您的浏览器不支持音频播放。
            </audio>
          </Show>
          <Show when={props.mediaType.startsWith("video/")}>
            <video controls preload="metadata" src={u()} class="mafw-media-video">
              您的浏览器不支持视频播放。
            </video>
          </Show>
        </div>
      )}
    </Show>
  )
}

function PaneInner(props: ChatPaneProps & { sid: string }) {
  const sidProp = () => props.sid
  // workspace 单例直连（store 单一所有权；注册表显式化，不再经 props 穿透）
  const store = workspace.store
  const setStore = workspace.setStore as unknown as (fn: (prev: typeof store) => typeof store) => typeof store
  // accessor 保持响应式（sessions 变化即重算；split view 各 pane 各自查）
  const isManager = () => workspace.sessionRole(sidProp()) === "manager"
  const connPhase = useConnPhase()

  // ── Composer state (per pane) ──
  const [input, setInput] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [phase, setPhase] = createSignal<'idle' | 'searching' | 'writing'>('idle')
  const {
    attachments, setAttachments, dragging, setDragging,
    addAttachments, removeAttachment, addPastedFile,
    handlePaste, handleDragOver, handleDragLeave, handleDrop, uploadMediaBinary, imageToDataUrl,
  } = useAttachments()
  const [mentionedAgents, setMentionedAgents] = createSignal<{ name: string }[]>([])
  const [pickerOpen, setPickerOpen] = createSignal<"model" | "agent-switch" | "agent-mention" | "command" | "tts" | "file" | null>(null)
  // TTS voice picker: 选中音色/引擎归宿主（voice hook 消费 defaultVoice）；
  // 列表加载、风格输入、试听态在 ../chat/TtsPicker.tsx 内部自管。
  const [ttsVoiceSel, setTtsVoiceSel] = createSignal<string | null>(null)
  const [ttsEngine, setTtsEngine] = createSignal<string>("mimo")
  const [pickerTrigger, setPickerTrigger] = createSignal<HTMLElement | null>(null)
  const [switchConfirm, setSwitchConfirm] = createSignal<AgentEntry | null>(null)
  const [revertConfirm, setRevertConfirm] = createSignal<{ messageID: string } | null>(null)
  const [canUnrevert, setCanUnrevert] = createSignal(false)

  // Busy-turn queue: regular messages sent while a turn is running are held
  // here and dispatched on the next idle boundary (steering without abort).
  const [queuedItems, setQueuedItems] = createSignal<QueuedTurn[]>([])

  // Composer input loop: ↑/↓ history, per-session draft, @file mentions.
  const history = createInputHistory(50)
  const [mentionedFiles, setMentionedFiles] = createSignal<{ rel: string }[]>([])
  const [projectFiles, setProjectFiles] = createSignal<string[]>([])
  const [fileHi, setFileHi] = createSignal(0)
  const [searchOpen, setSearchOpen] = createSignal(false)

  const [textareaEl, setTextareaEl] = createSignal<HTMLTextAreaElement | null>(null)

  // Trailing "@query" token before the caret (used by both onInput trigger
  // and the picker's live filter).
  const AT_MENTION_RE = /(?:^|\s)@(\S*)$/
  const atMentionQuery = () => {
    const v = input()
    const ta = textareaEl()
    const sel = ta?.selectionStart ?? v.length
    const m = AT_MENTION_RE.exec(v.slice(0, sel))
    return m ? m[1] : null
  }

  const filePickerItems = createMemo(() => {
    const q = atMentionQuery() ?? ""
    const agents = (props.primaryAgents() || [])
      .filter((a: any) => !q || a.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5)
      .map((a: any) => ({ kind: "agent" as const, label: a.name, value: a.name }))
    const files = fuzzyMatchFiles(projectFiles(), q, 12).map(f => ({ kind: "file" as const, label: f, value: f }))
    return [...agents, ...files]
  })

  const addFileMention = (rel: string) => {
    setMentionedFiles(prev => prev.some(f => f.rel === rel) ? prev : [...prev, { rel }])
    // strip the trailing "@query" token from the input
    const ta = textareaEl()
    const v = input()
    const sel = ta?.selectionStart ?? v.length
    const before = v.slice(0, sel).replace(/@(\S*)$/, " ")
    const after = v.slice(sel)
    const next = before + after
    setInput(next)
    setDraft(sidProp(), next)
    setPickerOpen(p => p === "file" ? null : p)
  }

  // Draft restore: keyed Show destroys the pane on tab switch; the draft
  // survives in the module-level store.
  onMount(() => {
    const d = getDraft(sidProp())
    if (d) {
      setInput(d)
      queueMicrotask(() => { const ta = textareaEl(); if (ta) autoGrow(ta) })
    }
  })

  // 会话 reverted 态探测（session info 的 revert 字段，opencode 专属；pi 无）
  onMount(async () => {
    if (!sidProp()) return
    try {
      const info: any = await window.api.mafw.sessions.get(sidProp())
      setCanUnrevert(!!info?.revert)
    } catch { /* fail-open */ }
  })

  const refreshAfterRevert = () => {
    setStore(prev => ({
      ...prev,
      message: { ...prev.message, [sidProp()]: [] },
      part: { ...prev.part, [sidProp()]: [] },
    }))
    props.setPageState(sidProp(), { cursor: null, hasMore: true, loading: false })
  }

  // ── plan/build 模式循环（切片 3）──────────────────────────────
  // 能力门：primaryAgents 列表内容含 plan/build 才启用（pi 列表恒空 → 自动隐藏）；
  // manager 会话锁不适用。
  const planBuildGate = () =>
    !isManager() && (props.primaryAgents() || []).some((a: any) => a?.name === "plan" || a?.name === "build")
  const planBuildState = (): "plan" | "build" | "default" => {
    const n = props.agentSel()?.name
    return n === "plan" || n === "build" ? n : "default"
  }
  const cyclePlanBuild = () => {
    const cur = planBuildState()
    props.onPlanBuildToggle?.(cur === "plan" ? "build" : cur === "build" ? "default" : "plan")
  }
  const PLAN_BUILD_LABEL: Record<"plan" | "build" | "default", string> = {
    plan: "plan",
    build: "build",
    default: "默认",
  }
  const PLAN_BUILD_ICON: Record<"plan" | "build" | "default", "bullet-list" | "terminal" | "sliders"> = {
    plan: "bullet-list",
    build: "terminal",
    default: "sliders",
  }
  const PLAN_BUILD_HINT: Record<"plan" | "build" | "default", string> = {
    plan: "规划模式：只读 agent 出方案，不改文件。点击/Tab 切到 build",
    build: "执行模式：完整工具集执行改动。点击/Tab 切回默认",
    default: "默认模式：runtime 默认 agent。点击/Tab 切到 plan",
  }

  // ── worktree 并行隔离（切片 4）：当前会话的 directory 与徽标 ──
  const sessionDirectory = (): string | undefined =>
    store.session.find((s: any) => s.id === sidProp())?.directory
  const worktreeBadgeOf = () => worktreeBadge(sessionDirectory(), props.projectDirectory)

  const userActions = () => ({
    fork: async ({ sessionID, messageID }: { sessionID: string; messageID: string }) => {
      try {
        const out: any = await window.api.mafw.sessions.fork(sessionID, messageID)
        showToastV2({ title: "已分叉", description: `新会话 ${out?.session?.id ?? ""} 已创建`, variant: "success" } as any)
        if (out?.session?.id) props.onOpenForkedSession?.(out.session.id)
      } catch (e: any) {
        showToastV2({ title: "分叉失败", description: String(e?.message || e), variant: "error" } as any)
      }
    },
    revert: async ({ messageID }: { sessionID: string; messageID: string }) => {
      setRevertConfirm({ messageID })
    },
    diffReview: () => props.onOpenDiffReview?.(),
  })

  const doRevert = async () => {
    const target = revertConfirm()
    if (!target) return
    setRevertConfirm(null)
    try {
      await window.api.mafw.sessions.revert(sidProp(), target.messageID)
      setCanUnrevert(true)
      refreshAfterRevert()
      showToastV2({ title: "已回滚", description: "该消息之后的历史已撤回", variant: "success" } as any)
    } catch (e: any) {
      showToastV2({ title: "回滚失败", description: String(e?.message || e), variant: "error" } as any)
    }
  }

  const doUnrevert = async () => {
    try {
      await window.api.mafw.sessions.unrevert(sidProp())
      setCanUnrevert(false)
      refreshAfterRevert()
      showToastV2({ title: "已撤销回滚", variant: "success" } as any)
    } catch (e: any) {
      showToastV2({ title: "撤销失败", description: String(e?.message || e), variant: "error" } as any)
    }
  }
  const [subagents, setSubagents] = createSignal<{ id: string; title: string }[]>([])
  const [cmdItems, setCmdItems] = createSignal<CommandItem[]>([])
  const [cmdLoading, setCmdLoading] = createSignal(false)
  const [cmdCustom, setCmdCustom] = createSignal<{ name: string; source: string }[]>([])

  // previewing = TTS picker 试听态（TtsPicker 内部管理高亮；这里的信号仅供
  // voice hook 在播报结束时清除残留高亮）
  const [previewing, setPreviewing] = createSignal<string | null>(null)

  // ── 语音绑定层（VoiceSession 接线/播报/分段上传/自动播放 → ../chat/use-voice-binding.ts）──
  const {
    voiceSession, voiceRecording, ttsSpeaking, speakingPartId,
    assistantActions, stopActivePlayback, speakText,
  } = useVoiceBinding(() => sidProp(), {
    store: store,
    setStore: setStore,
    gwReady: () => props.gwReady,
    ttsVoiceSel: () => ttsVoiceSel(),
    onSetUserMsgId: (s, id) => props.onSetUserMsgId(s, id),
    voiceRepliesForTurn: (userMsgId) => voiceRepliesForTurn(userMsgId),
    userMessages: () => userMessages(),
    onSpeakingIdle: () => setPreviewing(null),
  })

  // mafw_media_speak 流式：工具事件 → VoiceSession（互斥/barge-in/hash 去重收敛在核心）。
  const handleMediaSpeak = (text: string, voice?: string) => {
    void voiceSession.speakFromTool(text, voice)
  }
  workspace.register("mediaSpeak", sidProp(), handleMediaSpeak)
  onCleanup(() => workspace.unregister("mediaSpeak", sidProp()))
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement | null>(null)
  const [jumpVisible, setJumpVisible] = createSignal(false)

  // Local handle to this pane's titlebar so the TaskList popover can anchor to
  // the pane the user actually clicked (not a shared shell ref).
  let titlebarEl: HTMLElement | null = null
  const setTitlebarEl = (el: HTMLElement | null) => {
    titlebarEl = el
    props.onTitlebarRef(el)
  }

  onMount(() => {
    if (sidProp()) workspace.register("anchor", sidProp(), forceAnchor)
    workspace.register("sendingReset", sidProp(), () => { setSending(false); setPhase('idle') })
    workspace.register("phase", sidProp(), setPhase)
  })
  onCleanup(() => {
    props.onTitlebarRef(null)
    if (sidProp()) workspace.unregister("anchor", sidProp())
    workspace.unregister("sendingReset", sidProp())
    workspace.unregister("phase", sidProp())
  })

  const addAgent = (name: string) => {
    if (!name || mentionedAgents().some(a => a.name === name)) return
    if (mentionedAgents().length >= 3) {
      showToastV2({ description: "最多引用 3 个 Agent", duration: 2000 })
      return
    }
    setMentionedAgents(prev => [...prev, { name }])
  }

  const removeAgent = (name: string) => {
    setMentionedAgents(prev => prev.filter(a => a.name !== name))
  }

  const encodeFilePath = (filepath: string): string => {
    let normalized = filepath.replace(/\\/g, "/")
    if (/^[A-Za-z]:/.test(normalized)) normalized = "/" + normalized
    return normalized.split("/").map((seg, i) => {
      // Keep the colon in the Windows drive segment (/C:/...) so downstream
      // file URL parsers can reliably detect drives.
      if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg
      return encodeURIComponent(seg)
    }).join("/")
  }

  // Auto-grow the composer textarea up to 200px (single line at rest).
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  // ── 发送管线（sendMessage 五合一 → ../chat/use-send-message.ts）──
  const { sendMessage, interrupt, flushQueue } = useSendMessage({
    sid: () => sidProp(),
    onCreateSession: () => props.onCreateSession(),
    onSetUserMsgId: (s2, id) => props.onSetUserMsgId(s2, id),
    input, setInput, sending, setSending, setPhase,
    attachments, setAttachments,
    mentionedAgents, setMentionedAgents,
    mentionedFiles, setMentionedFiles,
    queuedItems, setQueuedItems,
    textareaEl,
    history,
    clearDraft,
    matchSlash: (t) => matchCommand(t),
    agentSel: () => props.agentSel(),
    model: () => props.model(),
    setStore: setStore,
    forceAnchor: () => forceAnchor(),
    imageToDataUrl,
    uploadMediaBinary,
    encodeFilePath,
  })

  // ESC / Ctrl+C interrupts this pane only when it is focused and sending.
  onMount(() => {
    workspace.register("queueFlush", sidProp(), flushQueue)
    onCleanup(() => workspace.unregister("queueFlush", sidProp()))
    const onKey = (e: KeyboardEvent) => {
      if (!props.focused || !sending()) return
      const isEsc = e.key === "Escape"
      const isCtrlC = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c"
      if (!isEsc && !isCtrlC) return
      // Keep Ctrl+C as copy inside editable fields
      if (isCtrlC) {
        const el = document.activeElement as HTMLElement | null
        if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return
      }
      e.preventDefault()
      void interrupt()
    }
    // Ctrl+F toggles the in-session transcript search (browser find is
    // replaced; only while this pane is focused and no picker is open).
    const onSearchKey = (e: KeyboardEvent) => {
      if (!props.focused || pickerOpen()) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keydown", onSearchKey)
    onCleanup(() => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keydown", onSearchKey)
    })
  })

  const refreshSubagents = async () => {
    const sid = sidProp()
    if (!sid) { setSubagents([]); return }
    try {
      const items: any[] = await window.api.mafw.sessions.children(sid)
      setSubagents((items || []).map((c: any) => ({ id: c.id, title: c.title || "子代理" })))
    } catch (e) {
      console.warn("[mafw] children fetch:", e)
      setSubagents([])
    }
  }

  // ── Slash command system (/ panel) ──
  // mafw 组从 gateway 命令注册表动态拉取（P0 收敛）；拉取失败回退内置 6 条。
  const MAFW_FALLBACK_COMMANDS: CommandItem[] = [
    { id: "mafw-goal", trigger: "/goal", title: "新建 Goal", description: "提交 Goal 给 Manager", group: "mafw" },
    { id: "mafw-status", trigger: "/status", title: "MAFW 状态", description: "查看当前状态", group: "mafw" },
    { id: "mafw-merge", trigger: "/merge-memory", title: "记忆融合", description: "合并 worktree 记忆", group: "mafw" },
    { id: "mafw-new-topic", trigger: "/new-topic", title: "新话题", description: "开新话题（当前 Manager 会话归档）", group: "mafw" },
    { id: "mafw-btw", trigger: "/btw", title: "支线问答", description: "一次性会话回答支线问题，不污染主线", group: "mafw" },
    { id: "mafw-waitwhat", trigger: "/waitwhat", title: "没听懂，重述", description: "用简明语言+项目术语重述上一条回复", group: "mafw" },
  ]
  const MAFW_FALLBACK_NAMES = new Set(MAFW_FALLBACK_COMMANDS.map(c => c.trigger.slice(1)))
  const [mafwRemote, setMafwRemote] = createSignal<{ items: CommandItem[]; names: Set<string> }>({ items: [], names: new Set() })

  const closeCommandPicker = () => setPickerOpen(p => p === "command" ? null : p)

  const insertCommandText = (trigger: string) => {
    setInput(trigger + " ")
    closeCommandPicker()
    requestAnimationFrame(() => {
      const ta = textareaEl()
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) }
    })
  }

  const buildCommands = (): CommandItem[] => {
    const local: CommandItem[] = [
      { id: "new", trigger: "/new", title: "新建会话", description: "创建新会话", group: "local", source: "builtin", run: () => { closeCommandPicker(); void props.onCreateSession() } },
      { id: "agent", trigger: "/agent", title: "切换 Agent", description: "切换会话 Agent", group: "local", source: "builtin", run: () => { closeCommandPicker(); setPickerTrigger(textareaEl()); setPickerOpen("agent-switch") } },
      { id: "model", trigger: "/model", title: "切换模型", description: "选择模型", group: "local", source: "builtin", run: () => { closeCommandPicker(); setPickerTrigger(textareaEl()); setPickerOpen("model") } },
      { id: "theme", trigger: "/theme", title: "切换主题", description: "明暗主题", group: "local", source: "builtin", run: () => { closeCommandPicker(); props.onToggleTheme?.() } },
      { id: "settings", trigger: "/settings", title: "打开设置", description: "MAFW 配置", group: "local", source: "builtin", run: () => { closeCommandPicker(); props.onOpenSettings?.() } },
      ...(props.parentID ? [{ id: "back", trigger: "/back", title: "返回父会话", description: "回到父会话", group: "local" as const, source: "builtin" as const, run: () => { closeCommandPicker(); props.onBackToParent?.() } }] : []),
      { id: "goals", trigger: "/goals", title: "Goals 页", description: "打开目标页", group: "local", source: "builtin", run: () => { closeCommandPicker(); props.onNavigateTab?.("goals") } },
      { id: "memory", trigger: "/memory", title: "Memory 页", description: "打开记忆页", group: "local", source: "builtin", run: () => { closeCommandPicker(); props.onNavigateTab?.("memory") } },
      { id: "approvals", trigger: "/approvals", title: "Approvals 页", description: "打开审批页", group: "local", source: "builtin", run: () => { closeCommandPicker(); props.onNavigateTab?.("approvals") } },
      { id: "triage", trigger: "/triage", title: "Triage 页", description: "打开分诊页", group: "local", source: "builtin", run: () => { closeCommandPicker(); props.onNavigateTab?.("triage") } },
      { id: "automation", trigger: "/automation", title: "Automation 页", description: "打开自动化页", group: "local", source: "builtin", run: () => { closeCommandPicker(); props.onNavigateTab?.("automation") } },
    ]
    const mafw: CommandItem[] = mafwRemote().items.length > 0
      ? mafwRemote().items
      : MAFW_FALLBACK_COMMANDS
    const custom: CommandItem[] = cmdCustom().map(c => ({
      id: `custom-${c.source}-${c.name}`,
      trigger: `/${c.name}`,
      title: c.name,
      description: c.source === "skill" ? "技能" : c.source === "mcp" ? "MCP 命令" : "命令",
      group: "custom" as const,
      source: (c.source as any) || "command",
    }))
    return [...local, ...mafw, ...custom]
  }

  // Fetch opencode commands+skills once per pane (refreshed when the panel is
  // opened again after an error).
  const loadCustomCommands = async () => {
    if (cmdLoading()) return
    setCmdLoading(true)
    try {
      const dir = props.currentProject || undefined
      const [cmds, skills, remoteMafw] = await Promise.all([
        window.api.mafw.command.list(dir).catch(() => []),
        window.api.mafw.skill.list(dir).catch(() => []),
        window.api.mafw.mafwCommands.list?.().catch(() => []),
      ])
      if (Array.isArray(remoteMafw)) setMafwRemote(mergeRemoteCommands(remoteMafw))
      const seen = new Set<string>()
      const merged: { name: string; source: string }[] = []
      for (const c of Array.isArray(cmds) ? cmds : []) {
        const name = c?.name
        if (!name || seen.has(name)) continue
        seen.add(name)
        merged.push({ name, source: c?.source || "command" })
      }
      for (const s of Array.isArray(skills) ? skills : []) {
        const name = s?.name
        if (!name || seen.has(name)) continue
        seen.add(name)
        merged.push({ name, source: "skill" })
      }
      setCmdCustom(merged)
    } catch (e) { console.warn("[mafw] load commands:", e) }
    setCmdLoading(false)
  }

  // Match a leading "/cmd" against the known command sets; returns the matched
  // name + group, or null when it's a plain message.
  const matchCommand = (text: string): { name: string; group: "mafw" | "custom" } | null => {
    const m = text.match(/^\/(\S+)(?:\s+(.*))?$/)
    if (!m) return null
    const name = m[1].toLowerCase()
    if (mafwRemote().names.has(name) || MAFW_FALLBACK_NAMES.has(name)) return { name, group: "mafw" }
    if (cmdCustom().some(c => c.name === name)) return { name, group: "custom" }
    return null
  }

  const openCommandPicker = () => {
    void loadCustomCommands()
    setCmdItems(buildCommands())
    setPickerTrigger(textareaEl())
    setPickerOpen("command")
  }

  const onCommandSelect = (item: CommandItem) => {
    if (item.run) { item.run(); return }
    insertCommandText(item.trigger)
  }

  // ── TTS 音色选择器（列表/风格/试听 → ../chat/TtsPicker.tsx；宿主持有 voice 信号）──
  const openTtsPicker = () => {
    setPickerTrigger(textareaEl())
    setPickerOpen("tts")
  }

  // One user message = one turn. Sorted by time as insurance against any
  // reordering between SSE appends and the history merge.
  const userMessages = () => {
    const sid = sidProp()
    if (!sid) return []
    const msgs = store.message[sid]
    if (!msgs?.length) return []
    return msgs
      .filter(m => m.role === "user")
      .sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))
  }

  // DeepSeek-style node nav: one node per user turn, preview from text parts.
  const navTurns = createMemo(() =>
    userMessages().map(m => {
      const parts = store.part[m.id] || []
      const text = parts
        .filter(p => p?.type === "text" && typeof p.text === "string")
        .map(p => p.text)
        .join(" ")
        .trim()
      return { id: m.id, text }
    }),
  )

  // 语音回复：扫描本会话所有 assistant 消息的 text parts，提取 [语音回复 art:<id>]
  // 标记，供 AudioReply 渲染（挂在该 turn 的 SessionTurn 之后，跟在回复文本下方）。
  const voiceRepliesForTurn = (userMsgId: string) => {
    const sid = sidProp()
    if (!sid) return []
    const msgs = store.message[sid] || []
    const userMsg = msgs.find(m => m.id === userMsgId)
    if (!userMsg) return []
    // 该 turn 的 assistant 消息 = parentID 指向 userMsg 的
    const assistants = msgs.filter(m => m.role === "assistant" && m.parentID === userMsg.id)
    const texts: string[] = []
    for (const a of assistants) {
      for (const p of store.part[a.id] || []) {
        if (p?.type === "text" && typeof p.text === "string") texts.push(p.text)
      }
    }
    const joined = texts.join("\n")
    return extractVoiceReplies(joined)
  }

  // 媒体附件：扫描用户消息的 text parts，提取 [媒体附件 ... artifactId: <id>（媒体: <name>）]
  // 标记，供历史消息渲染（图片/音频/视频播放器）。
  const mediaRefsForTurn = (userMsgId: string) => {
    const sid = sidProp()
    if (!sid) return []
    const parts = store.part[userMsgId] || []
    const texts: string[] = []
    for (const p of parts) {
      if (p?.type === "text" && typeof p.text === "string") texts.push(p.text)
    }
    const joined = texts.join("\n")
    const out: Array<{ artifactId: string; name: string; mediaType: string }> = []
    for (const m of joined.matchAll(MEDIA_POINTER_RE)) {
      const artifactId = m[3]
      if (!artifactId) continue
      const name = m[4]?.trim() || "media"
      const ext = name.split(".").pop()?.toLowerCase() || ""
      let mediaType = "application/octet-stream"
      if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) mediaType = "image/" + (ext === "jpg" ? "jpeg" : ext === "svg" ? "svg+xml" : ext)
      else if (["mp4", "webm", "mov", "mkv", "ogg"].includes(ext)) mediaType = "video/" + ext
      else if (["mp3", "wav", "m4a", "flac", "aac", "opus"].includes(ext)) mediaType = "audio/" + (ext === "m4a" ? "mp4" : ext)
      out.push({ artifactId, name, mediaType })
    }
    return out
  }

  // Composite key (providerID/modelID) so same-id models under different
  // providers stay distinct. props.model() already encodes the per-session
  // resolution order (user pick → history → default) — check it FIRST, then
  // fall back to raw history.
  const pickerCurrentKey = createMemo(() => {
    const picked = props.model()
    if (picked) return `${picked.providerID}/${picked.modelID}`
    const sid = sidProp()
    const msgs = sid ? (store.message[sid] || []) : []
    const last = [...msgs].reverse().find(m => m.role === "assistant")
    const m = messageModel(last)
    if (m) return `${m.providerID}/${m.modelID}`
    return undefined
  })

  const onModelSelectWrap = (m: ModelEntry) => {
    props.onModelSelect(m, sidProp())
    setPickerOpen(null)
  }

  const busy = () => store.session_status[sidProp()]?.type === "busy"

  const onAgentSelect = (a: AgentEntry) => {
    setPickerOpen(null)
    if (busy()) {
      setSwitchConfirm(a)
      return
    }
    props.onApplyAgentSwitch(a)
  }

  // Scroll container: the outer .mafw-session-turn-container is the single
  // scroller (each SessionTurn's internal content is forced overflow-visible).
  const SNAP_THRESHOLD = 120
  // Pinned = locked to the bottom: content growth follows the viewport.
  // Released by any upward user scroll (handleScroll never re-asserts it —
  // that would fight the user and make scrolling up impossible).
  const [pinned, setPinned] = createSignal(true)
  // scrollTop of the last scroll event / last programmatic pin write; the
  // comparison baseline that tells user intent apart from our own writes.
  let lastScrollTop = 0
  const updateJump = (el: HTMLDivElement) => {
    setJumpVisible(el.scrollHeight - el.scrollTop - el.clientHeight > SNAP_THRESHOLD)
  }
  const forceAnchor = () => {
    const el = containerRef()
    if (el) {
      el.scrollTop = el.scrollHeight
      lastScrollTop = el.scrollTop
    }
    setPinned(true)
    setJumpVisible(false)
  }
  const jumpToLatest = () => {
    const el = containerRef()
    if (el) {
      el.scrollTop = el.scrollHeight
      lastScrollTop = el.scrollTop
    }
    setPinned(true)
    setJumpVisible(false)
  }

  // Smart sticky scroll: follow the bottom only while pinned; a released pin
  // leaves the viewport alone during streaming (jump pill signals new content).
  createEffect(() => {
    const el = containerRef()
    const sid = sidProp()
    if (!el || !sid) return
    const msgs = store.message[sid]
    void (msgs || []).reduce(
      (n, m) => n + (store.part[m.id] || []).reduce(
        (t, p) => t + (p.text?.length || 0),
        store.part[m.id]?.length || 0,
      ),
      0,
    )
    if (pinned()) {
      el.scrollTop = el.scrollHeight
      lastScrollTop = el.scrollTop
      setJumpVisible(false)
    } else {
      updateJump(el)
    }
  })

  // Focus switch anchors the pane to the bottom (show latest).
  createEffect(() => {
    if (props.focused) forceAnchor()
  })

  // A new pending flow card scrolls into view only when pinned to the bottom;
  // otherwise the jump pill signals pending answers.
  createEffect(() => {
    const sid = sidProp()
    const cards = sid ? props.sessionCards(sid).visible : []
    const pending = cards.filter(c => c.data.status === "pending").length
    void pending
    const el = containerRef()
    if (el && pinned()) forceAnchor()
  })

  // Lazy load older messages when scrolled near the top.
  // Assistant-dense sessions may pack <10 user turns into 100 raw messages, so
  // each invocation loops pages until +10 user turns (or cursor exhausted /
  // 4-page cap) instead of one page per click — density-independent paging.
  async function loadOlder(sessionID: string) {
    const page = props.pageState[sessionID]
    if (!page || page.loading || !page.hasMore || !page.cursor) return
    props.setPageState(sessionID, 'loading', true)
    try {
      let cursor: string | null = page.cursor
      let nextCursor: string | null = null
      let pageCount = 0
      const baseCount = countUserTurns(Array.isArray(store.message[sessionID]) ? store.message[sessionID] : [])
      const el = containerRef()
      const prevHeight = el?.scrollHeight || 0
      while (shouldKeepPaging({
        collected: countUserTurns(Array.isArray(store.message[sessionID]) ? store.message[sessionID] : []) - baseCount,
        target: 10, nextCursor: cursor, pageCount, maxPages: 4,
      })) {
        const data = await window.api.mafw.sessions.messages(sessionID, 100, cursor) as any
        const rawItems = Array.isArray(data) ? data : data?.data
        nextCursor = data?.nextCursor ?? null
        pageCount++
        if (rawItems && Array.isArray(rawItems) && rawItems.length > 0) {
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
            const msg = { ...info, id: msgId, sessionID, time: info.time || { created: Date.now() } }
            msgs.push(msg)
            let itemParts = Array.isArray(item.parts) ? item.parts : (Array.isArray(info.parts) ? info.parts : [])
            if (Array.isArray(itemParts) && itemParts.length > 0) {
              parts[msgId] = mergeLocalParts(store.part[msgId], itemParts.map((p: any) => ({ ...p, id: p.id || `p-${Date.now()}-${Math.random()}`, sessionID, messageID: msgId })))
            }
          }
          if (msgs.length > 0) {
            msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))
            setStore(prev => ({
              ...prev,
              message: { ...prev.message, [sessionID]: msgs },
              part: { ...prev.part, ...parts },
            }))
          }
        }
        if (!nextCursor) break
        cursor = nextCursor
      }
      props.setPageState(sessionID, { cursor: nextCursor, hasMore: !!nextCursor, loading: false })
      // Preserve viewport position once for the whole batch: older content is
      // prepended above.
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop += el.scrollHeight - prevHeight
          lastScrollTop = el.scrollTop
        })
      }
    } catch (e) {
      console.warn("[mafw] loadOlder failed", e)
      props.setPageState(sessionID, 'loading', false)
    }
  }

  const handleScroll = () => {
    const el = containerRef()
    const sid = sidProp()
    if (!el || !sid) return
    const prev = lastScrollTop
    lastScrollTop = el.scrollTop
    setPinned(scrollPinDecision({
      prevScrollTop: prev,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      snapThreshold: SNAP_THRESHOLD,
    }))
    updateJump(el)
    if (el.scrollTop < 100) { if (hiddenTurnCount() > 0) { expandRendered() } else { void loadOlder(sid) } }
  }

  const title = () => store.session.find(s => s.id === sidProp())?.title || "Chat"

  // Render window: mount only the newest N turns; scrolling up expands locally
  // first (no network) and falls through to cursor pagination once the
  // loaded pages are exhausted. Bounds long-session DOM cost.
  const [renderLimit, setRenderLimit] = createSignal(10)
  const allTurns = () => userMessages()
  const visibleTurns = () => { const all = allTurns(); return all.slice(Math.max(0, all.length - renderLimit())) }

  // Transcript search source: every visible turn (user + assistant) with
  // its full text (message.text + text parts) flattened for matching.
  const searchableTurns = createMemo(() => visibleTurns().map((m: any) => ({
    id: m.id,
    role: m.role || "user",
    text: [m.text, ...(store.part[m.id] || []).map((p: any) => (typeof p.text === "string" ? p.text : ""))].join(" "),
  })))
  const hiddenTurnCount = () => Math.max(0, allTurns().length - renderLimit())
  const expandRendered = () => {
    const el = containerRef()
    const prevHeight = el?.scrollHeight || 0
    setRenderLimit(l => l + 10)
    if (el) requestAnimationFrame(() => { el.scrollTop += el.scrollHeight - prevHeight; lastScrollTop = el.scrollTop })
  }

  // ── Flow card placement ──
  // 归位纯函数在 ../chat/flow-card-slots.ts（逐字迁移，闭包改显式参数）；
  // 这里只做组件态接线（store/sessionCards/userMessages 注入）。
  const flowSlotPartsOf = (mid: string): any[] => (store.part[mid] as any[]) || []
  const flowSlotCards = () => props.sessionCards(sidProp()).visible as any[]

  const hasInlineAnchor = (c: FlowCardRecord): boolean => hasInlineAnchorSlot(c, flowSlotPartsOf)

  const inlineCardsForPart = (messageID: string, callID: string): FlowCardRecord[] =>
    inlineCardsForPartSlot(flowSlotCards(), messageID, callID, flowSlotPartsOf) as FlowCardRecord[]

  const renderFlowCard = (c: FlowCardRecord) => {
    const sc = props.sessionCards(sidProp())
    return c.kind === "permission" ? (
      <PermissionCard
        data={c.data}
        queueLength={c.data.status === "pending" ? sc.queueLength : 0}
        keyboardOwner={c.data.id === sc.keyboardOwnerId}
                onAllowOnce={() => props.onPermReply(c.data, "once")}
                onAllowAlways={() => props.onPermReply(c.data, "always")}
                onAllowPersist={() => props.onPermReply(c.data, "always", undefined, "prefix")}
                onAllowPersistTool={() => props.onPermReply(c.data, "always", undefined, "tool")}
                onDeny={(note) => props.onPermReply(c.data, "reject", note)}
      />
    ) : (
      <AskCard
        data={c.data}
        keyboardOwner={c.data.id === sc.keyboardOwnerId}
        onSubmit={(answers, custom) => props.onAskSubmit(c.data, answers, custom)}
        onCancel={() => props.onAskCancel(c.data)}
      />
    )
  }

  const turnOfMessage = (messageID: string): string | null =>
    turnOfMessageSlot(messageID, store, sidProp())

  // Cards belonging to the user turn `userMsgId` (direct or via the assistant
  // message's parentID), in creation order.
  const cardsForTurn = (userMsgId: string): FlowCardRecord[] =>
    cardsForTurnSlot(flowSlotCards(), userMsgId, store, sidProp(), flowSlotPartsOf, userMessages()) as FlowCardRecord[]

  // Cards that could not be placed into any turn (no/unknown message link).
  // These are now attached to the last user turn via cardsForTurn, so this
  // returns empty when there are user messages.
  const unplacedCards = (): FlowCardRecord[] =>
    unplacedCardsSlot(flowSlotCards(), store, sidProp(), flowSlotPartsOf, userMessages()) as FlowCardRecord[]

  const agentSelName = () => props.agentSel()?.name || "manager"

  // 会话改动文件数（message.summary.diffs 聚合，含 patch）——composer 审阅按钮的常驻计数徽标
  const diffCount = () => aggregateSessionDiffs((store.message as any)[sidProp()] || []).length

  // Real model name of the last assistant message (fallback: agent → "default")
  const modelName = createMemo(() => {
    const sid = sidProp()
    const msgs = sid ? (store.message[sid] || []) : []
    const assistants = msgs.filter(m => m.role === "assistant")
    const last = assistants[assistants.length - 1]
    return messageModel(last)?.modelID || last?.agent || "default"
  })

  const currentModelLabel = createMemo(() => props.model()?.label || modelName())

  // Context usage: last assistant message's input tokens vs model context window
  const contextUsage = createMemo(() => {
    const sid = sidProp()
    if (!sid) return { used: 0, total: 0, percent: 0 }
    const msgs = store.message[sid] || []
    const assistants = msgs.filter(m => m.role === "assistant")
    const last = assistants[assistants.length - 1]
    let used = 0
    if (last?.tokens) {
      const t = last.tokens
      used = t.total || t.input || (t.output || 0) + (t.cache?.read || 0) || 0
    }
    const m = props.model()
    let total = 0
    if (m) {
      for (const g of props.modelGroups()) {
        if (g.providerID === m.providerID) {
          const entry = g.models.find((em: any) => em.id === m.modelID)
          if (entry?.contextK) total = entry.contextK * 1000
          break
        }
      }
    }
    if (total === 0) return { used, total: 0, percent: 0 }
    return { used, total, percent: Math.round((used / total) * 100) }
  })

  // Cumulative session tokens + cost (from trajectory data in store)
  const sessionTokenSummary = createMemo(() => {
    const sid = sidProp()
    if (!sid) return { input: 0, output: 0, reasoning: 0, cacheRead: 0, total: 0, cost: 0, turns: 0 }
    const msgs = store.message[sid] || []
    let input = 0, output = 0, reasoning = 0, cacheRead = 0, cost = 0, turns = 0
    for (const m of msgs) {
      if (m.role === "assistant" && m.tokens) {
        const t = m.tokens
        input += t.input || 0
        output += t.output || 0
        reasoning += t.reasoning || 0
        cacheRead += t.cache?.read || 0
        cost += m.cost || 0
        turns++
      }
    }
    return { input, output, reasoning, cacheRead, total: input + output + reasoning + cacheRead, cost, turns }
  })

  const fmtCtx = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${Math.round(n / 1000)}k`
    return String(n)
  }

  return (
    <div class="mafw-pane" data-layout="chat" onClick={props.onFocus}>
      <div class="mafw-chat-scroll-wrap">
        <div class="mafw-session-turn-container" ref={setContainerRef} onScroll={handleScroll}>
          <Show when={sidProp()}>
            <div class="mafw-session-titlebar">
              <div class="mafw-session-titlebar-inner" ref={setTitlebarEl}>
                <span class="mafw-agent-avatar">{title().charAt(0)}</span>
                <span class="mafw-session-titlebar-text">{title()}</span>
                <Show when={sessionTokenSummary().turns > 0 ? sessionTokenSummary() : undefined}>
                  {(s) => (
                    <TooltipV2 value={`${fmtCtx(s().total)} tokens · ${s().turns} 回合${s().cost > 0 ? ` · $${s().cost.toFixed(4)}` : ''}`} openDelay={300}>
                      <span class="mafw-session-token-badge">
                        {fmtCtx(s().total)}
                        <Show when={s().cost > 0}>
                          <span class="mafw-session-token-cost"> · ${s().cost.toFixed(2)}</span>
                        </Show>
                      </span>
                    </TooltipV2>
                  )}
                </Show>
                <Show when={(props.todos[sidProp()] || []).length > 0 && !props.tasksAllDone(sidProp())}>
                  <span class="mafw-chat-header-divider" />
                </Show>
                <TaskBar
                  todos={props.todos[sidProp()] || []}
                  tokens={props.taskMetrics(sidProp()).tokens}
                  started={props.taskMetrics(sidProp()).started}
                  open={props.taskListOpen && props.tasksPlacement === "bar"}
                  onToggle={() => props.onTaskToggle(titlebarEl, sidProp())}
                  onHoverOpen={() => props.onTaskHoverOpen(titlebarEl, sidProp())}
                  onHoverLeave={props.onTaskHoverLeave}
                />
                <Show when={(props.todos[sidProp()] || []).length > 0 && !props.tasksAllDone(sidProp())}>
                  <span class="mafw-chat-header-done">
                    {(props.todos[sidProp()] || []).filter(t => t.status === "completed").length}/
                    {(props.todos[sidProp()] || []).length}
                  </span>
                </Show>
                <Show when={store.session_status[sidProp()]?.type === "busy"}>
                  <span class="mafw-session-status">
                    <span class="mafw-session-status-dot" />
                    Running
                  </span>
                </Show>
                <Show when={isManager() && props.onNewTopic}>
                  <TooltipV2 value="开新话题（当前会话归档为历史）" openDelay={300}>
                    <ButtonV2 variant="ghost" size="small" onClick={(e: MouseEvent) => { e.stopPropagation(); props.onNewTopic?.() }}>新话题</ButtonV2>
                  </TooltipV2>
                </Show>
                <Show when={worktreeBadgeOf()}>
                  <TooltipV2 value={`worktree：${sessionDirectory()}`} openDelay={300}>
                    <span class="mafw-rail-wt-badge"><Icon name="branch" size="small" /> {worktreeBadgeOf()}</span>
                  </TooltipV2>
                </Show>
                <Show when={props.worktreeEnabled && props.onCreateWorktreeSession}>
                  <TooltipV2 value="在独立 git worktree 中开并行任务（互不踩踏）" openDelay={300}>
                    <ButtonV2 variant="ghost" size="small" onClick={(e: MouseEvent) => { e.stopPropagation(); props.onCreateWorktreeSession?.() }} aria-label="并行任务"><Icon name="branch" size="small" /> 并行</ButtonV2>
                  </TooltipV2>
                </Show>
                <Show when={props.canClosePane}>
                  <TooltipV2 value="关闭分屏" openDelay={300}>
                    <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={(e: MouseEvent) => { e.stopPropagation(); props.onClosePane() }} aria-label="关闭分屏"><Icon name="close" size="small" /></ButtonV2>
                  </TooltipV2>
                </Show>
                <Show when={props.parentID && props.onBackToParent}>
                  <TooltipV2 value="返回父会话" openDelay={300}>
                    <ButtonV2 variant="outline" size="small" class="mafw-back-parent" onClick={(e: MouseEvent) => { e.stopPropagation(); props.onBackToParent?.() }} aria-label="返回父会话"><Icon name="arrow-left" size="small" /> 返回</ButtonV2>
                  </TooltipV2>
                </Show>
              </div>
            </div>
            <Show when={hiddenTurnCount() > 0 || props.pageState[sidProp()]?.hasMore}>
              <div class="mafw-load-earlier" style="display:flex;justify-content:center;padding:8px 0;">
                <ButtonV2 variant="ghost" size="small" onClick={() => { if (hiddenTurnCount() > 0) { expandRendered() } else { const el2 = containerRef(); const ph = el2?.scrollHeight || 0; void loadOlder(sidProp()).then(() => { setRenderLimit(l => l + 10); if (el2) requestAnimationFrame(() => { el2.scrollTop += el2.scrollHeight - ph; lastScrollTop = el2.scrollTop }) }) } }}>{hiddenTurnCount() > 0 ? `加载更早（还有 ${hiddenTurnCount()} 轮）` : "加载更早的历史"}</ButtonV2>
              </div>
            </Show>
            <Show when={props.compactionMark}>
              <CompressionDivider
                summary={props.compactionMark!.summary || `此分界线之前的上下文已于 ${new Date(props.compactionMark!.at).toLocaleTimeString()} 被压缩进摘要`}
              />
            </Show>
            <For each={visibleTurns()}>
              {(msg) => (
                <div class="mafw-turn-anchor" data-turn-id={msg.id}>
                <ErrorBoundary
                  fallback={(err) => {
                    console.error("[mafw] turn render error:", err)
                    return <div class="mafw-turn-render-error">该回合渲染失败：{(err as Error)?.message || String(err)}</div>
                  }}
                >
                <>
                  {/* Voice message: show status inline within user message position */}
                  <Show when={msg.voiceStatus && msg.voiceStatus !== "done"}>
                    <div class="mafw-voice-turn">
                      <div class="mafw-voice-message" classList={{
                        "uploading": msg.voiceStatus === "uploading",
                        "analyzing": msg.voiceStatus === "analyzing",
                        "failed": msg.voiceStatus === "failed",
                      }}>
                        <div class="mafw-voice-waveform">
                          <svg class="mafw-voice-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                            <line x1="12" y1="19" x2="12" y2="23"/>
                            <line x1="8" y1="23" x2="16" y2="23"/>
                          </svg>
                          <span class="mafw-voice-duration">{msg.voiceDuration?.toFixed(1) || "?"}s</span>
                        </div>
                        <Show when={msg.voiceStatus === "uploading"}>
                          <span class="mafw-voice-status">上传中...</span>
                        </Show>
                        <Show when={msg.voiceStatus === "analyzing"}>
                          <span class="mafw-voice-status">正在分析...</span>
                        </Show>
                        <Show when={msg.voiceStatus === "failed"}>
                          <span class="mafw-voice-status error">上传失败：{msg.error || "未知错误"}</span>
                        </Show>
                      </div>
                    </div>
                  </Show>
                  {/* Media attachments from history: render image/audio/video players */}
                  <Show when={msg.role === "user" && (!msg.voiceStatus || msg.voiceStatus === "done")}>
                    <For each={mediaRefsForTurn(msg.id)}>
                      {(ref) => (
                        <MediaHistoryAttachment artifactId={ref.artifactId} name={ref.name} mediaType={ref.mediaType} />
                      )}
                    </For>
                  </Show>
                  <Show when={!msg.voiceStatus || msg.voiceStatus === "done"}>
                    <SessionTurn
                      sessionID={sidProp()}
                      messageID={msg.id}
                      actions={userActions()}
                      assistantActions={assistantActions()}
                      classes={{ root: "min-w-0 w-full relative", content: "!overflow-visible", container: "w-full" }}
                      renderAfterPart={(part: any, message: any) => {
                        if (part.type !== "tool" || !part.callID) return undefined
                        const cards = inlineCardsForPart(message.id, part.callID)
                        return cards.length ? <For each={cards}>{(c) => renderFlowCard(c)}</For> : undefined
                      }}
                    />
                  </Show>
                  {/* 语音回复：渲染在 SessionTurn 之后（跟在助手回复文本下方，
                      而非用户消息上方）；到达时自动播放由上方 effect 统一负责
                      （带 hash 去重），卡片本身点击播放。 */}
                  <For each={voiceRepliesForTurn(msg.id)}>
                    {(vr) => (
                      <div class="mafw-turn-audio">
                        <AudioReply
                          text={`[语音回复 art:${vr.artifactId}${vr.voice ? ` 音色:${vr.voice}` : ''}]`}
                        />
                      </div>
                    )}
                  </For>
                  <For each={cardsForTurn(msg.id)}>
                    {(c) => renderFlowCard(c)}
                  </For>
                </>
                </ErrorBoundary>
                </div>
              )}
            </For>
            {/* Agent switch traces (local UI only) */}
            <For each={props.switchLogs()[sidProp()] || []}>
              {(t) => <div class="mafw-switch-trace">{t}</div>}
            </For>
            {/* Flow cards without a resolvable turn link stay at the bottom */}
            <Show when={sidProp()}>
              <For each={unplacedCards()}>
                {(c) => renderFlowCard(c)}
              </For>
            </Show>
          </Show>
        </div>
        {/* DeepSeek-style user-turn node navigation - sibling of the scroll container: absolute inside it would scroll with content */}
        <MessageNav container={containerRef} turns={navTurns} />
        <TranscriptSearchOverlay
          open={searchOpen()}
          turns={searchableTurns}
          container={containerRef}
          onClose={() => setSearchOpen(false)}
        />
        {/* Jump-to-latest: sibling of the scroll container so bottom anchors to the visible area, not content end */}
        <Show when={sidProp()}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-jump-latest"
            classList={{ visible: jumpVisible() }}
            onClick={jumpToLatest}
            aria-label="Jump to latest"
          >
            <Icon name="arrow-down-to-line" size="small" />
          </ButtonV2>
        </Show>
      </div>
      {/* Phase indicator bar (Perplexity-style) */}
      <Show when={phase() !== 'idle'}>
        <div class={`mafw-phase-bar mafw-phase-${phase()}`}>
          <span class="mafw-phase-dot" />
          <span class="mafw-phase-text">
            {phase() === 'searching' ? '正在处理…' : '正在生成…'}
          </span>
        </div>
      </Show>
      {/* InputArea — 760px centered wrapper: composer box (§4.7). Hidden for
          read-only (subagent) sessions: subagents are not user-facing chats. */}
      <Show when={!props.readOnly}>
      <div class="mafw-input-area">
        <Show when={sidProp() && props.sessionPending(sidProp()) > 0 && jumpVisible()}>
          <ButtonV2 variant="outline" size="small" class="mafw-pending-pill" onClick={jumpToLatest} aria-label="有待回答卡片">
            <span class="mafw-flow-pulse" />
            有 {props.sessionPending(sidProp())} 个待回答 ↓
          </ButtonV2>
        </Show>
        <Show when={queuedItems().length > 0}>
          <div class="mafw-queue-bar">
            <span class="mafw-queue-count">⏳ {queuedItems().length} 条排队 · 回合结束后自动发送</span>
            <For each={queuedItems()}>
              {(q, i) => (
                <span class="mafw-chip">
                  <span class="mafw-chip-label">{q.text.trim().slice(0, 40) || `(${q.atts.length} 个附件)`}</span>
                  <ButtonV2 variant="ghost" size="small" class="mafw-chip-x" onClick={() => setQueuedItems(removeTurnAt(queuedItems(), i()))} aria-label="移除排队消息"><Icon name="close" size="small" /></ButtonV2>
                </span>
              )}
            </For>
            <ButtonV2 variant="ghost" size="small" onClick={() => setQueuedItems([])}>清空</ButtonV2>
          </div>
        </Show>
        <div
          class="mafw-composer"
          classList={{ "mafw-composer-dragging": dragging() }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Attachment + @agent chips row */}
          <Show when={attachments().length > 0 || mentionedAgents().length > 0}>
            <div class="mafw-composer-chips">
              <For each={attachments()}>
                {(a, i) => (
                  <span class="mafw-chip">
                    <Show when={a.dataUrl} fallback={<Icon name="file" size="small" />}>
                      <img class="mafw-chip-thumb" src={a.dataUrl} alt="" />
                    </Show>
                    <span class="mafw-chip-label">{a.name}</span>
                    <ButtonV2 variant="ghost" size="small" class="mafw-chip-x" onClick={() => removeAttachment(i())} aria-label="移除附件"><Icon name="close" size="small" /></ButtonV2>
                  </span>
                )}
              </For>
              <For each={mentionedAgents()}>
                {(a) => (
                  <span class="mafw-chip">
                    <IconV2 name="sparkles" size="small" />
                    <span class="mafw-chip-label">@{a.name}</span>
                    <ButtonV2 variant="ghost" size="small" class="mafw-chip-x" onClick={() => removeAgent(a.name)} aria-label="移除引用"><Icon name="close" size="small" /></ButtonV2>
                  </span>
                )}
              </For>
              <For each={mentionedFiles()}>
                {(f) => (
                  <span class="mafw-chip">
                    <Icon name="file" size="small" />
                    <span class="mafw-chip-label" title={f.rel}>{f.rel}</span>
                    <ButtonV2 variant="ghost" size="small" class="mafw-chip-x" onClick={() => setMentionedFiles(prev => prev.filter(x => x.rel !== f.rel))} aria-label="移除文件引用"><Icon name="close" size="small" /></ButtonV2>
                  </span>
                )}
              </For>
            </div>
          </Show>
          <TextareaV2
            value={input()}
            onInput={e => {
              const v = e.currentTarget.value
              setInput(v)
              autoGrow(e.currentTarget)
              setDraft(sidProp(), v)
              if (/^\/(\S*)$/.test(v) && pickerOpen() !== "command") openCommandPicker()
              else if (!v.startsWith("/") && pickerOpen() === "command") closeCommandPicker()
              // "@query" at the caret opens the file/agent mention picker.
              if (AT_MENTION_RE.test(v.slice(0, e.currentTarget.selectionStart || v.length))) {
                if (pickerOpen() !== "file") {
                  setPickerTrigger(e.currentTarget)
                  setPickerOpen("file")
                  setFileHi(0)
                  if (projectFiles().length === 0) {
                    void window.api.mafw.files.list().then(setProjectFiles).catch(() => {})
                  }
                }
              } else if (pickerOpen() === "file") setPickerOpen(p => p === "file" ? null : p)
            }}
            onKeyDown={e => {
              if (pickerOpen() === "file" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault()
                const n = filePickerItems().length
                setFileHi(h => e.key === "ArrowDown" ? Math.min(h + 1, n - 1) : Math.max(h - 1, 0))
              }
              else if (pickerOpen() === "file" && e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                const item: FilePickerItem | undefined = filePickerItems()[fileHi()]
                if (!item) return
                if (item.kind === "agent") { addAgent(item.value); setPickerOpen(null) }
                else addFileMention(item.value)
              }
              else if (e.key === "Tab" && !pickerOpen() && planBuildGate()) {
                // plan/build 模式循环（opencode Tab 语义；补全/mention 激活时不抢）
                e.preventDefault()
                cyclePlanBuild()
              }
              else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (pickerOpen() === "command") { closeCommandPicker(); return } sendMessage() }
              else if (e.key === "ArrowUp" && !e.currentTarget.value) {
                const prev = history.up(input())
                if (prev !== null) { e.preventDefault(); setInput(prev); queueMicrotask(() => { const ta = textareaEl(); if (ta) autoGrow(ta) }) }
              }
              else if (e.key === "ArrowDown" && !e.currentTarget.value) {
                const next = history.down()
                if (next !== null) { e.preventDefault(); setInput(next); queueMicrotask(() => { const ta = textareaEl(); if (ta) autoGrow(ta) }) }
              }
              else if (e.key === "Backspace" && !e.currentTarget.value && mentionedFiles().length > 0 && mentionedAgents().length === 0) {
                e.preventDefault()
                setMentionedFiles(prev => prev.slice(0, -1))
              }
              else if (e.key === "Backspace" && !e.currentTarget.value && mentionedAgents().length > 0) {
                e.preventDefault()
                setMentionedAgents(prev => prev.slice(0, -1))
              }
            }}
            onPaste={handlePaste}
            ref={setTextareaEl}
            placeholder={props.gwReady ? "输入消息…（/ 打开命令）" : "重新连接中…"}
            disabled={!props.gwReady}
            class="mafw-input"
          />
          <span class="mafw-keyhint">↑ 历史 · Enter 发送 · Shift+Enter 换行 · @ 引用文件</span>
          <div class="mafw-composer-toolbar">
            <div class="mafw-composer-left">
              <TooltipV2 value="附件" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-composer-icon" onClick={addAttachments} aria-label="附件">
                  <Icon name="paperclip" size="small" />
                </ButtonV2>
              </TooltipV2>
              <TooltipV2 value="命令 (/)" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-composer-icon" aria-label="命令" onClick={() => { if (input() === "") setInput("/"); openCommandPicker() }}>
                  <Icon name="console" size="small" />
                </ButtonV2>
              </TooltipV2>
              <TooltipV2 value="引用 Agent" openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-composer-icon"
                  aria-label="引用 Agent"
                  ref={(el: any) => { if (pickerOpen() === "agent-mention") setPickerTrigger(el) }}
                  onClick={() => { setPickerTrigger(document.activeElement as HTMLElement); setPickerOpen("agent-mention"); refreshSubagents() }}
                ><Icon name="subagent" size="small" /></ButtonV2>
              </TooltipV2>
              <TooltipV2 value={diffCount() > 0 ? `审阅改动（${diffCount()} 个文件，逐 hunk 保留 / 回退）` : "审阅改动（逐 hunk 保留 / 回退）"} openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-composer-icon"
                  aria-label="审阅改动"
                  style={{ position: "relative" }}
                  onClick={() => props.onOpenDiffReview?.()}
                ><Icon name="review" size="small" />
                  <Show when={diffCount() > 0}><span class="mafw-composer-badge">{diffCount()}</span></Show>
                </ButtonV2>
              </TooltipV2>
              <TooltipV2 value="语音（音色选择 / 播报）" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-composer-icon" aria-label="语音" onClick={() => { if (pickerOpen() === "tts") { setPickerOpen(null); return } void openTtsPicker() }}>
                  <Icon name="volume" size="small" />
                </ButtonV2>
              </TooltipV2>
              <TooltipV2 value={voiceRecording() ? "停止录音" : "语音输入（录音，静音自动分段）"} openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-composer-icon"
                  classList={{ "mafw-voice-recording": voiceRecording() }}
                  aria-label="语音输入"
                  onClick={() => {
                    if (voiceRecording()) { voiceSession.stopRecording(); return }
                    // 手动打断：录音开始前停掉正在播放的语音（AEC 兜底，双击安全）
                    stopActivePlayback()
                    void voiceSession.startRecording()
                  }}
                ><Icon name={voiceRecording() ? "stop" : "microphone"} size="small" /></ButtonV2>
              </TooltipV2>
              <span class="mafw-composer-divider" />
              <TooltipV2 value={PERMISSION_MODE_HINT[props.permissionMode ?? "read-only"]} openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-mode-pill"
                  classList={{ "mafw-perm-mode-auto": (props.permissionMode ?? "read-only") !== "read-only" }}
                  aria-label="审批模式（三档循环：只读 / 自动 / 全开）"
                  onClick={() => props.onTogglePermissionMode?.()}
                >
                  <Icon name="shield" size="small" />
                  <span>{PERMISSION_MODE_LABEL[props.permissionMode ?? "read-only"]}</span>
                </ButtonV2>
              </TooltipV2>
              <Show when={planBuildGate()}>
                <TooltipV2 value={PLAN_BUILD_HINT[planBuildState()]} openDelay={300}>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-mode-pill"
                    classList={{ "mafw-perm-mode-auto": planBuildState() !== "default" }}
                    aria-label="plan/build 模式循环（Tab）"
                    onClick={() => cyclePlanBuild()}
                  >
                    <Icon name={PLAN_BUILD_ICON[planBuildState()]} size="small" />
                    <span>{PLAN_BUILD_LABEL[planBuildState()]}</span>
                  </ButtonV2>
                </TooltipV2>
              </Show>
            </div>
            <div class="mafw-composer-right">
              <Show when={(props.primaryAgents() || []).length > 0 || isManager()}>
                <TooltipV2 value="切换 Agent" openDelay={300}>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-model-pill"
                    aria-label="切换 Agent"
                    ref={(el: any) => { if (pickerOpen() === "agent-switch") setPickerTrigger(el) }}
                    onClick={(e: any) => { setPickerTrigger(e.currentTarget); setPickerOpen("agent-switch"); refreshSubagents() }}
                  >
                    {agentSelName()}<span class="mafw-model-chevron">▾</span>
                  </ButtonV2>
                </TooltipV2>
              </Show>
              <TooltipV2 value="模型" openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-model-pill"
                  aria-label="模型"
                  ref={(el: any) => { if (pickerOpen() === "model") setPickerTrigger(el) }}
                  onClick={(e: any) => { setPickerTrigger(e.currentTarget); setPickerOpen("model") }}
                >
                  {currentModelLabel()}<span class="mafw-model-chevron">▾</span>
                </ButtonV2>
              </TooltipV2>
              <Show when={contextUsage()}>
                {(ctx) => {
                  const summary = sessionTokenSummary()
                  const tooltipParts: string[] = []
                  if (ctx().total > 0) {
                    tooltipParts.push(`上下文: ${fmtCtx(ctx().used)} / ${fmtCtx(ctx().total)} (${ctx().percent}%)`)
                  } else if (ctx().used > 0) {
                    tooltipParts.push(`上下文: ${fmtCtx(ctx().used)}`)
                  }
                  if (summary.turns > 0) {
                    tooltipParts.push(`会话累计: ${fmtCtx(summary.total)} tokens`)
                    tooltipParts.push(`输入 ${fmtCtx(summary.input)} · 输出 ${fmtCtx(summary.output)}`)
                    if (summary.reasoning > 0) tooltipParts.push(`推理 ${fmtCtx(summary.reasoning)}`)
                    if (summary.cacheRead > 0) tooltipParts.push(`缓存命中 ${fmtCtx(summary.cacheRead)}`)
                    if (summary.cost > 0) tooltipParts.push(`费用: $${summary.cost.toFixed(4)}`)
                    tooltipParts.push(`回合: ${summary.turns}`)
                  }
                  return (
                    <TooltipV2 value={tooltipParts.join(" · ")} openDelay={300}>
                      <span class="mafw-context-pill" classList={{
                        "mafw-context-warn": ctx().percent >= 70,
                        "mafw-context-danger": ctx().percent >= 90,
                      }}>
                        <span class="mafw-context-main">
                          {ctx().total > 0 ? `${ctx().percent}%` : fmtCtx(ctx().used)}
                        </span>
                        <Show when={summary.cost > 0}>
                          <span class="mafw-context-cost">${summary.cost.toFixed(2)}</span>
                        </Show>
                      </span>
                    </TooltipV2>
                  )
                }}
              </Show>
              <Show when={sending()} fallback={
                <ButtonV2
                  variant="contrast"
                  size="small"
                  onClick={sendMessage}
                  disabled={connPhase() === "down" || (!input().trim() && attachments().length === 0)}
                  class="mafw-send"
                  classList={{ "mafw-send-disabled": !input().trim() && attachments().length === 0 }}
                  aria-label={connPhase() === "down" ? "Gateway 已断开" : "发送"}
                >
                  <Icon name="arrow-up" size="small" />
                </ButtonV2>
              }>
                <ButtonV2
                  variant="contrast"
                  size="small"
                  onClick={interrupt}
                  aria-label="停止"
                  class="mafw-send"
                >
                  <span class="mafw-stop-icon" />
                </ButtonV2>
              </Show>
            </div>
          </div>
        </div>
        {/* Pickers */}
        <ModelPicker
          open={pickerOpen() === "model"}
          trigger={pickerTrigger()}
          groups={props.modelGroups()}
          currentKey={pickerCurrentKey()}
          onSelect={onModelSelectWrap}
          onClose={() => setPickerOpen(null)}
        />
        <AgentPicker
          open={pickerOpen() === "agent-switch" || pickerOpen() === "agent-mention"}
          trigger={pickerTrigger()}
          mode={pickerOpen() === "agent-switch" ? "switch" : "mention"}
          anchor={pickerOpen() === "agent-switch" ? "tr" : "bl"}
          primaryAgents={props.primaryAgents()}
          subagentAgents={props.subagentAgents()}
          subagents={subagents()}
          isRunning={props.subagentRunning}
          lockedManager={isManager()}
          currentName={agentSelName()}
          onSelect={(a) => {
            if (pickerOpen() === "agent-mention") {
              addAgent(a.name)
              setPickerOpen(null)
            } else {
              onAgentSelect(a)
            }
          }}
          onSubagentClick={(s) => props.onOpenSubagent ? props.onOpenSubagent(s.id) : showToastV2({ description: `${s.title}（子代理）`, duration: 2000 })}
          onClose={() => setPickerOpen(null)}
        />
        <CommandPicker
          open={pickerOpen() === "command"}
          trigger={pickerTrigger()}
          items={cmdItems()}
          onSelect={onCommandSelect}
          onClose={() => setPickerOpen(p => p === "command" ? null : p)}
        />
        <FilePicker
          open={pickerOpen() === "file"}
          trigger={pickerTrigger()}
          items={filePickerItems()}
          hi={fileHi()}
          onSelect={(item) => {
            if (item.kind === "agent") { addAgent(item.value); setPickerOpen(null) }
            else addFileMention(item.value)
          }}
          onClose={() => setPickerOpen(p => p === "file" ? null : p)}
        />
        <TtsPicker
          open={pickerOpen() === "tts"}
          trigger={pickerTrigger()}
          onClose={() => setPickerOpen(p => p === "tts" ? null : p)}
          ttsVoiceSel={ttsVoiceSel()}
          onVoiceSelect={(id) => setTtsVoiceSel(id)}
          onVoiceReset={() => setTtsVoiceSel(null)}
          onDefaultVoice={(id) => setTtsVoiceSel(v => v || id)}
          ttsEngine={ttsEngine()}
          onEngineChange={(name) => setTtsEngine(name)}
          ttsSpeaking={ttsSpeaking()}
          speakText={() => void speakText()}
          stopActivePlayback={stopActivePlayback}
          previewSpeak={(text, voice) => voiceSession.speak(text, voice)}
        />
        {/* Revert confirm */}
        <Show when={revertConfirm()}>
          <div class="mafw-confirm-backdrop">
            <div class="mafw-confirm">
              <div class="mafw-confirm-title">回滚到这条消息之前？</div>
              <div class="mafw-confirm-text">该消息之后的历史将撤回，且文件改动回滚到该时点（opencode runtime 语义）。此操作可通过"撤销回滚"恢复对话内容。</div>
              <div class="mafw-confirm-actions">
                <ButtonV2 variant="ghost" size="small" onClick={() => setRevertConfirm(null)}>取消</ButtonV2>
                <ButtonV2 variant="contrast" size="small" class="mafw-confirm-ok" onClick={doRevert}>确认回滚</ButtonV2>
              </div>
            </div>
          </div>
        </Show>
        {/* Unrevert entry (session in reverted state) */}
        <Show when={canUnrevert() && !revertConfirm()}>
          <div class="mafw-confirm-backdrop" style={{ "pointer-events": "none", background: "transparent", position: "relative" }}>
            <div class="mafw-confirm" style={{ position: "relative", "max-width": "420px", margin: "0 auto" }}>
              <div class="mafw-confirm-text">会话处于回滚状态。</div>
              <div class="mafw-confirm-actions">
                <ButtonV2 variant="outline" size="small" onClick={doUnrevert}>撤销回滚（unrevert）</ButtonV2>
              </div>
            </div>
          </div>
        </Show>
        {/* Switch-agent confirm (running) */}
        <Show when={switchConfirm()}>
          <div class="mafw-confirm-backdrop">
            <div class="mafw-confirm">
              <div class="mafw-confirm-title">切换将中断当前任务</div>
              <div class="mafw-confirm-text">切换到 {switchConfirm()!.name} 会中断当前正在运行的会话，确定继续？</div>
              <div class="mafw-confirm-actions">
                <ButtonV2 variant="ghost" size="small" onClick={() => setSwitchConfirm(null)}>取消</ButtonV2>
                <ButtonV2 variant="contrast" size="small" class="mafw-confirm-ok" onClick={() => {
                  const a = switchConfirm()!
                  setSwitchConfirm(null)
                  if (sidProp()) window.api.mafw.sessions.abort(sidProp()).catch(() => {})
                  setSending(false)
                  props.onApplyAgentSwitch(a)
                }}>确认切换</ButtonV2>
              </div>
            </div>
          </div>
        </Show>
      </div>
      </Show>
    </div>
  )
}
