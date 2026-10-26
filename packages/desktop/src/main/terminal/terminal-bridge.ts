// terminal-bridge：main 进程的终端桥（IPC + HTTP + WS）。
// 纯逻辑在 terminal-core；本文件负责网络与 Electron 接线，deps 注入以便无
// Electron 单测（fetchImpl / wsFactory 假体）。
//
// 链路（spec §4）：HTTP 全部经 gateway :3000 兜底反代（已注入 serve Basic）；
// WS 直连 serve（ticket 一次性、60s TTL，每次 attach 现取现用）。
// 每目录一条 WS（多窗口 fanout 订阅者）——规避 serve 多挂同一 PTY 的未知仲裁。
import { unwrapData, pickActivePty, parseMetaFrame, encodeInput } from "./terminal-core"

export type TerminalEvent = { directory: string; type: "data" | "closed" | "gone"; data?: string }
export type TerminalSubscriber = (ev: TerminalEvent) => void

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
  subscribers: Set<TerminalSubscriber>
}

export type TerminalProbe = { available: boolean; serveUrl?: string; reason?: string }
/** IPC 形状（preload/main 约定；renderer 只经 window.api.mafw.terminal.*）。 */
export interface TerminalAttachResult {
  ptyId: string
}

export interface TerminalOps {
  probe(): Promise<TerminalProbe>
  attach(directory: string, subscriber: TerminalSubscriber): Promise<TerminalAttachResult>
  detach(directory: string, subscriber: TerminalSubscriber): void
  input(directory: string, data: string): void
  resize(directory: string, cols: number, rows: number): Promise<void>
  kill(directory: string): Promise<void>
}

const dirKey = (dir: string) => dir.replace(/\\/g, "/").toLowerCase()
const q = (dir: string) => `?directory=${encodeURIComponent(dir)}`

export function createTerminalOps(deps: TerminalBridgeDeps): TerminalOps {
  const f = deps.fetchImpl ?? (globalThis.fetch as typeof fetch)
  const wsFactory = deps.wsFactory ?? ((url: string) => new WebSocket(url))
  const log = deps.log ?? (() => {})
  const sessions = new Map<string, Session>()

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

  function fanout(session: Session, ev: TerminalEvent): void {
    for (const sub of session.subscribers) {
      try { sub(ev) } catch { /* subscriber 挂了不影响其他 */ }
    }
  }

  function onMessage(session: Session, data: any): void {
    if (typeof data === "string") {
      fanout(session, { directory: session.directory, type: "data", data })
      return
    }
    const handleBuffer = (buf: ArrayBuffer) => {
      const meta = parseMetaFrame(buf)
      if (meta) { session.cursor = meta.cursor; return }
      fanout(session, { directory: session.directory, type: "data", data: new TextDecoder().decode(buf) })
    }
    if (data instanceof ArrayBuffer) return handleBuffer(data)
    if (ArrayBuffer.isView(data)) return handleBuffer(data.buffer as ArrayBuffer)
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      void data.arrayBuffer().then(handleBuffer).catch(() => {})
      return
    }
    // 未知形态丢弃（防把控制帧当输出）
  }

  function openSession(directory: string, ptyId: string, wsUrl: string, subscriber: TerminalSubscriber): Session {
    const ws = wsFactory(wsUrl)
    const session: Session = { directory, ptyId, ws, cursor: 0, subscribers: new Set([subscriber]) }
    sessions.set(dirKey(directory), session)
    try { ws.binaryType = "arraybuffer" } catch { /* fake ws */ }
    ws.onmessage = (ev: any) => onMessage(session, ev?.data)
    const close = () => {
      if (sessions.get(dirKey(directory)) === session) sessions.delete(dirKey(directory))
      fanout(session, { directory, type: "closed" })
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

    async attach(directory, subscriber) {
      const key = dirKey(directory)
      const existing = sessions.get(key)
      if (existing && existing.ws?.readyState === 1) {
        existing.subscribers.add(subscriber)
        return { ptyId: existing.ptyId }
      }
      if (existing) sessions.delete(key)

      const i = await info()
      if (!i.persistentPty || !i.url) throw new Error("persistent PTY unavailable")

      const listRes = await f(`${deps.gatewayBase()}/api/pty${q(directory)}`)
      if (listRes.status === 404) {
        subscriber({ directory, type: "gone" })
        throw new Error("pty list 404")
      }
      if (!listRes.ok) throw new Error(`pty list ${listRes.status}`)
      const list = unwrapData(await listRes.json().catch(() => []))
      let pty = pickActivePty(Array.isArray(list) ? list : [])

      if (!pty) {
        const createRes = await f(`${deps.gatewayBase()}/api/pty${q(directory)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // 不传 command：让 serve 用默认 shell；cwd 必须显式（缺省会落 C:\）
          body: JSON.stringify({ cwd: directory, title: "MAFW", size: { cols: 120, rows: 30 } }),
        })
        if (!createRes.ok) throw new Error(`pty create ${createRes.status}`)
        pty = unwrapData(await createRes.json().catch(() => null))
        if (!pty?.id) throw new Error("pty create returned no id")
      }

      const ticket = await tokenFor(pty.id, directory)
      if (!ticket) {
        subscriber({ directory, type: "gone" })
        throw new Error("connect-token 404 (pty gone)")
      }

      const wsUrl = i.url.replace(/^http/, "ws") + `/api/pty/${encodeURIComponent(pty.id)}/connect?ticket=${encodeURIComponent(ticket)}`
      openSession(directory, pty.id, wsUrl, subscriber)
      return { ptyId: pty.id }
    },

    detach(directory, subscriber) {
      sessions.get(dirKey(directory))?.subscribers.delete(subscriber)
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
  // per-webContents 订阅登记：窗口销毁时解绑（PTY 属于目录，不随窗口死）
  const bySender = new Map<number, Array<{ directory: string; sub: TerminalSubscriber }>>()

  const subscribe = (sender: any, directory: string): TerminalSubscriber => {
    const sub: TerminalSubscriber = (ev) => {
      try { if (!sender.isDestroyed?.()) sender.send("mafw-terminal-event", ev) } catch { /* window gone */ }
    }
    const list = bySender.get(sender.id) ?? []
    list.push({ directory, sub })
    bySender.set(sender.id, list)
    return sub
  }

  ipcMain.handle("mafw-terminal-probe", () => ops.probe())
  ipcMain.handle("mafw-terminal-attach", (event: any, args: { directory: string }) => {
    const sub = subscribe(event.sender, args.directory)
    return ops.attach(args.directory, sub)
  })
  ipcMain.handle("mafw-terminal-detach", (event: any, args: { directory: string }) => {
    const list = bySender.get(event.sender.id) ?? []
    bySender.set(event.sender.id, list.filter((x) => x.directory !== args.directory))
    return
  })
  ipcMain.handle("mafw-terminal-input", (_e: any, args: { directory: string; data: string }) => ops.input(args.directory, args.data))
  ipcMain.handle("mafw-terminal-resize", (_e: any, args: { directory: string; cols: number; rows: number }) => ops.resize(args.directory, args.cols, args.rows))
  ipcMain.handle("mafw-terminal-kill", (_e: any, args: { directory: string }) => ops.kill(args.directory))
  ipcMain.handle("mafw-terminal-open-external", (_e: any, args: { directory: string }) => deps.openExternal?.(args.directory))
  return ops
}
