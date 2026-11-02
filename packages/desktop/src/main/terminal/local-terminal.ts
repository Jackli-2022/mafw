// Local terminal adapter: neutral gateway terminal surface (mafw-terminal/1).
//
// 迁移（Task 11）：桌面不再发现/拼接 runtime 原生 PTY——能力来自 Experience
// `terminal.attach`，会话生命周期走 `/api/terminal/sessions`，连接走
// `/api/terminal/sessions/:id/connect-ticket` + MAFW 帧。原生 `/api/pty`、
// `persistentPty`、`x-opencode-ticket` 一律不再出现。
import { dirKey } from "./terminal-core"
import {
  MAFW_TERMINAL_PROTOCOL,
  decodeTerminalFrame,
  encodeTerminalFrame,
} from "./terminal-protocol"
import type { TerminalEvent } from "../../shared/terminal-session"

export type LocalTerminalProbe = { available: boolean; reason?: string }
export type LocalTerminalAttachResult =
  | { ok: true; terminalId: string; replayed: boolean }
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
  terminalId: string
  ws: any
  buffer: string
  lastSize: string
  subscribers: Map<unknown, LocalTerminalSubscriber>
  disconnected: boolean
}

interface TerminalRow {
  id: string
  status?: string
  title?: string
}

const MAX_BUFFER_CHARS = 200_000

function appendBuffer(session: Session, data: string): void {
  session.buffer += data
  if (session.buffer.length <= MAX_BUFFER_CHARS) return
  const cut = session.buffer.length - MAX_BUFFER_CHARS
  const nl = session.buffer.indexOf("\n", cut)
  session.buffer = session.buffer.slice(nl >= 0 && nl - cut < 2000 ? nl + 1 : cut)
}

function query(dir: string): string {
  return `?directory=${encodeURIComponent(dir)}`
}

function wsBase(base: string): string {
  return base.replace(/\/+$/, "").replace(/^http/, "ws")
}

/** 中性 close 码 → 用户可读原因（不暴露 runtime 名/native 细节）。 */
function closeReason(code: number | undefined, reason: string | undefined): string {
  if (reason && reason.trim()) return reason
  switch (code) {
    case 4400: return "终端协议错误"
    case 4401: return "终端连接票据已失效"
    case 4502: return "终端上游不可用"
    case 4503: return "当前 runtime 不支持内嵌终端"
    default: return "终端已断开"
  }
}

/** 从中性会话快照取「活动终端」：最后一个 running（列表为创建序）。 */
function pickActiveTerminal(rows: TerminalRow[]): TerminalRow | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row && row.status === "running" && typeof row.id === "string") return row
  }
  return null
}

