// @ts-nocheck
import { createSignal, createMemo, createEffect, onMount, onCleanup, Show, For } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import { TaskBar } from "./TaskBar"
import { AskCard, type AskCardData } from "./AskCard"
import { PermissionCard, type PermissionCardData } from "./PermissionCard"
import { ModelPicker, type ModelEntry } from "./pickers/ModelPicker"
import { AgentPicker, type AgentEntry } from "./pickers/AgentPicker"
import { CommandPicker, type CommandItem } from "./pickers/CommandPicker"
import { PopoverShell } from "./pickers/PopoverShell"
import { AudioReply } from "./AudioReply"
import { VoiceRecorder } from "./VoiceRecorder"

export type FlowCardRecord =
  | { kind: "ask"; data: AskCardData }
  | { kind: "permission"; data: PermissionCardData }

// 已自动播放过的语音回复 artifact（防历史重载/重渲染重复播放）
const playedVoiceArtifacts = new Set<string>()
// 已流式播放的文本指纹（mafw_media_speak 工具事件 → 流式；标记出现时据此跳过 artifact）
const streamedSpeakHashes = new Set<string>()

// djb2 hash（与 gateway 插件 src/tools/media-speak.ts 同实现）
const hashText = (s: string): string => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, "0")
}

// [语音回复 art:<id> 音色:<voice> h:<hash>]
const VOICE_REPLY_RE = /\[语音回复\s+art:([a-zA-Z0-9-]+)(?:\s+音色:([^\]]+?))?(?:\s+h:([a-f0-9]{8}))?\]/g

