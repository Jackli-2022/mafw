// Local terminal adapter: serve persistent PTY, directory-keyed, sessionId-tagged.
// Extracted from terminal-bridge so the unified hub can mix local + SSH sessions.
import { unwrapData, pickActivePty, isMetaFrame, parseMetaFrame, encodeInput, dirKey } from "./terminal-core"
import type { TerminalEvent } from "../../shared/terminal-session"

export type LocalTerminalProbe = { available: boolean; serveUrl?: string; reason?: string }
export type LocalTerminalAttachResult =
  | { ok: true; ptyId: string; replayed: boolean }
  | { ok: false; reason: "gone" | "unavailable" | "closed" }

export type LocalTerminalSubscriber = (ev: TerminalEvent) => void

export type LocalTerminalOps = {
  probe(): Promise<LocalTerminalProbe>
  attach(
    directory: string,
    sessionId: string,
    sub: LocalTerminalSubscriber,
    key: unknown,
    opts?: { reopen?: boolean },
  ): Promise<LocalTerminalAttachResult>
  detach(directory: string, key: unknown): void
  input(directory: string, data: string): void
  resize(directory: string, cols: number, rows: number): Promise<void>
  kill(directory: string): Promise<void>
}

export interface LocalTerminalDeps {
  gatewayBase: () => string
  fetchImpl?: typeof fetch
  wsFactory?: (url: string) => any
  log?: (msg: string) => void
}

interface Session {
  directory: string
  sessionId: string
  ptyId: string
  ws: any
  cursor: number
  buffer: string
  subscribers: Map<unknown, LocalTerminalSubscriber>
}

const MAX_BUFFER_CHARS = 200_000
const q = (dir: string) => `?directory=${encodeURIComponent(dir)}`

function appendBuffer(session: Session, data: string): void {
  session.buffer += data
  if (session.buffer.length <= MAX_BUFFER_CHARS) return
  const cut = session.buffer.length - MAX_BUFFER_CHARS
  const nl = session.buffer.indexOf("\n", cut)
  session.buffer = session.buffer.slice(nl >= 0 && nl - cut < 2000 ? nl + 1 : cut)
}

