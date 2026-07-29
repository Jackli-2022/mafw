// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ToastV2, showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { FileSSR } from "@opencode-ai/session-ui/file-ssr"
import { Rail } from "./components/Rail"
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

  // Reactive data store for SessionTurn
  const [store, setStore] = createSignal({
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

  onMount(() => { registerMafwToolCards() })

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

      if (!event?.sessionID) return

      const sid = event.sessionID
      if (event.type === "message.part.updated") {
        const part = event.payload?.part || event.properties?.part
        if (!part) return
        const msgId = part.messageID
        if (!msgId) return

        setStore(prev => {
          const msgs = { ...prev.message }
          const sessionMsgs = [...(msgs[sid] || [])]
          if (!sessionMsgs.find(m => m.id === msgId)) {
            const pm = sessions().find(s => s.id === sid)?.userMsgId || null
            sessionMsgs.push({ id: msgId, sessionID: sid, role: "assistant", parentID: pm, time: { created: Date.now() }, parts: [] })
            msgs[sid] = sessionMsgs
          }
          const parts = { ...prev.part }
          parts[msgId] = [...(parts[msgId] || []), { ...part, id: part.id || `p-${Date.now()}` }]
          return { ...prev, message: msgs, part: parts }
        })
      } else if (event.type === "message.complete" || event.type === "message.part.complete") {
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, done: true } : s))
        setSending(false)
      } else if (event.type === "message.error" || event.type === "message.aborted") {
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

  // Load history when active session changes
  createEffect(() => {
    const sid = activeSessionId()
    if (sid && sessions().length > 0) loadSessionHistory(sid)
  })

  // Load session message history from the gateway
  async function loadSessionHistory(sessionID: string) {
    console.log("[mafw] loadSessionHistory", sessionID)
    try {
      const data = await window.api.mafw.sessions.messages(sessionID, 100) as any
      console.log("[mafw] loadSessionHistory result:", data?.data?.length ? `${data.data.length} messages` : 'no data')
      if (!data?.data) return
      const msgs: any[] = []
      const parts: Record<string, any[]> = {}
      for (const item of data.data) {
        const msg = { id: item.id, sessionID, role: item.role || "assistant", parentID: item.parentID || null, time: item.time || { created: Date.now() } }
        msgs.push(msg)
        if (item.parts) {
          parts[item.id] = item.parts.map((p: any) => ({ ...p, id: p.id || `p-${Date.now()}-${Math.random()}`, messageID: item.id }))
        }
      }
      if (msgs.length > 0) {
        setStore(prev => ({
          ...prev,
          message: { ...prev.message, [sessionID]: msgs },
          part: { ...prev.part, ...parts },
        }))
        // Set userMsgId to the first user message
        const userMsg = msgs.find(m => m.role === "user")
        if (userMsg) {
          setSessions(prev => prev.map(s => s.id === sessionID ? { ...s, userMsgId: userMsg.id } : s))
        }
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
      return id
    } catch {
      const id = `local-${Date.now()}`
      setSessions(prev => [...prev, { id, title: `Chat ${sessions().length + 1}`, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false }])
      setActiveSessionId(id)
      return id
    }
  }

  function closeSession(id: string) {
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeSessionId() === id) {
      const remaining = sessions().filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
  }

  async function sendMessage() {
    const text = input()
    if (!text.trim() || sending()) return
    let sid = activeSessionId()
    if (!sid) { sid = await createSession(); if (!sid) return }

    setSending(true)
    setInput("")

    const activeSess = sessions().find(s => s.id === sid)
    const userMsgId = activeSess?.userMsgId || `user-${Date.now()}`

    // Add user message to store
    setStore(prev => {
      const msgs = { ...prev.message }
      const sessionMsgs = [...(msgs[sid] || [])]
      sessionMsgs.push({ id: userMsgId, sessionID: sid, role: "user", parentID: null, time: { created: Date.now() }, text })
      msgs[sid] = sessionMsgs
      return { ...prev, message: msgs }
    })

    console.log("[mafw] sendMessage", sid)
    try {
      const result = await window.api.mafw.chat.sendEnriched(text) as any
      console.log("[mafw] sendEnriched result:", result?.sessionID ? `session ${result.sessionID}` : 'no sessionID')
    } catch (err: any) {
      console.log("[mafw] sendEnriched error:", err.message)
      setSending(false)
      showToastV2({ description: "Failed to send message", duration: 5000 })
    }
  }

  // Current rendering state for SessionTurn
  const currentSessionID = () => active()?.id || ""
  const currentUserMsgId = () => active()?.userMsgId || ""
  const storeData = () => store()

  // Gateway status
  onMount(async () => {
    const info = await window.api.mafw.gateway.info()
    setGwStatus(info)
    const unsub = window.api.mafw.gateway.onStateChange(s => setGwStatus(s))
    onCleanup(unsub)
  })

  return (
    <div class="mafw-shell">
      <ToastV2.Region />
      <div class="mafw-titlebar">
        <Icon name="logo" size="small" />
        <span style={{ "font-size": 12, "font-weight": 500, color: "var(--text-strong)" }}>MAFW</span>
        <div class="mafw-status-dot" classList={{
          ready: gwStatus()?.state === "ready",
          starting: gwStatus()?.state === "starting",
          failed: gwStatus()?.state === "failed",
          stopped: !gwStatus() || gwStatus()?.state === "stopped",
        }} style={{ "margin-left": 4 }} />
        {showConfig() && (
          <ButtonV2 variant="ghost" size="small" onClick={() => setShowConfig(false)} style={{ "margin-left": "auto" }}>← Back to tabs</ButtonV2>
        )}
      </div>
      <div class="mafw-body">
        <Rail activeSessionId={activeSessionId()} onSelectSession={(id) => { setActiveTab("chat"); setActiveSessionId(id) }} onSettings={() => setShowConfig(true)} />
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
                    <div class="mafw-session-tab" classList={{ active: s.id === activeSessionId() }} onClick={() => setActiveSessionId(s.id)}>
                      <span class="mafw-session-title">{s.title}</span>
                      <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={e => { e.stopPropagation(); closeSession(s.id) }}>✕</ButtonV2>
                    </div>
                  ))}
                  <ButtonV2 variant="ghost" size="small" class="mafw-session-new" onClick={createSession}>+</ButtonV2>
                </div>
                {/* SessionTurn */}
                <div class="mafw-session-turn-container">
                  {active() ? (
                    <DataProvider data={storeData()} directory=".">
                      <FileComponentProvider component={FileSSR}>
                        <DialogProvider>
                          <SessionTurn sessionID={currentSessionID()} messageID={currentUserMsgId()} />
                        </DialogProvider>
                      </FileComponentProvider>
                    </DataProvider>
                  ) : (
                    <div class="mafw-chat-empty">Create a new session to start chatting</div>
                  )}
                </div>
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
                  <ButtonV2 variant="contrast" size="small" onClick={sendMessage} disabled={sending() || !input().trim()}>Send</ButtonV2>
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
  )
}
