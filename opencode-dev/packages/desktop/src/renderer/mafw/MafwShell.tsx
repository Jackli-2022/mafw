// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from "solid-js"
import { createStore } from "solid-js/store"


import { Icon } from "@opencode-ai/ui/icon"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ToastV2, showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { FileSSR } from "@opencode-ai/session-ui/file-ssr"
import { Rail } from "./components/Rail"
import { TaskPanel } from "./components/TaskPanel"
import { TabStrip, type Tab } from "./components/TabStrip"
import { registerMafwToolCards } from "./components/MafwToolCards"
import { DashboardPage } from "./pages/Dashboard"
import { MemoryPage } from "./pages/Memory"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { TriagePage } from "./pages/TriagePage"
import { AutomationsPage } from "./pages/Automations"
import { ConfigPage } from "./pages/Config"
import { QuestionWidget, type QuestionData } from "./components/QuestionWidget"
import { AskCard, type AskCardData } from "./components/AskCard"
import { PermissionCard, type PermissionCardData } from "./components/PermissionCard"
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
  const [input, setInput] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [gwStatus, setGwStatus] = createSignal<{ state: string; port: number | null } | null>(null)
  const [textareaEl, setTextareaEl] = createSignal<HTMLTextAreaElement | null>(null)
  const [theme, setTheme] = createSignal<string | null>(null)

  // Composer extras: attachments (picker token + files), @agent mentions, model selection
  const [attachments, setAttachments] = createSignal<{ token: string; path: string; name: string; size: number }[]>([])
  const [mentionedAgents, setMentionedAgents] = createSignal<{ name: string }[]>([])
  const [modelSel, setModelSel] = createSignal<{ providerID: string; modelID: string; label: string } | null>(null)

  const addAttachments = async () => {
    try {
      const picked: any = await (window as any).api?.openFilePicker?.({ multiple: true })
      if (!picked?.files?.length) return
      setAttachments(prev => [...prev, ...picked.files.map((f: any) => ({ token: picked.token, path: f.path, name: f.name, size: f.size }))])
    } catch (e) {
      console.warn("[mafw] openFilePicker error:", e)
    }
  }

  const removeAttachment = (idx: number) => {
    const att = attachments()[idx]
    setAttachments(prev => prev.filter((_, i) => i !== idx))
    if (att?.token) (window as any).api?.releasePickedFiles?.(att.token)
  }

  const addAgent = (name: string) => {
    if (name && !mentionedAgents().some(a => a.name === name)) {
      setMentionedAgents(prev => [...prev, { name }])
    }
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
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
      pdf: "application/pdf", csv: "text/csv", yaml: "text/plain", yml: "text/plain", py: "text/plain",
    }
    return map[ext] || "application/octet-stream"
  }

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

  // Lazy-load pagination state per session (older messages via `before` cursor)
  const [pageState, setPageState] = createStore<Record<string, { cursor: string | null; hasMore: boolean; loading: boolean }>>({})

  // Todo list per session (drives the TaskPanel; updated live via SSE todo.updated)
  const [todos, setTodos] = createStore<Record<string, any[]>>({})

  // AskCard / PermissionCard per session (in-chat flow cards)
  type FlowCardRecord =
    | { kind: "ask"; data: AskCardData }
    | { kind: "permission"; data: PermissionCardData }
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
        setSending(false)
        expireSessionCards(sid)
      } else if (event.type === "message.part.complete") {
        setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: { type: "idle" } } }))
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, done: true } : s))
        setSending(false)
      } else if (event.type === "message.error" || event.type === "message.aborted") {
        setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: { type: "idle" } } }))
        setSending(false)
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
      // Fetch the todo list for the TaskPanel (also updated live via SSE)
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
      const existing = store.message[sessionID] || []
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
        let itemParts = item.parts || info.parts || []
        if (itemParts.length > 0) {
          parts[msgId] = itemParts.map((p: any) => ({ ...p, id: p.id || `p-${Date.now()}-${Math.random()}`, sessionID, messageID: msgId }))
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
        forceAnchor()
      }
    } catch (e) { console.warn("[mafw] loadHistory failed", e); showToastV2({ description: "Failed to load session history", duration: 5000 }) }
  }

  // Active session
  const active = () => sessions().find(s => s.id === activeSessionId()) || null

  async function createSession() {
    console.log("[mafw] createSession")
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
      return id
    } catch {
      const id = `local-${Date.now()}`
      setSessions(prev => [...prev, { id, title: `Chat ${sessions().length + 1}`, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false }])
      setActiveSessionId(id)
      setSessionRefreshKey(k => k + 1)
      return id
    }
  }

  function closeSession(id: string) {
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeSessionId() === id) {
      const remaining = sessions().filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
    setSessionRefreshKey(k => k + 1)
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
    let sid = activeSessionId()
    if (!sid) { sid = await createSession(); if (!sid) return }

    setSending(true)
    setInput("")
    setAttachments([])
    setMentionedAgents([])
    for (const a of atts) if (a.token) (window as any).api?.releasePickedFiles?.(a.token)
    // Collapse the textarea back to single line after the message is queued
    const ta = textareaEl()
    if (ta) ta.style.height = "auto"

    const userMsgId = `user-${Date.now()}`
    const ts = Date.now()
    setSessions(prev => prev.map(s => s.id === sid ? { ...s, userMsgId } : s))

    // Build parts ONCE — the same ids feed the optimistic store entry and the
    // request payload, so the server echo (which preserves part ids) merges
    // instead of duplicating chips.
    const fileParts = atts.map((a, i) => ({ type: "file", id: `prt_att_${ts}_${i}`, mime: mimeOf(a.name), filename: a.name, url: "file://" + encodeFilePath(a.path) }))
    const agentParts = agents.map(a => ({ type: "agent", id: `prt_agent_${ts}_${a.name}`, name: a.name }))
    const optimisticParts: any[] = [{ type: "text", text, id: `${userMsgId}-text`, sessionID: sid, messageID: userMsgId }]
    optimisticParts.push(...fileParts.map(p => ({ ...p, sessionID: sid, messageID: userMsgId })))
    optimisticParts.push(...agentParts.map(p => ({ ...p, sessionID: sid, messageID: userMsgId })))
    setStore(prev => {
      const msgs = { ...prev.message }
      const sessionMsgs = [...(msgs[sid] || [])]
      sessionMsgs.push({ id: userMsgId, sessionID: sid, role: "user", parentID: null, time: { created: Date.now() }, text, agent: "general", model: { providerID: "opencode", modelID: "" } })
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
        message: text,
        sessionID: sid,
        parts: fileParts.length || agentParts.length ? [...fileParts, ...agentParts] : undefined,
        agent: undefined,
        model: modelSel() ? { providerID: modelSel()!.providerID, modelID: modelSel()!.modelID } : undefined,
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
    const sid = activeSessionId()
    if (!sid) return
    try {
      await window.api.mafw.sessions.abort(sid)
    } catch (e) {
      console.warn("[mafw] interrupt failed", e)
    }
    setSending(false)
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sending()) return
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

  // Current rendering state for SessionTurn
  const currentSessionID = () => active()?.id || ""

  // Real model name of the last assistant message (fallback: agent → "default")
  const modelName = createMemo(() => {
    const sid = currentSessionID()
    const msgs = sid ? (store.message[sid] || []) : []
    const assistants = msgs.filter(m => m.role === "assistant")
    const last = assistants[assistants.length - 1]
    return last?.model?.modelID || last?.agent || "default"
  })

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
    }).catch(e => console.warn("[mafw] providers.list:", e))
  })

  const agentOptions = createMemo(() =>
    (agentsData() || []).filter((a: any) => !a.hidden && a.mode !== "primary")
  )

  const modelGroups = createMemo(() => {
    const p = providersData()
    const connected = new Set(p?.connected || [])
    const all = p?.all || []
    const groups: { provider: string; providerID: string; models: any[] }[] = []
    for (const prov of all) {
      if (!connected.has(prov.id)) continue
      const models = Object.values(prov.models || {})
      if (models.length === 0) continue
      groups.push({ provider: prov.name || prov.id, providerID: prov.id, models })
    }
    return groups
  })

  // One user message = one turn. Sorted by time as insurance against any
  // reordering between SSE appends and the history merge.
  const userMessages = () => {
    const sid = currentSessionID()
    if (!sid) return []
    const msgs = store.message[sid]
    if (!msgs?.length) return []
    return msgs
      .filter(m => m.role === "user")
      .sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))
  }

  // TaskPanel metrics: tokens + start time of the current (last) turn
  const taskMetrics = createMemo(() => {
    const sid = currentSessionID()
    if (!sid) return { tokens: 0, started: 0 }
    const msgs = store.message[sid] || []
    const userMsgs = msgs.filter(m => m.role === "user")
    const userMsg = userMsgs[userMsgs.length - 1]
    if (!userMsg) return { tokens: 0, started: 0 }
    const assistants = msgs.filter(m => m.role === "assistant" && m.parentID === userMsg.id)
    const last = assistants[assistants.length - 1]
    const tokens = last?.tokens?.total || last?.tokens?.output || 0
    return { tokens, started: userMsg.time?.created || 0 }
  })

  // Scroll container: the outer .mafw-session-turn-container is the single
  // scroller (each SessionTurn's internal content is forced overflow-visible).
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement | null>(null)
  const [jumpVisible, setJumpVisible] = createSignal(false)
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
  // scrollbar while the user is reading older content).
  createEffect(() => {
    const el = containerRef()
    const sid = currentSessionID()
    if (!el || !sid) return
    const msgs = store.message[sid]
    const partCount = (msgs || []).reduce((n, m) => n + (store.part[m.id]?.length || 0), 0)
    void partCount
    if (stickToBottom(el)) {
      el.scrollTop = el.scrollHeight
      setJumpVisible(false)
    } else {
      updateJump(el)
    }
  })

  // New tab / session switch anchors to the bottom (show latest).
  createEffect(() => {
    const sid = activeSessionId()
    if (sid) forceAnchor()
  })

  // A new pending flow card scrolls into view only when pinned to the bottom;
  // otherwise the jump pill signals pending answers.
  createEffect(() => {
    const sid = currentSessionID()
    const cards = sid ? sessionCards(sid).visible : []
    const pending = cards.filter(c => c.data.status === "pending").length
    void pending
    const el = containerRef()
    if (el && stickToBottom(el)) forceAnchor()
  })

  // Lazy load older messages when scrolled near the top.
  async function loadOlder(sessionID: string) {
    const page = pageState[sessionID]
    if (!page || page.loading || !page.hasMore || !page.cursor) return
    setPageState(sessionID, 'loading', true)
    try {
      const data = await window.api.mafw.sessions.messages(sessionID, 100, page.cursor) as any
      const rawItems = Array.isArray(data) ? data : data?.data
      const nextCursor = data?.nextCursor ?? null
      const el = containerRef()
      const prevHeight = el?.scrollHeight || 0
      if (rawItems && Array.isArray(rawItems) && rawItems.length > 0) {
        const existing = store.message[sessionID] || []
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
            parts[msgId] = itemParts.map((p: any) => ({ ...p, id: p.id || `p-${Date.now()}-${Math.random()}`, sessionID, messageID: msgId }))
          }
        }
        if (msgs.length > 0) {
          msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))
          setStore(prev => ({
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
      setPageState(sessionID, { cursor: nextCursor, hasMore: !!nextCursor, loading: false })
    } catch (e) {
      console.warn("[mafw] loadOlder failed", e)
      setPageState(sessionID, 'loading', false)
    }
  }

  const handleScroll = () => {
    const el = containerRef()
    const sid = currentSessionID()
    if (!el || !sid) return
    updateJump(el)
    if (el.scrollTop < 100) void loadOlder(sid)
  }

  // Gateway status
  onMount(async () => {
    const info = await window.api.mafw.gateway.info()
    setGwStatus(info)
    const unsub = window.api.mafw.gateway.onStateChange(s => setGwStatus(s))
    onCleanup(unsub)
  })

  return (
      <DialogProvider>
        <MarkedProvider>
          <FileComponentProvider component={FileSSR}>
            <DataProvider data={store} directory=".">
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
        {showConfig() && (
          <ButtonV2 variant="ghost" size="small" onClick={() => setShowConfig(false)} style={{ "margin-left": "auto" }}>← Back to tabs</ButtonV2>
        )}
      </div>
      <div class="mafw-body">
        <Rail activeSessionId={activeSessionId()} sessionRefreshKey={sessionRefreshKey()} onSelectSession={(id, title, manager) => {
          setActiveTab("chat")
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
        }} onSettings={() => setShowConfig(true)} />
        <div class="mafw-main">
          {!showConfig() && <TabStrip active={activeTab()} onChange={t => { setActiveTab(t); setShowConfig(false) }} counts={{ approvals: pendingPermissionCount() }} />}
          <div class="mafw-content" classList={{ "mafw-chat-content": activeTab() === "chat" }}>
            {showConfig() ? (
              <ConfigPage />
            ) : activeTab() === "chat" ? (
              <div class="mafw-chat">
                {/* SessionStrip */}
                <div class="mafw-sessionstrip">
                  {sessions().map(s => (
                    <ContextMenu>
                      <ContextMenu.Trigger
                        as="div"
                        class="mafw-session-tab"
                        classList={{ active: s.id === activeSessionId() }}
                        onClick={() => setActiveSessionId(s.id)}
                      >
                        <span class="mafw-agent-dot" style={{ background: s.manager ? "var(--accent)" : "var(--text-4)" }} />
                        <span class="mafw-session-title">{s.title}</span>
                        <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={e => { e.stopPropagation(); closeSession(s.id) }}>✕</ButtonV2>
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content>
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
                  <ButtonV2 variant="ghost" size="small" class="mafw-session-new" onClick={createSession}>+</ButtonV2>
                </div>
                {/* SessionTurns — one SessionTurn per user message (turn = user msg + its assistant replies incl. tool calls) */}
                          <div ref={setContainerRef} onScroll={handleScroll} class="mafw-session-turn-container">
                            <Show when={currentSessionID()}>
                              <div class="mafw-session-titlebar">
                                <div class="mafw-session-titlebar-inner">
                                  <span class="mafw-agent-avatar">{(active()?.title || "A").charAt(0)}</span>
                                  <span class="mafw-session-titlebar-text">{active()?.title || "Chat"}</span>
                                  <Show when={store.session_status[currentSessionID()]?.type === "busy"}>
                                    <span class="mafw-session-status">
                                      <span class="mafw-session-status-dot" />
                                      Running
                                    </span>
                                  </Show>
                                </div>
                              </div>
                              <For each={userMessages()}>
                                {(msg) => (
                                  <SessionTurn
                                    sessionID={currentSessionID()!}
                                    messageID={msg.id}
                                    classes={{ root: "min-w-0 w-full relative", content: "!overflow-visible", container: "w-full" }}
                                  />
                                )}
                              </For>
                              {/* Flow cards: permission first (serial queue), then ask cards */}
                              <Show when={currentSessionID()}>
                                <For each={sessionCards(currentSessionID()!).visible}>
                                  {(c) => {
                                    const sc = sessionCards(currentSessionID()!)
                                    return c.kind === "permission" ? (
                                      <PermissionCard
                                        data={c.data}
                                        queueLength={c.data.status === "pending" ? sc.queueLength : 0}
                                        keyboardOwner={c.data.id === sc.keyboardOwnerId}
                                        onAllowOnce={() => permReply(c.data, "once")}
                                        onAllowAlways={() => permReply(c.data, "always")}
                                        onDeny={(note) => permReply(c.data, "reject", note)}
                                      />
                                    ) : (
                                      <AskCard
                                        data={c.data}
                                        keyboardOwner={c.data.id === sc.keyboardOwnerId}
                                        onSubmit={(answers, custom) => askSubmit(c.data, answers, custom)}
                                        onCancel={() => askCancel(c.data)}
                                      />
                                    )
                                  }}
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
                {/* InputArea — 760px centered wrapper: TaskPanel (in-flow, §4.6) + composer box (§4.7) */}
                <div class="mafw-input-area">
                  <Show when={currentSessionID() && (todos[currentSessionID()] || []).length > 0}>
                    <div class="mafw-tasks-float">
                      <TaskPanel
                        sessionID={currentSessionID()!}
                        todos={todos[currentSessionID()] || []}
                        tokens={taskMetrics().tokens}
                        started={taskMetrics().started}
                      />
                    </div>
                  </Show>
                  <Show when={currentSessionID() && sessionPending(currentSessionID()!) > 0 && jumpVisible()}>
                    <ButtonV2 variant="outline" size="small" class="mafw-pending-pill" onClick={jumpToLatest} aria-label="有待回答卡片">
                      <span class="mafw-flow-pulse" />
                      有 {sessionPending(currentSessionID()!)} 个待回答 ↓
                    </ButtonV2>
                  </Show>
                  <div class="mafw-composer">
                    {/* Attachment + @agent chips row */}
                    <Show when={attachments().length > 0 || mentionedAgents().length > 0}>
                      <div class="mafw-composer-chips">
                        <For each={attachments()}>
                          {(a, i) => (
                            <span class="mafw-chip">
                              <Icon name="file" size="small" />
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
                      onInput={e => { setInput(e.currentTarget.value); autoGrow(e.currentTarget) }}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
                      }}
                      ref={setTextareaEl}
                      placeholder={gwStatus()?.state === "ready" ? "输入消息…" : "重新连接中…"}
                      disabled={gwStatus()?.state !== "ready"}
                      class="mafw-input"
                    />
                    <span class="mafw-keyhint">Enter 发送 · Shift+Enter 换行</span>
                    <div class="mafw-composer-toolbar">
                      <div class="mafw-composer-left">
                        <TooltipV2 value="附件" openDelay={300}>
                          <ButtonV2 variant="ghost" size="small" class="mafw-composer-icon" onClick={addAttachments} aria-label="附件">+</ButtonV2>
                        </TooltipV2>
                        <TooltipV2 value="引用 Agent" openDelay={300}>
                          <MenuV2>
                            <MenuV2.Trigger as="div" role="button" aria-label="引用 Agent">
                              <ButtonV2 variant="ghost" size="small" class="mafw-composer-icon">@</ButtonV2>
                            </MenuV2.Trigger>
                            <MenuV2.Portal>
                              <MenuV2.Content class="mafw-composer-menu" onClick={(e: any) => e.stopPropagation()}>
                                <For each={agentOptions()}>
                                  {(a) => (
                                    <MenuV2.Item onSelect={() => addAgent(a.name)} disabled={mentionedAgents().some(x => x.name === a.name)}>
                                      <span class="mafw-menu-agent">
                                        <span class="mafw-agent-dot" style={{ background: a.color || "var(--text-4)" }} />
                                        {a.name}
                                        <Show when={a.description}><span class="mafw-menu-agent-desc">{a.description}</span></Show>
                                      </span>
                                    </MenuV2.Item>
                                  )}
                                </For>
                                <Show when={agentOptions().length === 0}>
                                  <MenuV2.Item disabled>暂无可用 agent</MenuV2.Item>
                                </Show>
                              </MenuV2.Content>
                            </MenuV2.Portal>
                          </MenuV2>
                        </TooltipV2>
                      </div>
                      <div class="mafw-composer-right">
                        <TooltipV2 value="模型" openDelay={300}>
                          <MenuV2>
                            <MenuV2.Trigger as="div" role="button" aria-label="模型">
                              <ButtonV2 variant="ghost" size="small" class="mafw-model-pill">
                                {modelSel()?.label || modelName()}<span class="mafw-model-chevron">▾</span>
                              </ButtonV2>
                            </MenuV2.Trigger>
                            <MenuV2.Portal>
                              <MenuV2.Content class="mafw-composer-menu" onClick={(e: any) => e.stopPropagation()}>
                                <For each={modelGroups()}>
                                  {(g) => (
                                    <MenuV2.Group>
                                      <MenuV2.GroupLabel>{g.provider}</MenuV2.GroupLabel>
                                      <For each={g.models}>
                                        {(m) => (
                                          <MenuV2.Item
                                            onSelect={() => setModelSel({ providerID: g.providerID, modelID: m.id, label: m.name || m.id })}
                                            classList={{ selected: modelSel()?.modelID === m.id && modelSel()?.providerID === g.providerID }}
                                          >
                                            <span class="mafw-menu-model">
                                              <span class="mafw-menu-model-name">{m.name || m.id}</span>
                                              <Show when={m.id !== (m.name || m.id)}><span class="mafw-menu-model-id">{m.id}</span></Show>
                                            </span>
                                          </MenuV2.Item>
                                        )}
                                      </For>
                                    </MenuV2.Group>
                                  )}
                                </For>
                                <Show when={modelGroups().length === 0}>
                                  <MenuV2.Item disabled>暂无可用模型</MenuV2.Item>
                                </Show>
                              </MenuV2.Content>
                            </MenuV2.Portal>
                          </MenuV2>
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
                </div>
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