export function createLocalTerminalOps(deps: LocalTerminalDeps): LocalTerminalOps {
  const f = deps.fetchImpl ?? (globalThis.fetch as typeof fetch)
  const wsFactory = deps.wsFactory ?? ((url: string) => new WebSocket(url))
  const log = deps.log ?? (() => {})
  const sessions = new Map<string, Session>()
  const lastPtyByDir = new Map<string, string>()

  async function info(): Promise<{ url?: string; persistentPty: boolean }> {
    const res = await f(`${deps.gatewayBase()}/api/info`)
    if (!res.ok) return { persistentPty: false }
    const json: any = await res.json().catch(() => ({}))
    return { url: json?.urls?.[0], persistentPty: json?.capabilities?.persistentPty === true }
  }

  async function tokenFor(ptyId: string, directory: string): Promise<string | null> {
    const res = await f(`${deps.gatewayBase()}/api/pty/${encodeURIComponent(ptyId)}/connect-token${q(directory)}`, {
      method: "POST",
      headers: { "x-opencode-ticket": "1" },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`connect-token ${res.status}`)
    const json: any = await res.json().catch(() => ({}))
    return unwrapData(json)?.ticket ?? null
  }

  async function createPty(directory: string): Promise<{ id: string } | null> {
    const res = await f(`${deps.gatewayBase()}/api/pty${q(directory)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: directory, title: "MAFW", size: { cols: 120, rows: 30 } }),
    })
    if (!res.ok) return null
    const pty = unwrapData(await res.json().catch(() => null))
    return pty?.id ? pty : null
  }

  function fanout(session: Session, ev: TerminalEvent): void {
    for (const sub of session.subscribers.values()) {
      try { sub(ev) } catch { /* subscriber failure must not break others */ }
    }
  }

  function onMessage(session: Session, data: any): void {
    if (typeof data === "string") {
      appendBuffer(session, data)
      fanout(session, { type: "data", sessionId: session.sessionId, data })
      return
    }
    const handleBuffer = (buf: ArrayBuffer) => {
      // 0x00-prefixed frames are meta even when JSON is invalid; never show them.
      if (isMetaFrame(buf)) {
        parseMetaFrame(buf)
        return
      }
      const text = new TextDecoder().decode(buf)
      appendBuffer(session, text)
      fanout(session, { type: "data", sessionId: session.sessionId, data: text })
    }
    if (data instanceof ArrayBuffer) return handleBuffer(data)
    if (ArrayBuffer.isView(data)) {
      return handleBuffer((data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength))
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      void data.arrayBuffer().then(handleBuffer).catch(() => {})
    }
  }

  function openSession(
    directory: string,
    sessionId: string,
    ptyId: string,
    wsUrl: string,
    subscriber: LocalTerminalSubscriber,
    key: unknown,
  ): Session {
    const ws = wsFactory(wsUrl)
    const session: Session = {
      directory,
      sessionId,
      ptyId,
      ws,
      cursor: 0,
      buffer: "",
      subscribers: new Map([[key, subscriber]]),
    }
    sessions.set(dirKey(directory), session)
    try { ws.binaryType = "arraybuffer" } catch { /* fake ws */ }
    ws.onmessage = (ev: any) => onMessage(session, ev?.data)
    ws.onclose = (ev: any) => {
      if (sessions.get(dirKey(directory)) === session) sessions.delete(dirKey(directory))
      const gone = ev?.code === 4404
      fanout(session, {
        type: "status",
        sessionId,
        status: "disconnected",
        ...(gone ? { error: "终端已随服务重启关闭" } : { error: "终端已断开" }),
      })
    }
    ws.onerror = (err: any) => { log(`terminal ws error (${directory}): ${err?.message ?? "error"}`) }
    fanout(session, { type: "status", sessionId, status: "connected", connectedAt: Date.now() })
    return session
  }

  return {
    async probe(): Promise<LocalTerminalProbe> {
      try {
        const i = await info()
        if (!i.persistentPty) return { available: false, reason: "当前 runtime/serve 不支持 persistent PTY" }
        if (!i.url) return { available: false, reason: "serve 地址不可用" }
        return { available: true, serveUrl: i.url }
      } catch (e: any) {
        return { available: false, reason: `gateway 不可达：${e?.message ?? e}` }
      }
    },

    async attach(directory, sessionId, subscriber, key, opts = {}) {
      const dk = dirKey(directory)
      const existing = sessions.get(dk)
      if (existing && existing.ws?.readyState === 1) {
        existing.sessionId = sessionId
        existing.subscribers.set(key, subscriber)
        if (existing.buffer) subscriber({ type: "data", sessionId, data: existing.buffer })
        return { ok: true, ptyId: existing.ptyId, replayed: existing.buffer.length > 0 }
      }
      if (existing) {
        try { existing.ws?.close?.() } catch { /* stale */ }
        sessions.delete(dk)
      }

      const i = await info()
      if (!i.persistentPty || !i.url) return { ok: false, reason: "unavailable" }

      const listRes = await f(`${deps.gatewayBase()}/api/pty${q(directory)}`)
      let list: any[] = []
      if (listRes.ok) {
        const raw = unwrapData(await listRes.json().catch(() => []))
        list = Array.isArray(raw) ? raw : []
      }
      let pty = pickActivePty(list)
      let created = false

      if (!pty) {
        if (lastPtyByDir.has(dk) && !opts.reopen) return { ok: false, reason: "gone" }
        const made = await createPty(directory)
        if (!made) return { ok: false, reason: "closed" }
        pty = made
        created = true
      }

      let ticket = await tokenFor(pty.id, directory)
      if (!ticket && opts.reopen && !created) {
        const made = await createPty(directory)
        if (!made) return { ok: false, reason: "closed" }
        pty = made
        ticket = await tokenFor(pty.id, directory)
      }
      if (!ticket) return { ok: false, reason: "gone" }

      const wsUrl = i.url.replace(/^http/, "ws") + `/api/pty/${encodeURIComponent(pty.id)}/connect?ticket=${encodeURIComponent(ticket)}`
      openSession(directory, sessionId, pty.id, wsUrl, subscriber, key)
      lastPtyByDir.set(dk, pty.id)
      return { ok: true, ptyId: pty.id, replayed: false }
    },

    detach(directory, key) {
      sessions.get(dirKey(directory))?.subscribers.delete(key)
    },

    input(directory, data) {
      const s = sessions.get(dirKey(directory))
      if (!s || s.ws?.readyState !== 1) return
      s.ws.send(encodeInput(data))
    },

    async resize(directory, cols, rows) {
      const s = sessions.get(dirKey(directory))
      if (!s) return
      const res = await f(`${deps.gatewayBase()}/api/pty/${encodeURIComponent(s.ptyId)}${q(directory)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: { cols, rows } }),
      })
      if (!res.ok) log(`terminal resize ${res.status}`)
    },

    async kill(directory) {
      const key = dirKey(directory)
      const s = sessions.get(key)
      lastPtyByDir.delete(key)
      if (!s) return
      sessions.delete(key)
      try { s.ws?.close?.() } catch { /* already closed */ }
      const res = await f(`${deps.gatewayBase()}/api/pty/${encodeURIComponent(s.ptyId)}${q(directory)}`, { method: "DELETE" })
      if (!res.ok && res.status !== 404) log(`terminal kill ${res.status}`)
    },
  }
}
