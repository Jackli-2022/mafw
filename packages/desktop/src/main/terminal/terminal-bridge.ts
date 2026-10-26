// terminal-bridge：main 进程的终端桥（IPC + HTTP + WS）。
// 纯逻辑在 terminal-core / shared；本文件负责网络与 Electron 接线，deps 注入以便
// 无 Electron 单测（fetchImpl / wsFactory 假体）。
//
// 链路（spec §4）：HTTP 全部经 gateway :3000 兜底反代（已注入 serve Basic）；
// WS 直连 serve（ticket 一次性、60s TTL，每次 attach 现取现用）。
// 每目录一条 WS（多窗口 fanout 订阅者）——规避 serve 多挂同一 PTY 的未知仲裁。
//
// 终审修复（2026-10-26）：
// - ring buffer：新订阅者/重挂载收到 scrollback replay（否则 reset 后空屏）；
// - 订阅者按 key（窗口 id）替换而非追加（否则输出 2×/N×）；
// - attach 返回结构化结果；PTY 消失（serve 重启/exit）= gone，reopen 才重建；
// - WS close 4404 = terminal gone（serve 语义），其余 close = closed。
import { unwrapData, pickActivePty, parseMetaFrame, encodeInput, dirKey, isMetaFrame } from "./terminal-core"

export type TerminalEvent = { directory: string; type: "data" | "closed" | "gone"; data?: string }
export type TerminalSubscriber = (ev: TerminalEvent) => void

export type TerminalAttachResult =
  | { ok: true; ptyId: string; replayed: boolean }
  | { ok: false; reason: "gone" | "unavailable" | "closed" }

export interface TerminalBridgeDeps {
  gatewayBase: () => string
  fetchImpl?: typeof fetch
  wsFactory?: (url: string) => any
  log?: (msg: string) => void
}

interface Session {
  directory: string
  ptyId: string
  ws: any
  cursor: number
  buffer: string
  subscribers: Map<unknown, TerminalSubscriber>
}

export type TerminalProbe = { available: boolean; serveUrl?: string; reason?: string }

export interface TerminalOps {
  probe(): Promise<TerminalProbe>
  attach(directory: string, subscriber: TerminalSubscriber, opts?: { key?: unknown; reopen?: boolean }): Promise<TerminalAttachResult>
  detach(directory: string, key: unknown): void
  input(directory: string, data: string): void
  resize(directory: string, cols: number, rows: number): Promise<void>
  kill(directory: string): Promise<void>
}

const MAX_BUFFER_CHARS = 200_000
const q = (dir: string) => `?directory=${encodeURIComponent(dir)}`

/** 有界 scrollback 缓冲：超限时从整行边界裁剪，避免截断 ANSI 序列。 */
function appendBuffer(session: Session, data: string): void {
  session.buffer += data
  if (session.buffer.length <= MAX_BUFFER_CHARS) return
  const cut = session.buffer.length - MAX_BUFFER_CHARS
  const nl = session.buffer.indexOf("\n", cut)
  session.buffer = session.buffer.slice(nl >= 0 && nl - cut < 2000 ? nl + 1 : cut)
}