export function createLocalTerminalOps(deps: LocalTerminalDeps): LocalTerminalOps {
  const f = deps.fetchImpl ?? (globalThis.fetch as typeof fetch)
  const wsFactory = deps.wsFactory ?? ((url: string) => new WebSocket(url))
  const log = deps.log ?? (() => {})
  const sessions = new Map<string, Session>()
  const lastTerminalByDir = new Map<string, string>()

  /** Experience 动作面：能力来源（不再读 `/api/info` 的 persistentPty）。 */
  async function terminalAction(): Promise<{ supported: boolean; reason?: string }> {
    const res = await f(`${deps.gatewayBase()}/api/experience/actions`)
    if (!res.ok) {
      return {
        supported: false,
        reason: res.status === 404 ? "当前 gateway 不支持终端契约，请升级 gateway" : `gateway ${res.status}`,
      }
    }
    const json: any = await res.json().catch(() => null)
    const action = json?.actions?.["terminal.attach"]
    if (!action) return { supported: false, reason: "当前 gateway 未提供终端契约，请升级 gateway" }
    if (action.supported !== true) return { supported: false, reason: "当前 runtime 不支持内嵌终端" }
    return { supported: true }
  }

  async function listTerminals(directory: string): Promise<{ supported: boolean; rows: TerminalRow[] }> {
    const res = await f(`${deps.gatewayBase()}/api/terminal/sessions${query(directory)}`)
    if (res.status === 404) return { supported: false, rows: [] }
    if (!res.ok) throw new Error(`terminal list ${res.status}`)
    const json: any = await res.json().catch(() => null)
    if (json?.protocol !== MAFW_TERMINAL_PROTOCOL) return { supported: false, rows: [] }
    if (json?.supported !== true) return { supported: false, rows: [] }
    const rows = Array.isArray(json.sessions) ? json.sessions : []
    return { supported: true, rows: rows.filter((row: any) => row && typeof row.id === "string") }
  }

  async function createTerminal(directory: string): Promise<string | null> {
    const res = await f(`${deps.gatewayBase()}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory, cwd: directory, cols: 120, rows: 30, title: "MAFW" }),
    })
    if (!res.ok) return null
    const json: any = await res.json().catch(() => null)
    if (json?.protocol !== MAFW_TERMINAL_PROTOCOL) return null
    return typeof json?.id === "string" && json.id ? json.id : null
  }

  async function ticketFor(
    terminalId: string,
    directory: string,
  ): Promise<{ ok: true; url: string } | { ok: false; status: number }> {
    const res = await f(
      `${deps.gatewayBase()}/api/terminal/sessions/${encodeURIComponent(terminalId)}/connect-ticket`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory }),
      },
    )
    if (!res.ok) return { ok: false, status: res.status }
    const json: any = await res.json().catch(() => null)
    if (json?.protocol !== MAFW_TERMINAL_PROTOCOL || typeof json?.url !== "string" || !json.url) {
      return { ok: false, status: res.status }
    }
    return { ok: true, url: json.url }
  }

  function fanout(session: Session, ev: TerminalEvent): void {
    for (const sub of session.subscribers.values()) {
      try { sub(ev) } catch { /* subscriber failure must not break others */ }
    }
  }

  /** 一次性收口：无论 close 帧 / ws close / 协议错误，只发一次 disconnected。 */
  function disconnect(session: Session, error: string, closeSocket = true): void {
    if (session.disconnected) return
    session.disconnected = true
    if (sessions.get(dirKey(session.directory)) === session) sessions.delete(dirKey(session.directory))
    if (closeSocket) {
      try { session.ws?.close?.() } catch { /* already closed */ }
    }
    fanout(session, { type: "status", sessionId: session.sessionId, status: "disconnected", error })
  }

  function onMessage(session: Session, raw: any): void {
    const frame = decodeTerminalFrame(raw)
    if (!frame) {
      // 非法帧绝不当输出；按契约关闭。
      disconnect(session, "终端协议错误")
      return
    }
    switch (frame.type) {
      case "output":
        appendBuffer(session, frame.data)
        fanout(session, { type: "data", sessionId: session.sessionId, data: frame.data })
        return
      case "meta":
        return
      case "close":
        disconnect(session, closeReason(frame.code, frame.reason))
        return
      default:
        // input/resize 是客户端 → 服务端帧；收到即非法。
        disconnect(session, "终端协议错误")
    }
  }

  function openSession(
    directory: string,
    sessionId: string,
    terminalId: string,
    wsUrl: string,
    subscriber: LocalTerminalSubscriber,
    key: unknown,
  ): Session {
    const ws = wsFactory(wsUrl)
    const session: Session = {
      directory,
      sessionId,
      terminalId,
      ws,
      buffer: "",
      lastSize: "",
      subscribers: new Map([[key, subscriber]]),
      disconnected: false,
    }
    sessions.set(dirKey(directory), session)
    try { ws.binaryType = "arraybuffer" } catch { /* fake ws */ }
    ws.onmessage = (ev: any) => onMessage(session, ev?.data)
    ws.onclose = (ev: any) => {
      const reason = typeof ev?.reason === "string" ? ev.reason : undefined
      disconnect(session, closeReason(typeof ev?.code === "number" ? ev.code : undefined, reason), false)
    }
    ws.onerror = (err: any) => { log(`terminal ws error (${directory}): ${err?.message ?? "error"}`) }
    fanout(session, { type: "status", sessionId, status: "connected", connectedAt: Date.now() })
    return session
  }

  return {
    async probe(): Promise<LocalTerminalProbe> {
      try {
        const action = await terminalAction()
        if (!action.supported) return { available: false, reason: action.reason ?? "当前 runtime 不支持内嵌终端" }
        return { available: true }
      } catch (e: any) {
        return { available: false, reason: `gateway 不可达：${e?.message ?? e}` }
      }
    },

    async attach(directory, sessionId, subscriber, key, opts = {}) {
      const dk = dirKey(directory)
      const existing = sessions.get(dk)
      if (existing && existing.ws?.readyState === 1 && !existing.disconnected) {
        existing.sessionId = sessionId
        existing.subscribers.set(key, subscriber)
        if (existing.buffer) subscriber({ type: "data", sessionId, data: existing.buffer })
        return { ok: true, terminalId: existing.terminalId, replayed: existing.buffer.length > 0 }
      }
      if (existing) {
        try { existing.ws?.close?.() } catch { /* stale */ }
        sessions.delete(dk)
      }

      let listed: { supported: boolean; rows: TerminalRow[] }
      try {
        listed = await listTerminals(directory)
      } catch {
        return { ok: false, reason: "unavailable" }
      }
      if (!listed.supported) return { ok: false, reason: "unavailable" }

      let terminal = pickActiveTerminal(listed.rows)
      let created = false
      if (!terminal) {
        if (lastTerminalByDir.has(dk) && !opts.reopen) return { ok: false, reason: "gone" }
        const id = await createTerminal(directory)
        if (!id) return { ok: false, reason: "closed" }
        terminal = { id, status: "running" }
        created = true
      }

      let ticket = await ticketFor(terminal.id, directory)
      if (!ticket.ok && opts.reopen && !created) {
        const id = await createTerminal(directory)
        if (!id) return { ok: false, reason: "closed" }
        terminal = { id, status: "running" }
        created = true
        ticket = await ticketFor(terminal.id, directory)
      }
      if (!ticket.ok) {
        return { ok: false, reason: ticket.status === 404 || ticket.status === 400 || ticket.status === 503 ? "gone" : "unavailable" }
      }

      const base = wsBase(deps.gatewayBase())
      const url = ticket.url.startsWith("/") ? ticket.url : `/${ticket.url}`
      openSession(directory, sessionId, terminal.id, `${base}${url}`, subscriber, key)
      lastTerminalByDir.set(dk, terminal.id)
      return { ok: true, terminalId: terminal.id, replayed: false }
    },

    detach(directory, key) {
      sessions.get(dirKey(directory))?.subscribers.delete(key)
    },

    input(directory, data) {
      const s = sessions.get(dirKey(directory))
      if (!s || s.disconnected || s.ws?.readyState !== 1) return
      s.ws.send(encodeTerminalFrame({ v: 1, type: "input", data }))
    },

    async resize(directory, cols, rows) {
      const s = sessions.get(dirKey(directory))
      if (!s || s.disconnected || s.ws?.readyState !== 1) return
      const size = `${cols}x${rows}`
      if (s.lastSize === size) return
      s.lastSize = size
      try {
        s.ws.send(encodeTerminalFrame({ v: 1, type: "resize", cols, rows }))
      } catch {
        // resize 失败不终止会话（与既有语义一致）
      }
    },

    async kill(directory) {
      const key = dirKey(directory)
      const s = sessions.get(key)
      lastTerminalByDir.delete(key)
      if (!s) return
      sessions.delete(key)
      try { s.ws?.close?.() } catch { /* already closed */ }
      const res = await f(
        `${deps.gatewayBase()}/api/terminal/sessions/${encodeURIComponent(s.terminalId)}${query(directory)}`,
        { method: "DELETE" },
      )
      if (!res.ok && res.status !== 404) log(`terminal kill ${res.status}`)
    },
  }
}
