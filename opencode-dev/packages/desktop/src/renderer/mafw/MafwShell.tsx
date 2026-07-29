// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup } from "solid-js"
import { MemoryRouter } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ToastV2, showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
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
    if (sid) loadSessionHistory(sid)
  })

  // Load session message history from the gateway
  async function loadSessionHistory(sessionID: string) {
    console.log("[mafw] loadSessionHistory", sessionID)
    try {
      const [data, sessionData] = await Promise.all([
        window.api.mafw.sessions.messages(sessionID, 100) as any,
        window.api.mafw.sessions.get(sessionID).catch(() => null),
      ]) as [any, any]
      const rawItems = Array.isArray(data) ? data : data?.data
      console.log("[mafw] loadSessionHistory result:", rawItems?.length ? `${rawItems.length} messages` : 'no data')
      if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) return
      const msgs: any[] = []
      const parts: Record<string, any[]> = {}
      for (const item of rawItems) {
        const info = item.info || item
        const msgId = info.id || `msg-${Date.now()}-${Math.random()}`
        const textContent = info.text || info.textContent || ""
        const msg = { id: msgId, sessionID, role: info.role || "assistant", parentID: info.parentID || null, time: info.time || { created: Date.now() }, text: textContent }
        msgs.push(msg)
        let itemParts = item.parts || info.parts || []
        // Convert message.text to a text part if not already present
        if (textContent && !itemParts.some((p: any) => p.type === "text" && p.text === textContent)) {
          itemParts = [{ type: "text", text: textContent, id: `${msgId}-text`, messageID: msgId }, ...itemParts]
        }
        if (itemParts.length > 0) {
          parts[msgId] = itemParts.map((p: any) => ({ ...p, id: p.id || `p-${Date.now()}-${Math.random()}`, messageID: msgId }))
        }
      }
      if (msgs.length > 0) {
        // Debug: print the first message raw format
        const firstUser = msgs.find(m => m.role === "user")
        if (firstUser) {
          const firstParts = parts[firstUser.id] || []
          const firstTextPart = firstParts.find((p: any) => p.type === "text")
          console.log("[mafw] first user id:", firstUser.id, "parts count:", firstParts.length, "textPart text:", firstTextPart?.text?.slice(0, 80))

          // Also check what keys the raw API item has for user messages
          const rawFirst = rawItems.find((r: any) => (r.info || r).id === firstUser.id)
          if (rawFirst) {
            const rawInfo = rawFirst.info || rawFirst
            const keys = Object.keys(rawInfo)
            console.log("[mafw] raw user keys:", keys.join(","), "hasText:", !!rawInfo.text, "hasContent:", !!rawInfo.textContent, "partsLen:", rawInfo.parts?.length, rawFirst.parts?.length)
          }
        }

        // Group messages into turns: [user msg, ...assistant msgs] pairs
        const turns: { user: any; assistants: any[]; parts: any[] }[] = []
        let currentTurn: { user: any; assistants: any[]; parts: any[] } | null = null
        for (const m of msgs) {
          if (m.role === "user") {
            currentTurn = { user: m, assistants: [], parts: parts[m.id] || [] }
            turns.push(currentTurn)
          } else if (currentTurn && m.role === "assistant") {
            currentTurn.assistants.push(m)
          }
        }
        console.log("[mafw] turns built:", turns.length, "first user text:", turns[0]?.user?.text?.slice(0, 50))

        msgs.sort((a, b) => a.id.localeCompare(b.id))
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
        // Verify store after update
        setTimeout(() => {
          const st = store()
          const msgCount = st.message[sessionID]?.length || 0
          const partKeys = Object.keys(st.part).length
          console.log("[mafw] store verify - msgs:", msgCount, "partKeys:", partKeys, "sid:", sessionID, "sidExists:", !!st.message[sessionID])
        }, 100)
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

  // Current rendering state for SessionTurn
  const currentSessionID = () => active()?.id || ""
  const currentUserMsgId = () => {
    const stored = active()?.userMsgId
    if (stored) return stored
    // Fallback: find first user message in store
    const sid = currentSessionID()
    if (sid) {
      const msgs = store().message[sid]
      if (msgs) {
        const userMsg = msgs.find(m => m.role === "user")
        if (userMsg) return userMsg.id
      }
    }
    return ""
  }
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
        <Rail activeSessionId={activeSessionId()} onSelectSession={(id) => {
          setActiveTab("chat")
          // Ensure session exists in local tabs and store
          if (!sessions().find(s => s.id === id)) {
            setSessions(prev => [...prev, { id, title: `Chat ${prev.length + 1}`, userMsgId: `user-${Date.now()}`, assistantMsgId: null, done: false }])
            setStore(prev => ({
              ...prev,
              session: [...prev.session, { id, title: `Chat ${prev.session.length + 1}`, directory: ".", time: { created: Date.now() }, projectID: "." }],
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
                    <>
                      <DataProvider data={storeData()} directory=".">
                        <FileComponentProvider component={FileSSR}>
                          <DialogProvider>
                            <MarkedProvider>
                            <MemoryRouter>
                              <SessionTurn sessionID={currentSessionID()} messageID={currentUserMsgId()} />
                            </MemoryRouter>
                          </MarkedProvider>
                          </DialogProvider>
                        </FileComponentProvider>
                      </DataProvider>
                      <pre style="color: var(--text-base); font-size: 11px; padding: 8px; border-top: 1px solid #333; max-height: 200px; overflow: auto; background: var(--surface-base); white-space: pre-wrap;">
                        {`mid: ${currentUserMsgId() || '(empty)'}
msgs count: ${store().message?.[currentSessionID()]?.length || 0}
session active: ${!!active()}`}
                      </pre>
                      {/* Raw message fallback: render first 3 turns directly */}
                      <div style="color: var(--text-base); font-size: 12px; padding: 4px 8px; border-top: 1px solid #555; max-height: 400px; overflow: auto; background: var(--surface-base);">
                        {store().session_status?.[currentSessionID()]?.type === "idle" ? "status:idle" : "status:?"}
                        {(() => {
                          const sid = currentSessionID()
                          const msgs = store().message?.[sid]
                          if (!msgs) return <div>No messages in store</div>
                          return msgs.filter((m: any) => m.role === "user").slice(0, 3).map((m: any) => {
                            const p = store().part?.[m.id]
                            const text = p?.find((x: any) => x.type === "text")
                            return <div style="padding: 4px 0; border-bottom: 1px dotted #333;">
                              <b>[{m.role}]</b> {text?.text?.slice(0, 100) || "(no text part)"} <span style="opacity:0.4">parts:{p?.length || 0}</span>
                            </div>
                          })
                        })()}
                      </div>
                    </>
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