export function createTerminalOps(deps: TerminalBridgeDeps): TerminalOps {
  const f = deps.fetchImpl ?? (globalThis.fetch as typeof fetch)
  const wsFactory = deps.wsFactory ?? ((url: string) => new WebSocket(url))
  const log = deps.log ?? (() => {})
  const sessions = new Map<string, Session>()
  /** 本 main 进程见过的每个目录最后一个 PTY id：list 空 + 该 id 存在 = PTY 已消失。 */
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
      // serve 的 connect-token 要求该头（防跨站铸票，2026-10-22 wire probe §1）
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
      // 不传 command：让 serve 用默认 shell；cwd 必须显式（缺省会落 C:\）
      body: JSON.stringify({ cwd: directory, title: "MAFW", size: { cols: 120, rows: 30 } }),
    })
    if (!res.ok) return null
    const pty = unwrapData(await res.json().catch(() => null))
    return pty?.id ? pty : null
  }

  function fanout(session: Session, ev: TerminalEvent): void {
    for (const sub of session.subscribers.values()) {
      try { sub(ev) } catch { /* subscriber 挂了不影响其他 */ }
    }
  }

  function onMessage(session: Session, data: any): void {
    if (typeof data === "string") {
      appendBuffer(session, data)
      fanout(session, { directory: session.directory, type: "data", data })
      return
    }
    const handleBuffer = (buf: ArrayBuffer) => {
      if (isMetaFrame(buf)) {
        // 0x00 前缀一律消费（含非法 JSON）：meta 永不进终端
        const meta = parseMetaFrame(buf)
        if (meta) session.cursor = meta.cursor
        return
      }
      const text = new TextDecoder().decode(buf)
      appendBuffer(session, text)
      fanout(session, { directory: session.directory, type: "data", data: text })
    }
    if (data instanceof ArrayBuffer) return handleBuffer(data)
    // 视图必须按 byteOffset/byteLength 切片，不能直接取 .buffer
    if (ArrayBuffer.isView(data)) return handleBuffer((data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength))
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      void data.arrayBuffer().then(handleBuffer).catch(() => {})
    }
  }

  function openSession(directory: string, ptyId: string, wsUrl: string, subscriber: TerminalSubscriber, key: unknown): Session {
    const ws = wsFactory(wsUrl)
    const session: Session = { directory, ptyId, ws, cursor: 0, buffer: "", subscribers: new Map([[key, subscriber]]) }
    sessions.set(dirKey(directory), session)
    try { ws.binaryType = "arraybuffer" } catch { /* fake ws */ }
    ws.onmessage = (ev: any) => onMessage(session, ev?.data)
    const close = (ev: any) => {
      if (sessions.get(dirKey(directory)) === session) sessions.delete(dirKey(directory))
      // 4404 = serve 侧 terminal 不存在（重启/进程退出）；1006 等 = 普通断开
      fanout(session, { directory, type: ev?.code === 4404 ? "gone" : "closed" })
    }
    ws.onclose = close
    ws.onerror = (err: any) => { log(`terminal ws error (${directory}): ${err?.message ?? "error"}`) }
    return session
  }

  return {
    async probe(): Promise<TerminalProbe> {
      try {
        const i = await info()
        if (!i.persistentPty) return { available: false, reason: "当前 runtime/serve 不支持 persistent PTY" }
        if (!i.url) return { available: false, reason: "serve 地址不可用" }
        return { available: true, serveUrl: i.url }
      } catch (e: any) {
        return { available: false, reason: `gateway 不可达：${e?.message ?? e}` }
      }
    },

    async attach(directory, subscriber, opts = {}) {
      const key = opts.key ?? subscriber
      const dk = dirKey(directory)
      const existing = sessions.get(dk)
      if (existing && existing.ws?.readyState === 1) {
        existing.subscribers.set(key, subscriber)
        // 重挂载/renderer reload：重放本进程缓存的 scrollback（否则 reset 后空屏）
        if (existing.buffer) subscriber({ directory, type: "data", data: existing.buffer })
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
        // 本目录曾有 PTY 但 list 已空 → serve 重启或 shell 退出；不得静默重建
        if (lastPtyByDir.has(dk) && !opts.reopen) return { ok: false, reason: "gone" }
        const made = await createPty(directory)
        if (!made) return { ok: false, reason: "closed" }
        pty = made
        created = true
      }

      let ticket = await tokenFor(pty.id, directory)
      if (!ticket && opts.reopen && !created) {
        // 显式重开但旧 PTY 已在 token 交换前消失：建新的再取
        const made = await createPty(directory)
        if (!made) return { ok: false, reason: "closed" }
        pty = made
        ticket = await tokenFor(pty.id, directory)
      }
      if (!ticket) return { ok: false, reason: "gone" }

      const wsUrl = i.url.replace(/^http/, "ws") + `/api/pty/${encodeURIComponent(pty.id)}/connect?ticket=${encodeURIComponent(ticket)}`
      openSession(directory, pty.id, wsUrl, subscriber, key)
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

// ── Electron 接线（薄层；renderer 只经 preload 调用）──────────────────────
export interface TerminalBridgeInstallDeps extends TerminalBridgeDeps {
  openExternal?: (directory: string) => Promise<void>
}

export function installTerminalBridge(ipcMain: any, deps: TerminalBridgeInstallDeps): TerminalOps {
  const ops = createTerminalOps(deps)
  // 每个窗口每目录一个订阅者（key = sender.id）：重挂载替换而非追加，
  // 窗口销毁时释放。PTY 属于目录，不随窗口死。
  const bySender = new Map<number, Map<string, TerminalSubscriber>>()
  // 每个 webContents 只挂一次 destroyed 清理钩（HMR/多目录 attach 不累积监听器）
  const destroyHooked = new Set<number>()

  const subFor = (sender: any, directory: string): TerminalSubscriber => {
    const m = bySender.get(sender.id) ?? new Map<string, TerminalSubscriber>()
    bySender.set(sender.id, m)
    const existing = m.get(directory)
    if (existing) return existing
    const sub: TerminalSubscriber = (ev) => {
      try { if (!sender.isDestroyed?.()) sender.send("mafw-terminal-event", ev) } catch { /* window gone */ }
    }
    m.set(directory, sub)
    if (!destroyHooked.has(sender.id)) {
      destroyHooked.add(sender.id)
      try {
        sender.once?.("destroyed", () => {
          destroyHooked.delete(sender.id)
          const dirs = bySender.get(sender.id)
          bySender.delete(sender.id)
          if (dirs) for (const dir of dirs.keys()) ops.detach(dir, String(sender.id))
        })
      } catch { /* fake sender */ }
    }
    return sub
  }

  ipcMain.handle("mafw-terminal-probe", () => ops.probe())
  ipcMain.handle("mafw-terminal-attach", (event: any, args: { directory: string; reopen?: boolean }) => {
    const sub = subFor(event.sender, args.directory)
    return ops.attach(args.directory, sub, { key: String(event.sender.id), reopen: args.reopen === true })
  })
  ipcMain.handle("mafw-terminal-detach", (event: any, args: { directory: string }) => {
    ops.detach(args.directory, String(event.sender.id))
    bySender.get(event.sender.id)?.delete(args.directory)
  })
  ipcMain.handle("mafw-terminal-input", (_e: any, args: { directory: string; data: string }) => ops.input(args.directory, args.data))
  ipcMain.handle("mafw-terminal-resize", (_e: any, args: { directory: string; cols: number; rows: number }) => ops.resize(args.directory, args.cols, args.rows))
  ipcMain.handle("mafw-terminal-kill", (_e: any, args: { directory: string }) => ops.kill(args.directory))
  ipcMain.handle("mafw-terminal-open-external", (_e: any, args: { directory: string }) => deps.openExternal?.(args.directory))
  return ops
}
