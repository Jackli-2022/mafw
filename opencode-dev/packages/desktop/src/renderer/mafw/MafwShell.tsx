// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from "solid-js"
import { createStore } from "solid-js/store"


import { Icon } from "@opencode-ai/ui/icon"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
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
import { StatusBar } from "./components/StatusBar"
import { registerMafwToolCards } from "./components/MafwToolCards"
import { DashboardPage } from "./pages/Dashboard"
import { MemoryPage } from "./pages/Memory"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { TriagePage } from "./pages/TriagePage"
import { AutomationsPage } from "./pages/Automations"
import { ConfigPage } from "./pages/Config"
import { QuestionWidget, type QuestionData } from "./components/QuestionWidget"
import "./mafw.css"

interface ChatSession {
  id: string
  title: string
  userMsgId: string
  assistantMsgId: string | null
  done: boolean
}

export function MafwShell() {
  const [activeTab, setActiveTab] = createSignal<Tab>("chat")
  const [showConfig, setShowConfig] = createSignal(false)
  const [input, setInput] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [gwStatus, setGwStatus] = createSignal<{ state: string; port: number | null } | null>(null)
  const [theme, setTheme] = createSignal<string | null>(null)

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

  // Theme: restore manual override from localStorage (null = follow system)
  onMount(() => {
    const saved = localStorage.getItem('mafw-theme')
    if (saved) {
      document.documentElement.dataset.theme = saved
      setTheme(saved)
    }
  })
  const toggleTheme = () => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const cur = document.documentElement.dataset.theme || (mq.matches ? 'light' : 'dark')
    const next = cur === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
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
      console.log("[mafw] SSE recv:", event.type, "sid:", sid)
      if (!sid) return
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
      } else if (event.type === "message.complete" || event.type === "message.part.complete") {
        setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: { type: "idle" } } }))
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, done: true } : s))
        setSending(false)
      } else if (event.type === "message.error" || event.type === "message.aborted") {
        setStore(prev => ({ ...prev, session_status: { ...prev.session_status, [sid]: { type: "idle" } } }))
        setSending(false)
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

  async function sendMessage() {
    const text = input()
    if (!text.trim() || sending()) return
    let sid = activeSessionId()
    if (!sid) { sid = await createSession(); if (!sid) return }

    setSending(true)
    setInput("")

    const userMsgId = `user-${Date.now()}`
    setSessions(prev => prev.map(s => s.id === sid ? { ...s, userMsgId } : s))

    // Add user message to store
    setStore(prev => {
      const msgs = { ...prev.message }
      const sessionMsgs = [...(msgs[sid] || [])]
      sessionMsgs.push({ id: userMsgId, sessionID: sid, role: "user", parentID: null, time: { created: Date.now() }, text, agent: "general", model: { providerID: "opencode", modelID: "" } })
      msgs[sid] = sessionMsgs
      return {
        ...prev,
        message: msgs,
        part: { ...prev.part, [userMsgId]: [{ type: "text", text, id: `${userMsgId}-text`, sessionID: sid, messageID: userMsgId }] },
      }
    })
    forceAnchor()

    console.log("[mafw] sendMessage", sid)
    try {
      const result = await window.api.mafw.chat.sendEnriched(text, sid) as any
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
        <div class="mafw-status-dot" classList={{
          ready: gwStatus()?.state === "ready",
          starting: gwStatus()?.state === "starting",
          failed: gwStatus()?.state === "failed",
          stopped: !gwStatus() || gwStatus()?.state === "stopped",
        }} style={{ "margin-left": 4 }} />
        <TooltipV2 value="切换主题" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" class="mafw-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme() === 'light' ? '☀' : '☾'}
          </ButtonV2>
        </TooltipV2>
        {showConfig() && (
          <ButtonV2 variant="ghost" size="small" onClick={() => setShowConfig(false)} style={{ "margin-left": "auto" }}>← Back to tabs</ButtonV2>
        )}
      </div>
      <div class="mafw-body">
        <Rail activeSessionId={activeSessionId()} sessionRefreshKey={sessionRefreshKey()} onSelectSession={(id, title) => {
          setActiveTab("chat")
          // Ensure session exists in local tabs and store
          if (!sessions().find(s => s.id === id)) {
            const tabTitle = title || `Chat ${sessions().length + 1}`
            setSessions(prev => [...prev, { id, title: tabTitle, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false }])
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
          {!showConfig() && <TabStrip active={activeTab()} onChange={t => { setActiveTab(t); setShowConfig(false) }} />}
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
                                <span class="mafw-session-titlebar-text">{active()?.title || "Chat"}</span>
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
                              <button
                                type="button"
                                class="mafw-jump-latest"
                                classList={{ visible: jumpVisible() }}
                                onClick={jumpToLatest}
                                aria-label="Jump to latest"
                              >
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                  <path d="M12.3333 8.66665L8 13L3.66667 8.66665M8 12.6667V2.83332" stroke="currentColor" stroke-linecap="square" />
                                </svg>
                              </button>
                            </Show>
                          </div>
                {/* TaskPanel — collapsible task progress (visible when the session has todos) */}
                <Show when={currentSessionID() && (todos[currentSessionID()] || []).length > 0}>
                  <div style={{ padding: "0 16px 4px" }}>
                    <TaskPanel
                      sessionID={currentSessionID()!}
                      todos={todos[currentSessionID()] || []}
                      tokens={taskMetrics().tokens}
                      started={taskMetrics().started}
                    />
                  </div>
                </Show>
                {/* InputBar */}
                <div class="mafw-inputbar">
                  <TextareaV2
                    value={input()}
                    onInput={e => setInput(e.currentTarget.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
                    }}
                    placeholder="Type a message..."
                    disabled={sending()}
                    class="mafw-input"
                  />
                  <Show when={sending()} fallback={
                    <ButtonV2 variant="contrast" size="small" onClick={sendMessage} disabled={!input().trim()}>Send</ButtonV2>
                  }>
                    <ButtonV2 variant="contrast" size="small" onClick={interrupt} aria-label="Stop conversation">
                      <span style={{ "font-size": 14, "line-height": 1 }}>■</span>
                    </ButtonV2>
                  </Show>
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
      <StatusBar />
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