// Local-only parts (prt_local_ thumbnails) must survive server-side history
// rewrites: history reloads replace parts wholesale, so re-merge the local
// set from the previous store snapshot.
export const mergeLocalParts = (oldParts: any[] | undefined, newParts: any[]): any[] => {
  const locals = (oldParts || []).filter(p => p?.id?.startsWith("prt_local_"))
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
  gatewayUrl?: string
  agentSel: () => AgentEntry | null
  model: () => { providerID: string; modelID: string; label: string } | null
  modelGroups: () => { provider: string; providerID: string; models: ModelEntry[] }[]
  primaryAgents: () => any[]
  subagentAgents: () => any[]
  subagentRunning: (id: string) => boolean
  isManager: boolean
  readOnly?: boolean
  parentID?: string | null
  onBackToParent?: () => void
  onOpenSubagent?: (id: string) => void
  currentProject?: string
  onNavigateTab?: (tab: string) => void
  onToggleTheme?: () => void
  onOpenSettings?: () => void
  onModelSelect: (m: ModelEntry) => void
  onApplyAgentSwitch: (a: AgentEntry) => void
  onPermReply: (card: PermissionCardData, reply: "once" | "always" | "reject", message?: string) => void
  onAskSubmit: (card: AskCardData, answers: Record<string, string[]>, custom: Record<string, string>) => void
  onAskCancel: (card: AskCardData) => void
  onTitlebarRef: (el: HTMLElement | null) => void
  taskListOpen: boolean
  tasksPlacement: "bar" | "dock"
  onTaskToggle: (el: HTMLElement | null) => void
  onOpenRightDock: (tab: "tasks" | "trajectory") => void
  onFocus: () => void
  onClosePane: () => void
  onCreateSession: () => Promise<string | null>
  onSetUserMsgId: (sid: string, userMsgId: string) => void
  onRegisterAnchor: (sid: string, fn: () => void) => void
  onUnregisterAnchor: (sid: string) => void
  onRegisterResetSending: (sid: string, fn: () => void) => void
  onUnregisterResetSending: (sid: string) => void
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

function PaneInner(props: ChatPaneProps & { sid: string }) {
  const sidProp = () => props.sid

  // ── Composer state (per pane) ──
  const [input, setInput] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [mentionedAgents, setMentionedAgents] = createSignal<{ name: string }[]>([])
  const [dragging, setDragging] = createSignal(false)
  const [pickerOpen, setPickerOpen] = createSignal<"model" | "agent-switch" | "agent-mention" | "command" | "tts" | null>(null)
  // TTS voice picker: preset voices + default style, persisted to gateway
  // config (media.tts) so /api/tts without an explicit voice uses it.
  const [ttsVoices, setTtsVoices] = createSignal<{ id: string; label: string; lang: string }[]>([])
  const [ttsVoiceSel, setTtsVoiceSel] = createSignal<string | null>(null)
  const [ttsStyle, setTtsStyle] = createSignal("")
  const [pickerTrigger, setPickerTrigger] = createSignal<HTMLElement | null>(null)
  const [switchConfirm, setSwitchConfirm] = createSignal<AgentEntry | null>(null)
  const [subagents, setSubagents] = createSignal<{ id: string; title: string }[]>([])
  const [cmdItems, setCmdItems] = createSignal<CommandItem[]>([])
  const [cmdLoading, setCmdLoading] = createSignal(false)
  const [cmdCustom, setCmdCustom] = createSignal<{ name: string; source: string }[]>([])
  const [textareaEl, setTextareaEl] = createSignal<HTMLTextAreaElement | null>(null)

  // ── TTS state（统一音色入口：picker 选择 + 试听 + 选中即保存）──
  const VOICE_GRADIENTS = [
    "linear-gradient(135deg,#f6d365,#fda085)",
    "linear-gradient(135deg,#a8edea,#fed6e3)",
    "linear-gradient(135deg,#d299c2,#fef9d7)",
    "linear-gradient(135deg,#89f7fe,#66a6ff)",
    "linear-gradient(135deg,#ff9a9e,#fecfef)",
    "linear-gradient(135deg,#a1c4fd,#c2e9fb)",
    "linear-gradient(135deg,#fbc2eb,#a6c1ee)",
    "linear-gradient(135deg,#84fab0,#8fd3f4)",
  ]
  const [previewing, setPreviewing] = createSignal<string | null>(null)
  const [ttsSpeaking, setTtsSpeaking] = createSignal(false)

  // ── 播放互斥（同一时刻一路语音）+ barge-in 打断 ──
  let activeCtxRef: AudioContext | null = null
  let activeAudioRef: HTMLAudioElement | null = null
  let activeAbortRef: AbortController | null = null
  let activePlayCount = 0

  // 停止当前所有播放（新播放开始前互斥；barge-in 检测到人声时打断）
  const stopActivePlayback = () => {
    const c = activeCtxRef
    if (c) { activeCtxRef = null; void c.close().catch(() => {}) }
    const a = activeAudioRef
    if (a) { activeAudioRef = null; try { a.pause(); a.src = "" } catch { /* ignore */ } }
    const ab = activeAbortRef
    if (ab) { activeAbortRef = null; ab.abort() }
  }

  // 取本会话最后一条 assistant 消息的纯文本（供语音播报）。
  // 排除 synthetic parts（工具结果/指针）与 [语音回复] 标记自身。
  const lastAssistantText = (): string => {
    const sid = sidProp()
    if (!sid) return ""
    const msgs = props.store.message[sid] || []
    const assistants = msgs.filter(m => m.role === "assistant")
    if (assistants.length === 0) return ""
    const last = assistants[assistants.length - 1]
    const texts: string[] = []
    for (const p of props.store.part[last.id] || []) {
      if (p?.type === "text" && typeof p.text === "string" && !p.synthetic) {
        const clean = p.text.replace(/\[语音回复\s+art:[^\]]+\]/g, "").trim()
        if (clean) texts.push(clean)
      }
    }
    return texts.join("\n").trim()
  }

  const speakText = async () => {
    const t = lastAssistantText()
    console.log("[voice] speakText, text length:", t.length, "| voice:", ttsVoiceSel() ?? "茉莉")
    if (!t || !props.gwReady) {
      if (!t) showToastV2({ description: "没有可播报的回复文本", duration: 3000 })
      return
    }
    // 手势内创建 AudioContext（Chromium autoplay 策略：await 后创建会 suspended 且 resume 被拒 → 无声）
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioCtx({ sampleRate: 24000 })
    console.log("[voice] ctx created, state:", ctx.state, "| sampleRate:", ctx.sampleRate)
    if (ctx.state === "suspended") {
      try {
        await ctx.resume()
        console.log("[voice] ctx resumed, state:", ctx.state)
      } catch (e: any) {
        console.error("[voice] ctx resume FAILED:", e?.message || String(e))
        showToastV2({ description: `音频启动失败: ${e?.message || String(e)}`, duration: 4000 })
        await ctx.close().catch(() => {})
        return
      }
    }
    // 显式路由到系统默认输出设备（某些 Windows 机器上 AudioContext 默认 sink 未初始化 → 无声）
    try {
      const sid = (ctx as any).setSinkId
      if (typeof sid === "function") {
        void sid.call(ctx, "default").then(
          () => console.log("[voice] setSinkId('default') ok"),
          (e: any) => console.log("[voice] setSinkId failed:", e?.message || String(e)),
        )
      }
    } catch { /* ignore */ }
    // 播放互斥（停掉正在播的其他语音）+ barge-in 监听（用户说话 → 立即打断）
    stopActivePlayback()
    activeCtxRef = ctx
    const abort = new AbortController()
    activeAbortRef = abort
    activePlayCount++
    if (activePlayCount === 1) void recorder.startMonitoring(stopActivePlayback)
    setTtsSpeaking(true)
    // 超时保护：防 ttsSpeaking 卡 true 导致按钮永久禁用
    const guard = setTimeout(() => setTtsSpeaking(false), 90_000)
    try {
      // 流式 TTS：PCM16 块 → AudioContext 拼接播放（首块快、实时）
      await playStreamingTts(t, ttsVoiceSel() ?? "茉莉", ctx, abort.signal)
    } catch (e: any) {
      // 打断/失败（barge-in 或 ctx 被关）不兜底重播
      if (e?.name === "AbortError" || ctx.state === "closed") {
        console.log("[voice] speakText aborted by barge-in")
        return
      }
      // 兜底：非流式（wav）路径
      try {
        const res = await window.api.mafw.tts.speak({ text: t, voice: ttsVoiceSel() ?? "茉莉" })
        const audio = new Audio(res.url)
        audio.onerror = () => showToastV2({ description: "语音播放失败（音频加载错误）", duration: 3000 })
        const p = audio.play()
        if (p) p.catch((err: any) => showToastV2({ description: `语音播放失败: ${err?.message || String(err)}`, duration: 3000 }))
      } catch (e2: any) {
        showToastV2({ description: `语音合成失败: ${e2?.message || String(e2)}`, duration: 3000 })
      }
    } finally {
      clearTimeout(guard)
      setTtsSpeaking(false)
      if (activeAbortRef === abort) activeAbortRef = null
      activePlayCount--
      if (activePlayCount <= 0) { activePlayCount = 0; recorder.stopMonitoring(stopActivePlayback) }
      activeCtxRef = null
      await ctx.close().catch(() => {})
    }
  }

  // 流式 PCM16 播放：逐块解码 → AudioBufferSource 排队（ctx 由调用方手势内创建）
  const playStreamingTts = async (text: string, voice: string, ctx: AudioContext, signal?: AbortSignal) => {
    // 直接 fetch gateway SSE（渲染进程原生 fetch；IPC 无法克隆 AsyncGenerator）
    const base = (props.gatewayUrl || "http://127.0.0.1:3000").replace(/\/+$/, "")
    const res = await fetch(`${base}/api/tts/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`TTS stream HTTP ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    // 残余字节（chunk 边界可能切半个 sample）
    let remainder = new Uint8Array(0)
    let nextNode: AudioBufferSourceNode | null = null
    let buf = ""
    let chunks = 0
    let maxAmp = 0
    const t0 = ctx.currentTime
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal?.aborted || ctx.state === "closed") throw new DOMException("aborted", "AbortError")
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith("data:")) continue
          let j: any
          try { j = JSON.parse(t.slice(5).trim()) } catch { continue }
          if (!j.data) continue
          const bin = atob(j.data)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const combined = new Uint8Array(remainder.length + bytes.length)
          combined.set(remainder)
          combined.set(bytes, remainder.length)
          const aligned = combined.length - (combined.length % 2)
          remainder = combined.subarray(aligned)
          if (aligned === 0) continue
          const frames = aligned / 2
          const audioBuf = ctx.createBuffer(1, frames, 24000)
          const data = audioBuf.getChannelData(0)
          const dv = new DataView(combined.buffer, combined.byteOffset, aligned)
          for (let i = 0; i < frames; i++) {
            const s = dv.getInt16(i * 2, true)
            const a = Math.abs(s)
            if (a > maxAmp) maxAmp = a
            data[i] = s / 32768
          }
          const src = ctx.createBufferSource()
          src.buffer = audioBuf
          src.connect(ctx.destination)
          if (nextNode) {
            nextNode.onended = () => src.start()
          } else {
            console.log("[voice] first PCM chunk → start playback")
            src.start()
          }
          nextNode = src
          chunks++
        }
      }
      console.log("[voice] stream complete, chunks:", chunks, "| maxAmp:", maxAmp, "| ctx.state:", ctx.state, "| ctx.currentTime advanced:", (ctx.currentTime - t0).toFixed(2), "s")
      // 等最后一个节点播完（带超时兜底，防 onended 不触发卡住）
      if (nextNode) {
        await Promise.race([
          new Promise<void>(r => { nextNode!.onended = () => r() }),
          new Promise<void>(r => setTimeout(r, 60_000)),
        ])
      }
    } finally {
      reader.releaseLock()
      console.log("[voice] playback done (final ctx.currentTime:", ctx.currentTime.toFixed(2), "s)")
    }
  }

  // ── 语音输入（录音 + VAD 分段）：每段 wav 作为附件，随发送走 createTask 指针路径 ──
  const [voiceRecording, setVoiceRecording] = createSignal(false)
  const recorder = VoiceRecorder({
    onSegment: (dataUrl: string) => {
      const mime = dataUrl.split(",")[0].replace("data:", "").replace(";base64", "")
      setAttachments(prev => [...prev, {
        name: `voice-${Date.now()}.wav`,
        size: dataUrl.length,
        mime,
        dataUrl,
      }])
    },
    onStateChange: setVoiceRecording,
  })

  // ── 播放协调：互斥 + barge-in 引用计数（recorder 就绪后才可用）──
  const beginPlayback = () => {
    stopActivePlayback()
    activePlayCount++
    if (activePlayCount === 1) void recorder.startMonitoring(stopActivePlayback)
  }
  const endPlayback = () => {
    activePlayCount--
    if (activePlayCount <= 0) { activePlayCount = 0; recorder.stopMonitoring(stopActivePlayback) }
  }

  // mafw_media_speak 流式：工具事件（tool 名 + text/voice）→ 立即 /api/tts/stream 播放，
  // 与回复文本生成并行。记录 hash 供 artifact effect 去重。
  const handleMediaSpeak = async (text: string, voice?: string) => {
    const clean = (text || "").trim()
    if (!clean) return
    streamedSpeakHashes.add(hashText(clean))
    console.log("[voice] media-speak streaming:", clean.length, "chars | voice:", voice || "default")
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioCtx({ sampleRate: 24000 })
    if (ctx.state === "suspended") {
      try { await ctx.resume() } catch { void ctx.close().catch(() => {}); return }
    }
    try {
      const sid = (ctx as any).setSinkId
      if (typeof sid === "function") {
        void sid.call(ctx, "default").catch(() => {})
      }
    } catch { /* ignore */ }
    beginPlayback()
    activeCtxRef = ctx
    const abort = new AbortController()
    activeAbortRef = abort
    try {
      await playStreamingTts(clean, voice || ttsVoiceSel() || "茉莉", ctx, abort.signal)
    } catch (e: any) {
      console.log("[voice] media-speak stream failed:", e?.message || String(e))
    } finally {
      if (activeAbortRef === abort) activeAbortRef = null
      endPlayback()
      activeCtxRef = null
      void ctx.close().catch(() => {})
    }
  }
  props.onRegisterMediaSpeak?.(sidProp(), handleMediaSpeak)
  onCleanup(() => props.onUnregisterMediaSpeak?.(sidProp()))
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
    if (sidProp()) props.onRegisterAnchor(sidProp(), forceAnchor)
    props.onRegisterResetSending(sidProp(), () => setSending(false))
  })
  onCleanup(() => {
    props.onTitlebarRef(null)
    if (sidProp()) props.onUnregisterAnchor(sidProp())
    props.onUnregisterResetSending(sidProp())
  })

  const addAttachments = async () => {
    try {
      const picked: any = await (window as any).api?.openFilePicker?.({ multiple: true })
      if (!picked?.files?.length) return
      setAttachments(prev => [...prev, ...picked.files.map((f: any) => ({ token: picked.token, path: f.path, name: f.name, size: f.size, mime: f.type || undefined }))])
    } catch (e) {
      console.warn("[mafw] openFilePicker error:", e)
    }
  }

  const removeAttachment = (idx: number) => {
    const att = attachments()[idx]
    const rest = attachments().filter((_, i) => i !== idx)
    setAttachments(prev => prev.filter((_, i) => i !== idx))
    // Multiple picker files share one token; only release when no other
    // attachment still needs it.
    if (att?.token && !rest.some(a => a.token === att.token)) {
      (window as any).api?.releasePickedFiles?.(att.token)
    }
  }

  // Electron 42 removed File.path — resolve via webUtils through preload.
  const pathOfFile = (file: File): string | undefined => {
    try {
      return (window as any).api?.getPathForFile?.(file) as string | undefined
    } catch { return undefined }
  }

  // Client-side downscale for pasted images: the opencode server's
  // image.normalize caps at 2000px / ~5MB base64 and throws (uncaught) when a
  // paste exceeds it — flatten to canvas first to keep sends reliable.
  const imageToDataUrl = async (file: File): Promise<string | undefined> => {
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("image decode failed"))
        img.src = raw
      })
      let { width, height } = img
      const MAX = 2000
      if (width > MAX || height > MAX) {
        const scale = Math.min(MAX / width, MAX / height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) return raw
      ctx.drawImage(img, 0, 0, width, height)
      const quality = raw.length > 4 * 1024 * 1024 ? 0.7 : 0.85
      return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", quality)
    } catch (e) {
      console.warn("[mafw] imageToDataUrl error:", e)
      return undefined
    }
  }

  const rawFileToDataUrl = async (file: File): Promise<string | undefined> => {
    try {
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
    } catch (e) {
      console.warn("[mafw] rawFileToDataUrl error:", e)
      return undefined
    }
  }

  // Upload raw media bytes to the gateway's A2A artifact store (binary body,
  // no base64 inflation, no IPC round-trip for the payload). Returns the
  // artifact id the message can reference via /api/media/create-task.
  const uploadMediaBinary = async (bytes: ArrayBuffer, mediaType: string): Promise<string> => {
    const base = (props.gatewayUrl || "http://127.0.0.1:3000").replace(/\/+$/, "")
    const res = await fetch(`${base}/api/media/upload?type=${encodeURIComponent(mediaType)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    })
    if (!res.ok) throw new Error(`媒体上传失败: HTTP ${res.status}`)
    const data: any = await res.json()
    if (!data?.artifactId) throw new Error("媒体上传失败: 无 artifactId")
    return data.artifactId
  }

  const addPastedFile = async (file: File) => {
    if (!file) return
    if (file.type.startsWith("image/")) {
      const dataUrl = await imageToDataUrl(file)
      if (!dataUrl) return
      setAttachments(prev => [...prev, { name: file.name || "粘贴图片.png", size: file.size, mime: file.type, dataUrl }])
    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      // Video/audio: no canvas pipeline — read the file straight to a data URL.
      const dataUrl = await rawFileToDataUrl(file)
      if (!dataUrl) return
      setAttachments(prev => [...prev, { name: file.name, size: file.size, mime: file.type, dataUrl }])
    } else {
      const path = pathOfFile(file)
      if (path) {
        setAttachments(prev => [...prev, { path, name: file.name, size: file.size, mime: file.type || undefined }])
      }
    }
  }

  // ── Paste (Ctrl+V / right-click / Shift+Insert all fire onPaste) ──
  const handlePaste = async (e: ClipboardEvent) => {
    const cd = e.clipboardData
    if (!cd) return
    const files = Array.from(cd.items || []).flatMap(item => {
      if (item.kind !== "file") return []
      const f = item.getAsFile()
      return f ? [f] : []
    })
    if (files.length > 0) {
      e.preventDefault()
      for (const f of files) await addPastedFile(f)
      return
    }
    const plainText = cd.getData("text/plain") ?? ""
    // Browser clipboard has no file items and no text — try system clipboard image.
    if (!plainText) {
      try {
        const img: any = await (window as any).api?.readClipboardImage?.()
        if (img?.buffer) {
          e.preventDefault()
          const file = new File([img.buffer], "剪贴板图片.png", { type: "image/png" })
          await addPastedFile(file)
        }
      } catch (err) {
        console.warn("[mafw] readClipboardImage error:", err)
      }
    }
    // Pure text: no preventDefault — native paste proceeds.
  }

  // ── Drag & drop onto the composer ──
  const handleDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault()
      setDragging(true)
    }
  }
  const handleDragLeave = (e: DragEvent) => {
    if (!e.currentTarget?.contains(e.relatedTarget as Node)) setDragging(false)
  }
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dt = e.dataTransfer
    if (!dt) return
    const plainText = dt.getData("text/plain")
    if (plainText?.startsWith("file:")) {
      const p = plainText.slice(5)
      if (p) setAttachments(prev => [...prev, { path: p, name: p.split(/[\\/]/).pop() || p, size: 0 }])
      return
    }
    const dropped = dt.files
    if (dropped?.length) {
      for (const f of Array.from(dropped)) await addPastedFile(f)
    }
  }

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

  const mimeOf = (name: string): string => {
    const ext = name.split(".").pop()?.toLowerCase() || ""
    const map: Record<string, string> = {
      md: "text/markdown", txt: "text/plain", json: "application/json", js: "text/plain", ts: "text/plain",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
      mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", ogg: "video/ogg",
      mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac", opus: "audio/ogg",
      pdf: "application/pdf", csv: "text/csv", yaml: "text/plain", yml: "text/plain", py: "text/plain",
    }
    return map[ext] || "application/octet-stream"
  }

  // Auto-grow the composer textarea up to 200px (single line at rest).
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  async function sendMessage() {
    const text = input()
    const atts = attachments()
    const agents = mentionedAgents()
    if ((!text.trim() && atts.length === 0) || sending()) return
    let sid = sidProp()
    if (!sid) { sid = await props.onCreateSession(); if (!sid) return }

    // ── Slash commands: dispatch before the plain-message path ──
    if (atts.length === 0 && agents.length === 0) {
      const cmd = matchCommand(text.trim())
      if (cmd) {
        const rest = text.trim().replace(/^\/\S+/, "").trim()
        setSending(true)
        setInput("")
        try {
          if (cmd.group === "mafw") {
            const result = await window.api.mafw.mafwCommands.run({ command: cmd.name, args: rest, sessionID: sid })
            if (result?.ok) {
              showToastV2({ description: result.message || result.text || `/${cmd.name} 完成`, duration: 4000 })
            } else {
              showToastV2({ description: `/${cmd.name} 失败: ${result?.error || "unknown"}`, duration: 4000 })
            }
          } else {
            await window.api.mafw.sessions.command({ sessionID: sid, command: cmd.name, arguments: rest })
          }
        } catch (e: any) {
          console.warn("[mafw] command run failed:", e)
          showToastV2({ description: `/${cmd.name} 执行失败: ${e?.message || String(e)}`, duration: 4000 })
        }
        setSending(false)
        return
      }
    }

    setSending(true)
    setInput("")
    setAttachments([])
    setMentionedAgents([])
    // Collapse the textarea back to single line after the message is queued
    const ta = textareaEl()
    if (ta) ta.style.height = "auto"

    const userMsgId = `user-${Date.now()}`
    const ts = Date.now()
    props.onSetUserMsgId(sid, userMsgId)

    // ── Vision attachments: images go to the gateway A2A VisionAgent first;
    // the message then carries a text pointer instead of the image part, so a
    // text-only model never receives raw image bytes. Non-image attachments
    // keep the original file-part path.
    const visionParts: any[] = []
    const visionFailed: string[] = []
    const visionThumbs: { name: string; mime: string; dataUrl: string }[] = []
    const visionable = atts.filter(a => { const m = a.mime || mimeOf(a.name); return m.startsWith("image/") || m.startsWith("video/") || m.startsWith("audio/") })
    for (const a of visionable) {
      try {
        let dataUrl = a.dataUrl
        let pickedBytes: ArrayBuffer | undefined
        if (!dataUrl && a.path) {
          // readPickedFile returns raw bytes; images reuse the paste downscale
          // pipeline, video/audio read straight (no canvas).
          pickedBytes = await (window as any).api?.readPickedFile?.(a.token, a.path)
          if (pickedBytes) {
            const mime = a.mime || mimeOf(a.name)
            const file = new File([pickedBytes], a.name, { type: mime })
            dataUrl = mime.startsWith("image/") ? await imageToDataUrl(file) : undefined
          }
        }
        // Derive the actual encoded format from the data URL prefix: canvas
        // re-encodes non-PNG to JPEG, so a.mime would mislabel gif/webp/bmp.
        const mediaType = dataUrl
          ? dataUrl.split(",")[0].replace("data:", "").replace(";base64", "")
          : (a.mime || mimeOf(a.name))
        // Upload bytes to the A2A artifact store (binary, no base64 JSON body);
        // the message references the artifact via a tiny URL part.
        let task: { id: string; contextId: string; state: string }
        try {
          let bytes: ArrayBuffer | undefined = pickedBytes
          if (!bytes && dataUrl) {
            // pasted/dragged attachments already carry a (downscaled) data URL;
            // convert back to bytes locally — no IPC/HTTP copy of the string.
            const blob = await (await fetch(dataUrl)).blob()
            bytes = await blob.arrayBuffer()
          }
          if (!bytes) throw new Error("无法读取媒体数据")
          const artifactId = await uploadMediaBinary(bytes, mediaType)
          task = await window.api.mafw.media.createTask({
            artifactId,
            mediaType,
            question: text.trim() || undefined,
          })
        } catch (uploadErr: any) {
          // Fallback: legacy base64 path (kept for gateway versions without
          // the upload endpoint).
          console.warn("[mafw] binary media upload failed, falling back to dataUrl:", uploadErr?.message || uploadErr)
          if (!dataUrl) throw new Error("无法读取媒体数据")
          task = await window.api.mafw.media.createTask({
            dataUrl,
            mediaType,
            question: text.trim() || undefined,
          })
        }
        visionParts.push({
          type: "text",
          id: `prt_media_${ts}_${visionParts.length}`,
          text: `[媒体附件 taskID: ${task.id} contextID: ${task.contextId}（媒体: ${a.name}），这是用户发给你的媒体消息（图片/视频/音频）——调用 mafw_media_ask 工具获取其内容后直接回应（taskID 填 ${task.id}）]`,
          synthetic: true,
        })
        visionThumbs.push({ name: a.name, mime: mediaType, dataUrl: dataUrl || "" })
      } catch (err: any) {
        visionFailed.push(`${a.name}: ${err?.message || String(err)}`)
      }
    }
    const nonVision = atts.filter(a => { const m = a.mime || mimeOf(a.name); return !(m.startsWith("image/") || m.startsWith("video/") || m.startsWith("audio/")) })
    const fileParts = nonVision.map((a, i) => a.dataUrl
      ? { type: "file", id: `prt_att_${ts}_${i}`, mime: a.mime || "image/png", filename: a.name, url: a.dataUrl }
      : { type: "file", id: `prt_att_${ts}_${i}`, mime: a.mime || mimeOf(a.name), filename: a.name, url: "file://" + encodeFilePath(a.path || "") })
    const agentParts = agents.map(a => ({ type: "agent", id: `prt_agent_${ts}_${a.name}`, name: a.name }))
    // Release picker tokens only after the vision reads above consumed the
    // image bytes (releasing first invalidates read-picked-file).
    for (const a of atts) if (a.token) (window as any).api?.releasePickedFiles?.(a.token)
    // Front-end display text: merge user text + vision pointers + failure notes
    // into a single non-synthetic text part. Message only renders the first
    // non-synthetic text part, so synthetic pointers alone would render an
    // empty user message. Pointers still reach the server via `parts` only.
    const pointerTexts = visionParts.map(p => p.text)
    const failureNote = visionFailed.length > 0 ? `[媒体附件未送达 Media Agent] ${visionFailed.join("; ")}` : ""
    const bodyMessage = [text.trim(), ...pointerTexts, failureNote].filter(Boolean).join("\n\n")
    const optimisticParts: any[] = []
    if (bodyMessage) {
      optimisticParts.push({ type: "text", text: bodyMessage, id: `${userMsgId}-text`, sessionID: sid, messageID: userMsgId })
    }
    // Local-only thumbnails: rendered immediately, kept across SSE/history
    // rewrites (prt_local_ parts are re-merged by loadSessionHistory/loadOlder),
    // but never sent to the server.
    optimisticParts.push(...visionThumbs.map((t, i) => ({
      type: "file", id: `prt_local_${ts}_${i}`, mime: t.mime, filename: t.name, url: t.dataUrl, localOnly: true, sessionID: sid, messageID: userMsgId,
    })))
    optimisticParts.push(...fileParts.map(p => ({ ...p, sessionID: sid, messageID: userMsgId })))
    optimisticParts.push(...agentParts.map(p => ({ ...p, sessionID: sid, messageID: userMsgId })))
    props.setStore(prev => {
      const msgs = { ...prev.message }
      const sessionMsgs = [...(msgs[sid] || [])]
      sessionMsgs.push({ id: userMsgId, sessionID: sid, role: "user", parentID: null, time: { created: Date.now() }, text: bodyMessage, agent: "general", model: { providerID: "opencode", modelID: "" } })
      msgs[sid] = sessionMsgs
      return {
        ...prev,
        message: msgs,
        part: { ...prev.part, [userMsgId]: optimisticParts },
      }
    })
    forceAnchor()

    console.log("[mafw] sendMessage", sid)
    try {
      const result = await window.api.mafw.chat.sendEnriched({
        message: text.trim() || failureNote,
        sessionID: sid,
        parts: visionParts.length || fileParts.length || agentParts.length ? [...visionParts, ...fileParts, ...agentParts] : undefined,
        agent: props.agentSel()?.name === "manager" ? undefined : props.agentSel()?.name,
        model: props.model() ? { providerID: props.model()!.providerID, modelID: props.model()!.modelID } : undefined,
      }) as any
      if (result?.sessionID) {
        console.log("[mafw] sendEnriched result: session", result.sessionID)
      } else {
        const errMsg = result?.error || 'no session ID returned'
        console.warn("[mafw] sendEnriched failed:", errMsg)
        showToastV2({ description: `Chat failed: ${errMsg}`, duration: 5000 })
        setSending(false)
      }
    } catch (err: any) {
      console.warn("[mafw] sendEnriched error:", err.message)
      setSending(false)
      showToastV2({ description: `Chat failed: ${err.message}`, duration: 5000 })
    }
  }

  // Interrupt the in-flight conversation (ESC / Ctrl+C / stop button)
  async function interrupt() {
    const sid = sidProp()
    if (!sid) return
    try {
      await window.api.mafw.sessions.abort(sid)
    } catch (e) {
      console.warn("[mafw] interrupt failed", e)
    }
    setSending(false)
  }

  // ESC / Ctrl+C interrupts this pane only when it is focused and sending.
  onMount(() => {
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
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
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
    const mafw: CommandItem[] = [
      { id: "mafw-goal", trigger: "/goal", title: "新建 Goal", description: "提交 Goal 给 Manager", group: "mafw" },
      { id: "mafw-status", trigger: "/status", title: "MAFW 状态", description: "查看当前状态", group: "mafw" },
      { id: "mafw-merge", trigger: "/merge-memory", title: "记忆融合", description: "合并 worktree 记忆", group: "mafw" },
    ]
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
      const [cmds, skills] = await Promise.all([
        window.api.mafw.command.list(dir).catch(() => []),
        window.api.mafw.skill.list(dir).catch(() => []),
      ])
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
    if (name === "goal" || name === "status" || name === "merge-memory") return { name, group: "mafw" }
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

  // ── TTS voice picker（统一音色入口：选中即保存 + 试听）──
  onMount(async () => {
    try {
      const cfg: any = await window.api.mafw.config.get("media.tts")
      if (cfg?.defaultVoice) setTtsVoiceSel(cfg.defaultVoice)
      if (cfg?.style) setTtsStyle(cfg.style)
    } catch { /* ignore */ }
  })

  const openTtsPicker = async () => {
    if (ttsVoices().length === 0) {
      try {
        const data: any = await window.api.mafw.tts.voices()
        if (data?.voices) setTtsVoices(data.voices)
        if (data?.defaultVoice) setTtsVoiceSel(v => v || data.defaultVoice)
      } catch (e) { console.warn("[mafw] tts voices fetch:", e) }
    }
    setPickerTrigger(textareaEl())
    setPickerOpen("tts")
  }

  const selectTtsVoice = async (id: string, label: string) => {
    setTtsVoiceSel(id)
    try {
      await window.api.mafw.config.set("media.tts.defaultVoice", id)
      showToastV2({ description: `默认音色：${label}`, duration: 2000 })
    } catch (e: any) {
      console.warn("[mafw] tts voice save:", e)
      showToastV2({ description: `音色保存失败: ${e?.message || String(e)}`, duration: 3000 })
    }
  }

  const saveTtsStyle = async () => {
    try {
      await window.api.mafw.config.set("media.tts.style", ttsStyle().trim())
    } catch (e: any) {
      console.warn("[mafw] tts style save:", e)
      showToastV2({ description: `风格保存失败: ${e?.message || String(e)}`, duration: 3000 })
    }
  }

  const previewTtsVoice = async (voice: string, label: string) => {
    if (previewing() === voice) { stopActivePlayback(); return }
    stopActivePlayback()
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioCtx({ sampleRate: 24000 })
    try {
      if (ctx.state === "suspended") await ctx.resume()
      const sid = (ctx as any).setSinkId
      if (typeof sid === "function") void sid.call(ctx, "default").catch(() => {})
    } catch {
      await ctx.close().catch(() => {})
      return
    }
    activeCtxRef = ctx
    const abort = new AbortController()
    activeAbortRef = abort
    setPreviewing(voice)
    try {
      await playStreamingTts(`你好，我是${label}。`, voice, ctx, abort.signal)
    } catch { /* preview errors ignored */ }
    finally {
      if (activeAbortRef === abort) activeAbortRef = null
      if (activeCtxRef === ctx) activeCtxRef = null
      setPreviewing(null)
      await ctx.close().catch(() => {})
    }
  }

  // One user message = one turn. Sorted by time as insurance against any
  // reordering between SSE appends and the history merge.
  const userMessages = () => {
    const sid = sidProp()
    if (!sid) return []
    const msgs = props.store.message[sid]
    if (!msgs?.length) return []
    return msgs
      .filter(m => m.role === "user")
      .sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))
  }

  // 语音回复：扫描本会话所有 assistant 消息的 text parts，提取 [语音回复 art:<id>]
  // 标记，供 AudioReply 渲染（挂在该 turn 的 SessionTurn 上方）。
  const voiceRepliesForTurn = (userMsgId: string) => {
    const sid = sidProp()
    if (!sid || !props.gatewayUrl) return []
    const msgs = props.store.message[sid] || []
    const userMsg = msgs.find(m => m.id === userMsgId)
    if (!userMsg) return []
    // 该 turn 的 assistant 消息 = parentID 指向 userMsg 的
    const assistants = msgs.filter(m => m.role === "assistant" && m.parentID === userMsg.id)
    const texts: string[] = []
    for (const a of assistants) {
      for (const p of props.store.part[a.id] || []) {
        if (p?.type === "text" && typeof p.text === "string") texts.push(p.text)
      }
    }
    const joined = texts.join("\n")
    const out: Array<{ artifactId: string; voice?: string; hash?: string }> = []
    for (const m of joined.matchAll(VOICE_REPLY_RE)) {
      if (m[1]) out.push({ artifactId: m[1], voice: m[2]?.trim(), hash: m[3]?.trim() || undefined })
    }
    return out
  }

  // mafw_media_speak 自动播放：回复文本出现新的 [语音回复 art:...] → 自动播 artifact。
  // 去重：playedVoiceArtifacts（历史重载不重播）；标记 h 匹配"已流式播放"→ 跳过（防双播）。
  createEffect(() => {
    const sid = sidProp()
    if (!sid || !props.gatewayUrl) return
    const users = userMessages()
    const last = users.length > 0 ? users[users.length - 1] : null
    if (!last) return
    const replies = voiceRepliesForTurn(last.id)
    if (replies.length === 0) return
    const base = props.gatewayUrl.replace(/\/+$/, "")
    for (const r of replies) {
      if (r.hash && streamedSpeakHashes.has(r.hash)) {
        console.log("[voice] artifact skipped (already streamed):", r.artifactId)
        continue
      }
      if (playedVoiceArtifacts.has(r.artifactId)) continue
      playedVoiceArtifacts.add(r.artifactId)
      const audio = new Audio(`${base}/a2a/artifacts/${r.artifactId}`)
      audio.onplay = () => console.log("[voice] artifact auto-playing:", r.artifactId)
      audio.onerror = () => console.log("[voice] artifact playback error:", r.artifactId)
      beginPlayback()
      activeAudioRef = audio
      const done = () => {
        if (activeAudioRef === audio) activeAudioRef = null
        endPlayback()
      }
      audio.onended = done
      void audio.play().then(
        () => console.log("[voice] artifact play() resolved:", r.artifactId),
        (err: any) => {
          done()
          playedVoiceArtifacts.delete(r.artifactId)
          console.log("[voice] artifact play() rejected:", r.artifactId, err?.name || err?.message || String(err))
          showToastV2({ description: "语音回复已生成，请点击播放", duration: 4000 })
        },
      )
    }
  })

  // Composite key (providerID/modelID) so same-id models under different
  // providers stay distinct.
  const pickerCurrentKey = createMemo(() => {
    const sid = sidProp()
    const msgs = sid ? (props.store.message[sid] || []) : []
    const last = [...msgs].reverse().find(m => m.role === "assistant")
    const m = last?.model
    if (m?.providerID && m?.modelID) return `${m.providerID}/${m.modelID}`
    if (props.model()) return `${props.model()!.providerID}/${props.model()!.modelID}`
    return undefined
  })

  const onModelSelectWrap = (m: ModelEntry) => {
    props.onModelSelect(m)
    setPickerOpen(null)
  }

  const busy = () => props.store.session_status[sidProp()]?.type === "busy"

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
  const stickToBottom = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 80
  const updateJump = (el: HTMLDivElement) => {
    setJumpVisible(el.scrollHeight - el.scrollTop - el.clientHeight > 120)
  }
  const forceAnchor = () => {
    const el = containerRef()
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    setJumpVisible(false)
  }
  const jumpToLatest = () => {
    const el = containerRef()
    if (el) el.scrollTop = el.scrollHeight
    setJumpVisible(false)
  }

  // Follow streaming only when already pinned to the bottom (don't steal the
  // scrollbar while the user is reading older content). Track a content
  // fingerprint (part count + total text length) rather than just part count:
  // streaming updates replace the same text part in place, so its length never
  // changes and a count-only dependency would never re-run.
  createEffect(() => {
    const el = containerRef()
    const sid = sidProp()
    if (!el || !sid) return
    const msgs = props.store.message[sid]
    const partCount = (msgs || []).reduce(
      (n, m) => n + (props.store.part[m.id] || []).reduce(
        (t, p) => t + (p.text?.length || 0),
        props.store.part[m.id]?.length || 0,
      ),
      0,
    )
    void partCount
    if (stickToBottom(el)) {
      el.scrollTop = el.scrollHeight
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
    if (el && stickToBottom(el)) forceAnchor()
  })

  // Lazy load older messages when scrolled near the top.
  async function loadOlder(sessionID: string) {
    const page = props.pageState[sessionID]
    if (!page || page.loading || !page.hasMore || !page.cursor) return
    props.setPageState(sessionID, 'loading', true)
    try {
      const data = await window.api.mafw.sessions.messages(sessionID, 100, page.cursor) as any
      const rawItems = Array.isArray(data) ? data : data?.data
      const nextCursor = data?.nextCursor ?? null
      const el = containerRef()
      const prevHeight = el?.scrollHeight || 0
      if (rawItems && Array.isArray(rawItems) && rawItems.length > 0) {
        const existing = props.store.message[sessionID] || []
        const existingById = new Map(existing.map(m => [m.id, m]))
        const msgs: any[] = [...existing]
        const parts: Record<string, any[]> = {}
        for (const item of rawItems) {
          const info = item.info || item
          const msgId = info.id || `msg-${Date.now()}-${Math.random()}`
          if (existingById.has(msgId)) continue
          const msg = { ...info, id: msgId, sessionID, time: info.time || { created: Date.now() } }
          msgs.push(msg)
          let itemParts = item.parts || info.parts || []
          if (itemParts.length > 0) {
            parts[msgId] = mergeLocalParts(props.store.part[msgId], itemParts.map((p: any) => ({ ...p, id: p.id || `p-${Date.now()}-${Math.random()}`, sessionID, messageID: msgId })))
          }
        }
        if (msgs.length > 0) {
          msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))
          props.setStore(prev => ({
            ...prev,
            message: { ...prev.message, [sessionID]: msgs },
            part: { ...prev.part, ...parts },
          }))
          // Preserve viewport position: older content is prepended above.
          if (el) {
            requestAnimationFrame(() => {
              el.scrollTop += el.scrollHeight - prevHeight
            })
          }
        }
      }
      props.setPageState(sessionID, { cursor: nextCursor, hasMore: !!nextCursor, loading: false })
    } catch (e) {
      console.warn("[mafw] loadOlder failed", e)
      props.setPageState(sessionID, 'loading', false)
    }
  }

  const handleScroll = () => {
    const el = containerRef()
    const sid = sidProp()
    if (!el || !sid) return
    updateJump(el)
    if (el.scrollTop < 100) void loadOlder(sid)
  }

  const title = () => props.store.session.find(s => s.id === sidProp())?.title || "Chat"

  // ── Flow card placement ──
  // Cards carry the assistant message id of the tool call that triggered them
  // (tool.messageID); place each card right after the user turn that contains
  // that assistant message. Cards without a resolvable link fall back to the
  // bottom of the conversation (old seeds, races where the message has not
  // arrived yet — the store is reactive, so a late-arriving message moves the
  // card into its turn automatically).
  const renderFlowCard = (c: FlowCardRecord) => {
    const sc = props.sessionCards(sidProp())
    return c.kind === "permission" ? (
      <PermissionCard
        data={c.data}
        queueLength={c.data.status === "pending" ? sc.queueLength : 0}
        keyboardOwner={c.data.id === sc.keyboardOwnerId}
        onAllowOnce={() => props.onPermReply(c.data, "once")}
        onAllowAlways={() => props.onPermReply(c.data, "always")}
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

  const turnOfMessage = (messageID: string): string | null => {
    const sid = sidProp()
    const msg = (props.store.message[sid] || []).find(m => m.id === messageID)
    if (!msg) return null
    if (msg.role === "user") return msg.id
    return msg.parentID || null
  }

  // Cards belonging to the user turn `userMsgId` (direct or via the assistant
  // message's parentID), in creation order.
  const cardsForTurn = (userMsgId: string): FlowCardRecord[] =>
    props.sessionCards(sidProp()).visible
      .filter(c => c.data.messageID && turnOfMessage(c.data.messageID) === userMsgId)
      .sort((a, b) => a.data.createdAt - b.data.createdAt)

  // Cards that could not be placed into any turn (no/unknown message link).
  const unplacedCards = (): FlowCardRecord[] =>
    props.sessionCards(sidProp()).visible
      .filter(c => !c.data.messageID || !turnOfMessage(c.data.messageID))
      .sort((a, b) => a.data.createdAt - b.data.createdAt)

  const agentSelName = () => props.agentSel()?.name || "manager"

  // Real model name of the last assistant message (fallback: agent → "default")
  const modelName = createMemo(() => {
    const sid = sidProp()
    const msgs = sid ? (props.store.message[sid] || []) : []
    const assistants = msgs.filter(m => m.role === "assistant")
    const last = assistants[assistants.length - 1]
    return last?.model?.modelID || last?.agent || "default"
  })

  const currentModelLabel = createMemo(() => props.model()?.label || modelName())

  return (
    <div class="mafw-pane" onClick={props.onFocus}>
      <div class="mafw-session-turn-container" ref={setContainerRef} onScroll={handleScroll}>
        <Show when={sidProp()}>
          <div class="mafw-session-titlebar">
            <div class="mafw-session-titlebar-inner" ref={setTitlebarEl}>
              <span class="mafw-agent-avatar">{title().charAt(0)}</span>
              <span class="mafw-session-titlebar-text">{title()}</span>
              <Show when={(props.todos[sidProp()] || []).length > 0 && !props.tasksAllDone(sidProp())}>
                <span class="mafw-chat-header-divider" />
              </Show>
              <TaskBar
                todos={props.todos[sidProp()] || []}
                tokens={props.taskMetrics(sidProp()).tokens}
                started={props.taskMetrics(sidProp()).started}
                open={props.taskListOpen && props.tasksPlacement === "bar"}
                onToggle={() => props.onTaskToggle(titlebarEl)}
              />
              <TooltipV2 value="任务列表" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-rightdock-btn" onClick={e => { e.stopPropagation(); props.onOpenRightDock("tasks") }} aria-label="任务列表">📋</ButtonV2>
              </TooltipV2>
              <TooltipV2 value="轨迹时间线" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-rightdock-btn" onClick={e => { e.stopPropagation(); props.onOpenRightDock("trajectory") }} aria-label="轨迹时间线">📊</ButtonV2>
              </TooltipV2>
              <Show when={(props.todos[sidProp()] || []).length > 0 && !props.tasksAllDone(sidProp())}>
                <span class="mafw-chat-header-done">
                  {(props.todos[sidProp()] || []).filter(t => t.status === "completed").length}/
                  {(props.todos[sidProp()] || []).length}
                </span>
              </Show>
              <Show when={props.store.session_status[sidProp()]?.type === "busy"}>
                <span class="mafw-session-status">
                  <span class="mafw-session-status-dot" />
                  Running
                </span>
              </Show>
              <Show when={props.canClosePane}>
                <TooltipV2 value="关闭分屏" openDelay={300}>
                  <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={e => { e.stopPropagation(); props.onClosePane() }} aria-label="关闭分屏">✕</ButtonV2>
                </TooltipV2>
              </Show>
              <Show when={props.parentID && props.onBackToParent}>
                <TooltipV2 value="返回父会话" openDelay={300}>
                  <ButtonV2 variant="outline" size="small" class="mafw-back-parent" onClick={e => { e.stopPropagation(); props.onBackToParent?.() }} aria-label="返回父会话">← 返回</ButtonV2>
                </TooltipV2>
              </Show>
            </div>
          </div>
          <For each={userMessages()}>
            {(msg) => (
              <>
                <For each={voiceRepliesForTurn(msg.id)}>
                  {(vr) => (
                    <div class="mafw-turn-audio">
                      <audio controls preload="auto" src={`${props.gatewayUrl.replace(/\/+$/, "")}/a2a/artifacts/${vr.artifactId}`}>
                        您的浏览器不支持音频播放。
                      </audio>
                    </div>
                  )}
                </For>
                <SessionTurn
                  sessionID={sidProp()}
                  messageID={msg.id}
                  classes={{ root: "min-w-0 w-full relative", content: "!overflow-visible", container: "w-full" }}
                />
                <For each={cardsForTurn(msg.id)}>
                  {(c) => renderFlowCard(c)}
                </For>
              </>
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
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-jump-latest"
            classList={{ visible: jumpVisible() }}
            onClick={jumpToLatest}
            aria-label="Jump to latest"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M12.3333 8.66665L8 13L3.66667 8.66665M8 12.6667V2.83332" stroke="currentColor" stroke-linecap="square" />
            </svg>
          </ButtonV2>
        </Show>
      </div>
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
                    <ButtonV2 variant="ghost" size="small" class="mafw-chip-x" onClick={() => removeAttachment(i())} aria-label="移除附件">✕</ButtonV2>
                  </span>
                )}
              </For>
              <For each={mentionedAgents()}>
                {(a) => (
                  <span class="mafw-chip">
                    <Icon name="sparkles" size="small" />
                    <span class="mafw-chip-label">@{a.name}</span>
                    <ButtonV2 variant="ghost" size="small" class="mafw-chip-x" onClick={() => removeAgent(a.name)} aria-label="移除引用">✕</ButtonV2>
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
              if (/^\/(\S*)$/.test(v) && pickerOpen() !== "command") openCommandPicker()
              else if (!v.startsWith("/") && pickerOpen() === "command") closeCommandPicker()
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (pickerOpen() === "command") { closeCommandPicker(); return } sendMessage() }
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
          <span class="mafw-keyhint">Enter 发送 · Shift+Enter 换行</span>
          <div class="mafw-composer-toolbar">
            <div class="mafw-composer-left">
              <TooltipV2 value="命令 (/)" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-composer-icon" aria-label="命令" onClick={() => { if (input() === "") setInput("/"); openCommandPicker() }}>/</ButtonV2>
              </TooltipV2>
              <TooltipV2 value="语音音色" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-composer-icon" aria-label="语音音色" onClick={() => { if (pickerOpen() === "tts") { setPickerOpen(null); return } void openTtsPicker() }}>🎙</ButtonV2>
              </TooltipV2>
              <TooltipV2 value="附件" openDelay={300}>
                <ButtonV2 variant="ghost" size="small" class="mafw-composer-icon" onClick={addAttachments} aria-label="附件">+</ButtonV2>
              </TooltipV2>
              <TooltipV2 value="语音回复（播报最后一条 AI 回复）" openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-composer-icon"
                  aria-label="语音回复"
                  disabled={ttsSpeaking()}
                  onClick={() => { console.log("[voice] speak button"); void speakText() }}
                >{ttsSpeaking() ? "…" : "🔊"}</ButtonV2>
              </TooltipV2>

              <TooltipV2 value={voiceRecording() ? "停止录音" : "语音输入（录音，静音自动分段）"} openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-composer-icon"
                  classList={{ "mafw-voice-recording": voiceRecording() }}
                  aria-label="语音输入"
                  onClick={() => {
                    if (voiceRecording()) { recorder.stop(); return }
                    // 手动打断：录音开始前停掉正在播放的语音（AEC 兜底，双击安全）
                    stopActivePlayback()
                    void recorder.start()
                  }}
                >{voiceRecording() ? "⏹" : "🎤"}</ButtonV2>
              </TooltipV2>

              <TooltipV2 value="引用 Agent" openDelay={300}>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-composer-icon"
                  aria-label="引用 Agent"
                  ref={(el: any) => { if (pickerOpen() === "agent-mention") setPickerTrigger(el) }}
                  onClick={() => { setPickerTrigger(document.activeElement as HTMLElement); setPickerOpen("agent-mention"); refreshSubagents() }}
                >@</ButtonV2>
              </TooltipV2>
            </div>
            <div class="mafw-composer-right">
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
              <Show when={sending()} fallback={
                <ButtonV2
                  variant="contrast"
                  size="small"
                  onClick={sendMessage}
                  disabled={!input().trim() && attachments().length === 0}
                  class="mafw-send"
                  classList={{ "mafw-send-disabled": !input().trim() && attachments().length === 0 }}
                  aria-label="发送"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M7 11.5V2.5M3 6.5L7 2.5L11 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
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
          lockedManager={props.isManager}
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
        <PopoverShell open={pickerOpen() === "tts"} trigger={pickerTrigger()} anchor="below-center" width={340} onClose={() => setPickerOpen(p => p === "tts" ? null : p)}>
          <div class="mafw-tts-picker">
            <div class="mafw-picker-title">语音音色</div>
            <Show when={ttsVoices().length > 0} fallback={<div class="mafw-picker-empty">正在加载音色…</div>}>
              <div class="mafw-tts-list">
                <For each={ttsVoices()}>
                  {(v, i) => (
                    <div
                      class="mafw-tts-row"
                      classList={{ sel: ttsVoiceSel() === v.id, playing: previewing() === v.id }}
                      onClick={() => void selectTtsVoice(v.id, v.label)}
                    >
                      <span class="mafw-tts-avatar" style={{ background: VOICE_GRADIENTS[i() % VOICE_GRADIENTS.length] }}>{v.label[0]}</span>
                      <span class="mafw-tts-name">{v.label}</span>
                      <span class="mafw-tts-lang">{v.lang === "zh" ? "中文" : v.lang === "en" ? "EN" : v.lang || "auto"}</span>
                      <ButtonV2
                        variant="ghost"
                        size="small"
                        class="mafw-tts-preview"
                        aria-label={`试听 ${v.label}`}
                        disabled={previewing() !== null && previewing() !== v.id}
                        onClick={(e: MouseEvent) => { e.stopPropagation(); void previewTtsVoice(v.id, v.label) }}
                      >{previewing() === v.id ? <span class="mafw-tts-eq"><i/><i/><i/></span> : "▶"}</ButtonV2>
                      <Show when={ttsVoiceSel() === v.id}>
                        <span class="mafw-picker-row-check">✓</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="mafw-picker-group-label">默认风格（可选）</div>
            <div class="mafw-picker-search mafw-tts-style">
              <span class="mafw-picker-search-icon">✨</span>
              <input
                class="mafw-picker-search-input"
                placeholder="如：用轻快上扬的语调，语速稍快…"
                value={ttsStyle()}
                onInput={e => setTtsStyle(e.currentTarget.value)}
                onBlur={() => void saveTtsStyle()}
                onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void saveTtsStyle() } }}
              />
            </div>
            <div class="mafw-tts-hint">支持音频标签：(风格)文本 · [标签] · (唱歌)歌词</div>
            <div class="mafw-picker-hint">点击选择 · ▶ 试听 · Esc 关闭</div>
          </div>
        </PopoverShell>
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
